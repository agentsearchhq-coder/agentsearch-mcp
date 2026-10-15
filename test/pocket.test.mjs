import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServer } from "../dist/server.js";
import { paidOnlyMessage } from "../dist/relay.js";
import { resetSessionBudget, PORTAL_PAYEE, USDC_BASE, SETUP_MESSAGE } from "../dist/pocket.js";

const ENV_KEYS = [
  "AGENTSEARCH_BASE_URL", "AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY", "AGENTSEARCH_MAX_TOTAL_ATOMIC",
  "POCKET_MAX_TOTAL_ATOMIC", "AGENTSEARCH_MAX_PER_CALL_ATOMIC", "POCKET_MAX_PER_CALL_ATOMIC", "AGENTSEARCH_PORTAL_URL",
];
let saved, realFetch, calls, key;
const PORTAL = "https://agent.pocket.network";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

function terms(serviceId, over = {}) {
  return {
    x402Version: 2,
    resource: { url: `${PORTAL}/v1/${serviceId}`, description: "t", mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: "5000", asset: USDC_BASE, payTo: PORTAL_PAYEE, maxTimeoutSeconds: 60, extra: { name: "USD Coin", version: "2" }, ...over }],
  };
}
const TX = "0x" + "ab".repeat(32);
function receipt(payer) {
  return b64({ success: true, transaction: TX, network: "eip155:8453", payer });
}

/** Mock portal: 402 unless PAYMENT-SIGNATURE is present, then `paid(sig, call)`. */
function mockPortal({ serviceId = "agentsearch-web-search-v1", over, paid }) {
  globalThis.fetch = async (url, init) => {
    const sig = init.headers["PAYMENT-SIGNATURE"] ?? init.headers["payment-signature"];
    calls.push({ url: String(url), init, body: JSON.parse(init.body), sig });
    if (!sig) {
      const t = terms(serviceId, over);
      return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t), "content-type": "application/json" } });
    }
    return paid(JSON.parse(Buffer.from(sig, "base64").toString()));
  };
}
const okEnvelope = (serviceId, data, payer) =>
  new Response(JSON.stringify({ portal: { provenance: "third-party-supplier", serviceId, schemaCheck: "unchecked" }, data }), {
    status: 200, headers: { "PAYMENT-RESPONSE": receipt(payer), "content-type": "application/json" },
  });

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  key = generatePrivateKey(); // throwaway, unfunded
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  realFetch = globalThis.fetch;
  calls = [];
  resetSessionBudget();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

async function connect() {
  const server = createServer();
  const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(s), client.connect(c)]);
  return client;
}
const call = async (client, name, args) => client.callTool({ name, arguments: args });

