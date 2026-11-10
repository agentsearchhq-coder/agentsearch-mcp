import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServer } from "../dist/server.js";
import { backendMode } from "../dist/backend.js";
import { resetSessionBudget, USDC_BASE, PORTAL_PAYEE } from "../dist/pocket.js";
import { DIRECT_PAYEE, DIRECT_SETUP_MESSAGE } from "../dist/direct.js";

const ENV_KEYS = ["AGENTSEARCH_FREE_TRIAL", "AGENTSEARCH_MODE", "AGENTSEARCH_BASE_URL", "AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY",
  "AGENTSEARCH_MAX_TOTAL_ATOMIC", "POCKET_MAX_TOTAL_ATOMIC", "AGENTSEARCH_MAX_PER_CALL_ATOMIC", "POCKET_MAX_PER_CALL_ATOMIC",
  "AGENTSEARCH_PORTAL_URL", "AGENTSEARCH_X402_DIRECT", "AGENTSEARCH_X402_DIRECT_URL"];
const API = "https://api.agentsearchhq.com";
const PRICES = { search: "8000", extract: "7000", render: "10000" };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
let saved, realFetch, calls, key;

function terms(op, over = {}) {
  return { x402Version: 2, resource: { url: `${API}/x402/v1/${op}`, mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount: PRICES[op], asset: USDC_BASE, payTo: DIRECT_PAYEE, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" }, ...over }] };
}
function mockApi({ op, over, paid }) {
  globalThis.fetch = async (url, init) => {
    const sig = init.headers["PAYMENT-SIGNATURE"];
    calls.push({ url: String(url), body: JSON.parse(init.body), sig });
    if (!sig) { const t = terms(op, over); return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } }); }
    return paid(JSON.parse(Buffer.from(sig, "base64").toString()));
  };
}
const okResult = (data, payer) => new Response(JSON.stringify(data), { status: 200, headers: {
  "PAYMENT-RESPONSE": b64({ success: true, transaction: "0x" + "cd".repeat(32), network: "eip155:8453", payer }), "content-type": "application/json" } });

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  key = generatePrivateKey(); // throwaway, unfunded
  realFetch = globalThis.fetch; calls = []; resetSessionBudget();
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

async function connect() {
  const server = createServer(); const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" }); await Promise.all([server.connect(s), client.connect(c)]); return client;
}
const call = async (client, name, args) => client.callTool({ name, arguments: args });
const parse = (res) => JSON.parse(res.content[0].text);

test("default is unchanged: without AGENTSEARCH_X402_DIRECT the paid rail is Pocket", () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  assert.equal(backendMode("extract"), "pocket");
  assert.equal(backendMode("search"), "free-relay");
  process.env.AGENTSEARCH_X402_DIRECT = "0";
  assert.equal(backendMode("extract"), "pocket");
});

test("direct opt-in swaps only the paid rail; search stays free unless AGENTSEARCH_MODE=paid; base URL still wins", () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1";
  assert.equal(backendMode("extract"), "free-relay"); // no key -> free trial as before
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  assert.equal(backendMode("extract"), "direct");
  assert.equal(backendMode("render"), "direct");
  assert.equal(backendMode("search"), "free-relay");
  process.env.AGENTSEARCH_MODE = "paid";
  assert.equal(backendMode("search"), "direct");
  process.env.AGENTSEARCH_BASE_URL = "https://self.example";
  assert.equal(backendMode("search"), "self-hosted");
});

for (const op of ["search", "extract", "render"]) {
  test(`direct ${op}: 402 -> signed EIP-3009 to AgentSearch payee for ${PRICES[op]} -> 200 with receipt`, async () => {
    process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_MODE = "paid";
    const payer = privateKeyToAccount(key).address; let signed;
    mockApi({ op, paid: (p) => { signed = p; return okResult({ ok: op }, payer); } });
    const tool = { search: "agentsearch_web_search", extract: "agentsearch_extract", render: "agentsearch_render" }[op];
    const args = op === "search" ? { query: "q", max_results: 3 } : { url: "https://example.com", ...(op === "render" ? { formats: ["markdown"] } : {}) };
    const res = await call(await connect(), tool, args);
    assert.equal(res.isError, undefined, res.content[0].text);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].url, `${API}/x402/v1/${op}`);
    assert.deepEqual(calls[1].body, op === "search" ? { query: "q", max_results: 3 } : { url: "https://example.com" });
    assert.equal(signed.payload.authorization.to.toLowerCase(), DIRECT_PAYEE.toLowerCase());
    assert.equal(signed.payload.authorization.value, PRICES[op]);
    const out = parse(res);
    assert.equal(out.payment.payTo, DIRECT_PAYEE); assert.equal(out.payment.amountAtomic, PRICES[op]);
    assert.equal(out.payment.settled, true); assert.deepEqual(out.response, { ok: op });
    if (op === "render") assert.deepEqual(out.dropped, ["formats"]);
  });
}

