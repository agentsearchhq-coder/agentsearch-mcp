import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { backendMode, searchMode } from "../dist/backend.js";
import { FREE_RELAY_LIMIT_MESSAGE, FREE_RELAY_URL } from "../dist/relay.js";

const ENV_KEYS = ["AGENTSEARCH_MODE", "AGENTSEARCH_BASE_URL", "AGENTSEARCH_API_KEY", "AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY"];
const KEY = "0x" + "11".repeat(32);
let saved, realFetch, calls;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  realFetch = globalThis.fetch;
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]);
});
function mock(status, body) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
}
async function connect() {
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

test("default mode with no config is the free relay", () => {
  assert.equal(backendMode(), "free-relay");
  assert.equal(backendMode("extract"), "free-relay");
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  // 1.3.5: a wallet key alone no longer makes search paid; it only enables extract/render.
  assert.equal(backendMode(), "free-relay");
  assert.equal(backendMode("extract"), "pocket");
  assert.equal(backendMode("render"), "pocket");
  process.env.AGENTSEARCH_BASE_URL = "https://self.test";
  assert.equal(backendMode(), "self-hosted");
  assert.equal(backendMode("extract"), "self-hosted");
});

test("AGENTSEARCH_MODE: free by default, paid and auto are explicit opt-ins, junk is invalid", () => {
  assert.equal(searchMode(), "free");
  process.env.AGENTSEARCH_MODE = "  ";
  assert.equal(searchMode(), "free");
  process.env.AGENTSEARCH_MODE = "FREE";
  assert.equal(backendMode(), "free-relay");
  process.env.AGENTSEARCH_MODE = "paid";
  assert.equal(backendMode(), "pocket");
  process.env.AGENTSEARCH_MODE = "auto";
  assert.equal(backendMode(), "free-relay");
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  assert.equal(backendMode(), "pocket");
  process.env.AGENTSEARCH_MODE = "portal";
  assert.equal(searchMode(), "invalid");
});

test("no config: web search POSTs to the free relay with no auth and returns results", async () => {
  mock(200, { query: "q", result_count: 1, provider: "x", results: [{ title: "T", url: "https://e.com" }] });
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q", max_results: 9 } });
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${FREE_RELAY_URL}/v1/search`);
  assert.equal(FREE_RELAY_URL, "https://relay.agentsearchhq.com");
  assert.deepEqual(calls[0].body, { query: "q", max_results: 5 });
  assert.equal(calls[0].init.headers.authorization, undefined);
  const data = JSON.parse(r.content[0].text);
  assert.equal(data.results[0].title, "T");
  assert.equal("provider" in data, false);
});

test("free relay 429 returns the limit message with upgrade instructions", async () => {
  mock(429, { detail: "rate limited" });
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, FREE_RELAY_LIMIT_MESSAGE);
  assert.match(r.content[0].text, /up to 25 searches\/day per IP, subject to shared daily capacity/);
  assert.match(r.content[0].text, /Upgrade to paid/);
  assert.match(r.content[0].text, /AGENTSEARCH_WALLET_PRIVATE_KEY/);
  assert.match(r.content[0].text, /\$0\.005/);
});

test("free relay 5xx is reported as an error, not the limit message", async () => {
  mock(503, "down");
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /503/);
  assert.doesNotMatch(r.content[0].text, /limit reached/);
});

test("wallet key set, default mode: search still uses the free relay and never contacts the portal", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  mock(200, { query: "q", result_count: 0, results: [] });
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${FREE_RELAY_URL}/v1/search`);
  assert.equal(calls[0].init.headers["PAYMENT-SIGNATURE"], undefined);
});

test("wallet key set, default mode: free relay 429 tells the user to set AGENTSEARCH_MODE=paid", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  mock(429, { detail: "rate limited" });
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /AGENTSEARCH_MODE=paid/);
  assert.match(r.content[0].text, /up to 25 searches\/day per IP, subject to shared daily capacity/);
  assert.doesNotMatch(r.content[0].text, /Upgrade to paid search/);
});

test("AGENTSEARCH_MODE=paid with a wallet key: search goes to the portal, never the free relay", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  process.env.AGENTSEARCH_MODE = "paid";
  mock(500, "portal down");
  await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.ok(!c.url.startsWith(FREE_RELAY_URL), c.url);
});

test("AGENTSEARCH_MODE=paid without a wallet key: setup message, no network call", async () => {
  process.env.AGENTSEARCH_MODE = "paid";
  mock(500, "should not be called");
  const r = await (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /wallet/);
  assert.equal(calls.length, 0);
});

test("invalid AGENTSEARCH_MODE: search errors without any network call; extract/render are unaffected", async () => {
  process.env.AGENTSEARCH_MODE = "bogus";
  mock(500, "should not be called");
  const client = await connect();
  const r = await client.callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /AGENTSEARCH_MODE must be one of 'free', 'paid' or 'auto'/);
  assert.match(r.content[0].text, /No call was made/);
  const e = await client.callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.doesNotMatch(e.content[0].text, /AGENTSEARCH_MODE must be/);
  assert.equal(calls.length, 0);
});

test("wallet key, default mode: extract is still paid (reaches the portal, not the relay)", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  mock(500, "portal down");
  await (await connect()).callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.ok(calls.length >= 1);
  for (const c of calls) assert.ok(c.url.startsWith("https://agent.pocket.network/"), c.url);
});

test("tool metadata: free-first search description, no relay hostname, annotations on search and extract", async () => {
  const { tools } = await (await connect()).listTools();
  for (const name of ["agentsearch_web_search", "agentsearch_extract", "agentsearch_render"]) {
    const t = tools.find((x) => x.name === name);
    assert.doesNotMatch(t.description, /relay\.agentsearchhq\.com/);
    assert.doesNotMatch(t.description, /per user/i);
    if (name !== "agentsearch_render") {
      assert.equal(t.annotations.readOnlyHint, true, name);
      assert.equal(t.annotations.openWorldHint, true, name);
      assert.equal(t.annotations.destructiveHint, false, name);
    }
  }
  const search = tools.find((x) => x.name === "agentsearch_web_search");
  assert.match(search.description, /^Search the web[^]*Free by default/);
  assert.doesNotMatch(search.description, /Default mode: calls the Pocket Network Agentic Portal and PAYS/);
  assert.match(search.description, /up to 25 searches\/day per IP, subject to shared daily capacity/);
  assert.match(tools.find((x) => x.name === "agentsearch_extract").description, /Paid tool/);
});