test("402 -> signed EIP-3009 retry -> 200 returns envelope, receipt and spend", async () => {
  const payer = privateKeyToAccount(key).address;
  let signed;
  mockPortal({ paid: (p) => { signed = p; return okEnvelope("agentsearch-web-search-v1", { query: "q", results: [] }, payer); } });
  const res = await call(await connect(), "agentsearch_web_search", { query: "q", max_results: 2 });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${PORTAL}/v1/agentsearch-web-search-v1/v1/search`);
  assert.deepEqual(calls[1].body, { query: "q", max_results: 2 });
  assert.equal(signed.x402Version, 2);
  const a = signed.payload.authorization;
  assert.equal(a.to.toLowerCase(), PORTAL_PAYEE.toLowerCase());
  assert.equal(a.from, payer);
  assert.equal(a.value, "5000");
  assert.match(signed.payload.signature, /^0x[0-9a-f]{130}$/i);
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.payment.amountUsd, "$0.005000");
  assert.equal(out.payment.transaction, TX);
  assert.equal(out.payment.settled, true);
  assert.match(out.payment.explorer, /basescan\.org\/tx\//);
  assert.equal(out.response.portal.provenance, "third-party-supplier");
  assert.equal(out.spend.sessionSpentAtomic, "5000");
  assert.equal(res.content[0].text.includes(key.slice(2)), false, "key must never appear in output");
});

test("extract and render hit their own services and forward options", async () => {
  const payer = privateKeyToAccount(key).address;
  mockPortal({ serviceId: "agentsearch-web-render-v1", paid: () => okEnvelope("agentsearch-web-render-v1", { error: null }, payer) });
  const client = await connect();
  const args = { url: "https://example.com/", formats: ["markdown", "links"], wait_for_selector: "#app", wait_ms: 500, block: ["image"], screenshot: true };
  const res = await call(client, "agentsearch_render", args);
  assert.equal(res.isError, undefined, res.content[0].text);
  assert.equal(calls[0].url, `${PORTAL}/v1/agentsearch-web-render-v1/v1/render`);
  assert.deepEqual(calls[1].body, args);
  calls.length = 0;
  mockPortal({ serviceId: "agentsearch-web-extract-v1", paid: () => okEnvelope("agentsearch-web-extract-v1", { error: null }, payer) });
  const r2 = await call(client, "agentsearch_extract", { url: "https://example.com/", formats: ["text"], max_chars: 100 });
  assert.equal(r2.isError, undefined);
  assert.equal(calls[0].url, `${PORTAL}/v1/agentsearch-web-extract-v1/v1/extract`);
  assert.deepEqual(calls[1].body, { url: "https://example.com/", formats: ["text"], max_chars: 100 });
});

test("HTTP 200 with data.error is surfaced as upstreamError (paid)", async () => {
  const payer = privateKeyToAccount(key).address;
  mockPortal({ serviceId: "agentsearch-web-extract-v1", paid: () => okEnvelope("agentsearch-web-extract-v1", { error: { code: "FETCH_TIMEOUT", message: "slow", retryable: true } }, payer) });
  const res = await call(await connect(), "agentsearch_extract", { url: "https://example.com/" });
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.upstreamError.code, "FETCH_TIMEOUT");
  assert.equal(out.payment.settled, true);
});

for (const [label, over, re] of [
  ["amount above $0.005", { amount: "5001" }, /above the 5000/],
  ["wrong payee", { payTo: "0x000000000000000000000000000000000000dEaD" }, /payee/],
  ["wrong asset", { asset: "0x4200000000000000000000000000000000000006" }, /not USDC/],
  ["wrong network", { network: "eip155:84532" }, /network/],
]) {
  test(`refuses to sign: ${label}`, async () => {
    mockPortal({ over, paid: () => assert.fail("must not send a payment") });
    const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, re);
    assert.match(res.content[0].text, /Nothing was signed/);
    assert.equal(calls.length, 1);
  });
}

test("refuses a 402 for a different service id", async () => {
  mockPortal({ serviceId: "some-other-service", paid: () => assert.fail("no") });
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /not agentsearch-web-search-v1/);
});

test("per-call setting can lower but never raise the $0.005 ceiling", async () => {
  process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC = "4000";
  mockPortal({ paid: () => assert.fail("no") });
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.match(res.content[0].text, /above the 4000/);
  process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC = "999999";
  calls.length = 0;
  mockPortal({ over: { amount: "6000" }, paid: () => assert.fail("no") });
  const r2 = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.match(r2.content[0].text, /above the 5000/);
});

test("session cap is enforced (default $1.00, configurable)", async () => {
  process.env.POCKET_MAX_TOTAL_ATOMIC = "10000"; // two calls
  const payer = privateKeyToAccount(key).address;
  mockPortal({ paid: () => okEnvelope("agentsearch-web-search-v1", {}, payer) });
  const client = await connect();
  assert.equal((await call(client, "agentsearch_web_search", { query: "a" })).isError, undefined);
  assert.equal((await call(client, "agentsearch_web_search", { query: "b" })).isError, undefined);
  const third = await call(client, "agentsearch_web_search", { query: "c" });
  assert.equal(third.isError, true);
  assert.match(third.content[0].text, /Session spend cap reached/);
  assert.equal(calls.filter((c) => c.sig).length, 2);
});

test("non-2xx after payment (400 UPSTREAM_REJECTED) is an error, not settled, not retryable", async () => {
  mockPortal({ paid: () => new Response(JSON.stringify({ error: { code: "UPSTREAM_REJECTED", message: "bad body", retryable: false } }), { status: 400 }) });
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.equal(res.isError, true);
  const out = JSON.parse(res.content[0].text);
  assert.equal(out.error.code, "UPSTREAM_REJECTED");
  assert.equal(out.error.retryable, false);
  assert.equal(out.settled, false);
  assert.match(out.error && res.content[0].text, /not settled/);
});

test("503 with Retry-After is retryable", async () => {
  mockPortal({ paid: () => new Response(JSON.stringify({ error: { code: "SERVICE_UNAVAILABLE", message: "later", retryable: true } }), { status: 503, headers: { "retry-after": "30" } }) });
  const out = JSON.parse((await call(await connect(), "agentsearch_web_search", { query: "q" })).content[0].text);
  assert.equal(out.error.retryable, true);
  assert.equal(out.error.retryAfter, "30");
});

test("non-402 before payment: nothing signed", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down", retryable: true } }), { status: 429 });
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /429 RATE_LIMITED.*Nothing was signed/);
});

test("invalid key is reported without echoing it; base URL wins over key", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = "not-a-key-SECRETISH";
  globalThis.fetch = async () => assert.fail("no network");
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text.includes("SECRETISH"), false);
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  process.env.AGENTSEARCH_BASE_URL = "https://self.test";
  globalThis.fetch = async (url) => { calls.push(String(url)); return new Response("{}", { status: 200 }); };
  await call(await connect(), "agentsearch_web_search", { query: "q" });
  assert.deepEqual(calls, ["https://self.test/v1/search"]);
});

test("POCKET_PRIVATE_KEY alias works; no key -> paid-tool message", async () => {
  delete process.env.AGENTSEARCH_WALLET_PRIVATE_KEY;
  globalThis.fetch = async () => assert.fail("no network");
  const res = await call(await connect(), "agentsearch_render", { url: "https://example.com/" });
  assert.equal(res.content[0].text, paidOnlyMessage("agentsearch_render"));
  process.env.POCKET_PRIVATE_KEY = key.slice(2); // without 0x
  mockPortal({ paid: () => okEnvelope("agentsearch-web-search-v1", {}, privateKeyToAccount(key).address) });
  assert.equal((await call(await connect(), "agentsearch_web_search", { query: "q" })).isError, undefined);
});