test("direct refuses the Pocket payee, a price above $0.010, and a non-USDC asset (nothing signed)", async () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  for (const over of [{ payTo: PORTAL_PAYEE }, { amount: "10001" }, { asset: "0x" + "11".repeat(20) }, { network: "eip155:84532" }]) {
    calls = [];
    mockApi({ op: "extract", over, paid: () => assert.fail("must not sign") });
    const res = await call(await connect(), "agentsearch_extract", { url: "https://example.com" });
    assert.equal(res.isError, true); assert.match(res.content[0].text, /Nothing was signed/); assert.equal(calls.length, 1);
  }
});

test("direct respects lower per-call cap and the session cap", async () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC = "7000";
  mockApi({ op: "render", paid: () => assert.fail("must not sign") });
  let res = await call(await connect(), "agentsearch_render", { url: "https://example.com" });
  assert.equal(res.isError, true); assert.match(res.content[0].text, /above the 7000 atomic/);
  delete process.env.AGENTSEARCH_MAX_PER_CALL_ATOMIC; process.env.AGENTSEARCH_MAX_TOTAL_ATOMIC = "7000";
  const payer = privateKeyToAccount(key).address;
  mockApi({ op: "extract", paid: () => okResult({ ok: 1 }, payer) });
  const client = await connect();
  res = await call(client, "agentsearch_extract", { url: "https://example.com" }); assert.equal(res.isError, undefined);
  res = await call(client, "agentsearch_extract", { url: "https://example.com" }); assert.equal(res.isError, true);
  assert.match(res.content[0].text, /Session spend cap reached/);
});

test("direct: resource mismatch and non-402 first answer are refused; 502 after signing is reported unsettled", async () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  globalThis.fetch = async () => { const t = terms("search"); return new Response("{}", { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } }); };
  let res = await call(await connect(), "agentsearch_extract", { url: "https://example.com" });
  assert.equal(res.isError, true); assert.match(res.content[0].text, /not \/x402\/v1\/extract/);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "rate_limited" }), { status: 429 });
  res = await call(await connect(), "agentsearch_extract", { url: "https://example.com" });
  assert.equal(res.isError, true); assert.match(res.content[0].text, /answered 429/);
  mockApi({ op: "extract", paid: () => new Response(JSON.stringify({ error: "upstream_failed", charged: false }), { status: 502 }) });
  res = await call(await connect(), "agentsearch_extract", { url: "https://example.com" });
  assert.equal(res.isError, true); const o = parse(res); assert.equal(o.settled, false); assert.equal(o.paymentSigned, true);
});

test("direct with no key: extract keeps the free trial path; paid search gives the direct setup message", async () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_MODE = "paid";
  globalThis.fetch = async () => assert.fail("no network call expected");
  const res = await call(await connect(), "agentsearch_web_search", { query: "q" });
  // paid mode without key -> pocket path -> setup message (no network); unchanged from 1.4.0
  assert.equal(res.isError, true);
  assert.ok(DIRECT_SETUP_MESSAGE.includes("$0.008"));
});

test("direct URL must be https or localhost", async () => {
  process.env.AGENTSEARCH_X402_DIRECT = "1"; process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  process.env.AGENTSEARCH_X402_DIRECT_URL = "http://evil.example";
  globalThis.fetch = async () => assert.fail("no network call expected");
  const res = await call(await connect(), "agentsearch_extract", { url: "https://example.com" });
  assert.equal(res.isError, true); assert.match(res.content[0].text, /must be https/);
});
