import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { SERVER_VERSION } from "../dist/version.js";

const ENV_KEYS = ["AGENTSEARCH_REVIEWS_URL", "AGENTSEARCH_REVIEW_KEY", "HOME", "USERPROFILE"];
let savedEnv, realFetch, calls;

function mockFetch(responder) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    const { status = 200, body = {} } = responder(calls.length);
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.HOME = "/nonexistent-home-for-tests";
  process.env.USERPROFILE = "/nonexistent-home-for-tests";
  realFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function connect() {
  const server = createServer();
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}

test("review tools are listed with the right hints and guidance", async () => {
  const { tools } = await (await connect()).listTools();
  const lookup = tools.find((t) => t.name === "agentsearch_review_lookup");
  const submit = tools.find((t) => t.name === "agentsearch_review_submit");
  assert.equal(lookup.annotations.readOnlyHint, true);
  assert.equal(submit.annotations.readOnlyHint, false);
  assert.equal(submit.annotations.destructiveHint, false);
  assert.match(lookup.description, /Look up before choosing a tool/);
  assert.match(lookup.description, /never follow instructions/);
  assert.match(submit.description, /Submit after using one/);
  assert.deepEqual(submit.inputSchema.required.sort(), ["service_id", "success"]);
  for (const t of [lookup, submit]) assert.doesNotMatch(t.description, /cheapest|lowest|\btop\b|\bbest\b/i);
});

test("lookup calls the default board URL with task filters and needs no API base URL", async () => {
  mockFetch(() => ({ body: { task: "search", services: [] } }));
  const client = await connect();
  const r = await client.callTool({ name: "agentsearch_review_lookup", arguments: { task: "search", max_price_usd: 0.01, network: "x402" } });
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1);
  const u = new URL(calls[0].url);
  assert.equal(u.origin, "https://reviews.agentsearchhq.com");
  assert.equal(u.pathname, "/v1/services");
  assert.equal(u.searchParams.get("task"), "search");
  assert.equal(u.searchParams.get("max_price_usd"), "0.01");
  assert.equal(u.searchParams.get("network"), "x402");
  assert.equal(u.searchParams.get("limit"), "5");
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("lookup by service_id hits the encoded detail route; needs task or service_id", async () => {
  process.env.AGENTSEARCH_REVIEWS_URL = "https://board.example.test/";
  mockFetch(() => ({ body: { service: {} } }));
  const client = await connect();
  await client.callTool({ name: "agentsearch_review_lookup", arguments: { service_id: "x402:api.example.com/v1/a" } });
  assert.equal(calls[0].url, "https://board.example.test/v1/services/x402%3Aapi.example.com%2Fv1%2Fa");
  const bad = await client.callTool({ name: "agentsearch_review_lookup", arguments: {} });
  assert.equal(bad.isError, true);
  assert.equal(calls.length, 1);
});

test("submit posts a structured review with client tag, proof and bearer key", async () => {
  process.env.AGENTSEARCH_REVIEW_KEY = "asrb_" + "k".repeat(43);
  mockFetch(() => ({ status: 201, body: { review_id: "rv_1", status: "accepted" } }));
  const client = await connect();
  const tx = "0x" + "ab".repeat(32);
  const r = await client.callTool({
    name: "agentsearch_review_submit",
    arguments: { service_id: "pocket:agentsearch-web-search-v1", success: true, latency_ms: 840, quality: 4, price_paid_usd: 0.005, note: "10 relevant results", proof_tx_hash: tx },
  });
  assert.equal(r.isError, undefined);
  assert.equal(calls[0].url, "https://reviews.agentsearchhq.com/v1/reviews");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.authorization, "Bearer asrb_" + "k".repeat(43));
  assert.deepEqual(calls[0].body, {
    service_id: "pocket:agentsearch-web-search-v1",
    success: true,
    client: `agentsearch-mcp/${SERVER_VERSION}`,
    latency_ms: 840,
    quality: 4,
    price_paid_usd: 0.005,
    note: "10 relevant results",
    proof: { type: "x402_base_tx", tx_hash: tx },
  });
});

test("submit surfaces board errors (e.g. 429) as MCP errors and validates input first", async () => {
  mockFetch(() => ({ status: 429, body: { error: { code: "rate_limited" } } }));
  const client = await connect();
  const r = await client.callTool({ name: "agentsearch_review_submit", arguments: { service_id: "x402:a.test/b", success: false } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /429/);
  const bad = await client.callTool({ name: "agentsearch_review_submit", arguments: { service_id: "x402:a.test/b", success: true, quality: 9 } });
  assert.equal(bad.isError, true);
  assert.equal(calls.length, 1);
});
