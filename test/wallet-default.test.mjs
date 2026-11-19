// 1.9.0: a configured wallet makes search paid by default (AGENTSEARCH_MODE=free opts out), and AGENTSEARCH_WALLET_FILE reuses an existing wallet.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createServer } from "../dist/server.js";
import { backendMode, searchModeLabel } from "../dist/backend.js";
import { readWalletKey, resetSessionBudget, USDC_BASE, walletFilePath } from "../dist/pocket.js";
import { DIRECT_PAYEE } from "../dist/direct.js";
import { FREE_RELAY_URL } from "../dist/relay.js";

const ENV_KEYS = ["AGENTSEARCH_FREE_TRIAL", "AGENTSEARCH_MODE", "AGENTSEARCH_BASE_URL", "AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY", "AGENTSEARCH_WALLET_FILE",
  "AGENTSEARCH_MAX_TOTAL_ATOMIC", "AGENTSEARCH_MAX_PER_CALL_ATOMIC", "AGENTSEARCH_PAYMENT_ROUTE", "AGENTSEARCH_X402_DIRECT", "HOME"];
const API = "https://api.agentsearchhq.com";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
let saved, realFetch, calls, key, dir;

function terms(amount = "3000") {
  return { x402Version: 2, resource: { url: `${API}/x402/v1/search`, mimeType: "application/json" },
    accepts: [{ scheme: "exact", network: "eip155:8453", amount, asset: USDC_BASE, payTo: DIRECT_PAYEE, maxTimeoutSeconds: 300, extra: { name: "USD Coin", version: "2" } }] };
}
function mockPaid(paid) {
  globalThis.fetch = async (url, init) => {
    const sig = init.headers["PAYMENT-SIGNATURE"];
    calls.push({ url: String(url), sig });
    if (String(url).startsWith(FREE_RELAY_URL)) return new Response(JSON.stringify({ query: "qq", results: [] }), { status: 200 });
    if (!sig) { const t = terms(); return new Response(JSON.stringify(t), { status: 402, headers: { "PAYMENT-REQUIRED": b64(t) } }); }
    return paid(JSON.parse(Buffer.from(sig, "base64").toString()));
  };
}
const ok = (payer) => new Response(JSON.stringify({ query: "qq", results: [{ title: "T", url: "https://e.com" }] }), { status: 200, headers: {
  "PAYMENT-RESPONSE": b64({ success: true, transaction: "0x" + "cd".repeat(32), network: "eip155:8453", payer }), "content-type": "application/json" } });
async function connect() {
  const server = createServer(); const [c, s] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" }); await Promise.all([server.connect(s), client.connect(c)]); return client;
}
const search = async () => (await connect()).callTool({ name: "agentsearch_web_search", arguments: { query: "qq" } });

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) if (k !== "HOME") delete process.env[k];
  key = generatePrivateKey(); // throwaway, unfunded
  dir = mkdtempSync(join(tmpdir(), "as-wallet-"));
  realFetch = globalThis.fetch; calls = []; resetSessionBudget();
});
afterEach(() => { globalThis.fetch = realFetch; for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

test("no wallet: search stays on the free relay and says so", async () => {
  mockPaid(() => assert.fail("must not pay"));
  const r = await search();
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1); assert.ok(calls[0].url.startsWith(FREE_RELAY_URL));
  assert.match(JSON.parse(r.content[0].text).agentsearch_mode, /^free: .*no wallet configured/);
});

test("wallet key, default mode: search pays $0.003 on the direct API and the result says paid", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key;
  const payer = privateKeyToAccount(key).address; let signed;
  mockPaid((p) => { signed = p; return ok(payer); });
  const r = await search();
  assert.equal(r.isError, undefined, r.content[0].text);
  assert.equal(calls.length, 2); assert.equal(calls[0].url, `${API}/x402/v1/search`);
  assert.equal(signed.payload.authorization.value, "3000");
  const out = JSON.parse(r.content[0].text);
  assert.match(out.agentsearch_mode, /^paid: x402 to AgentSearch's API, \$0\.003 per search/);
  assert.equal(out.payment.amountAtomic, "3000");
});

test("wallet key + AGENTSEARCH_MODE=free: search stays free (opt-out)", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_MODE = "free";
  mockPaid(() => assert.fail("must not pay"));
  const r = await search();
  assert.equal(calls.length, 1); assert.ok(calls[0].url.startsWith(FREE_RELAY_URL));
  assert.equal(calls[0].sig, undefined);
  assert.match(JSON.parse(r.content[0].text).agentsearch_mode, /^free: .*AGENTSEARCH_MODE=free/);
});

test("session cap still applies to default paid search (nothing signed past the cap)", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_MAX_TOTAL_ATOMIC = "2999";
  mockPaid(() => assert.fail("must not sign"));
  const r = await search();
  assert.equal(r.isError, true); assert.match(r.content[0].text, /Nothing was signed|cap/i);
  assert.equal(calls.filter((c) => c.sig).length, 0);
});

test("AGENTSEARCH_WALLET_FILE: raw hex key file and AgentCash-style JSON both work; contents never echoed", async () => {
  const raw = join(dir, "wallet.key"); writeFileSync(raw, key.slice(2) + "\n");
  process.env.AGENTSEARCH_WALLET_FILE = raw;
  assert.equal(readWalletKey(), key);
  assert.equal(backendMode("search"), "direct");
  const json = join(dir, "wallet.json"); writeFileSync(json, JSON.stringify({ privateKey: key, address: privateKeyToAccount(key).address }));
  process.env.AGENTSEARCH_WALLET_FILE = json;
  assert.equal(readWalletKey(), key);
  const payer = privateKeyToAccount(key).address; let signed;
  mockPaid((p) => { signed = p; return ok(payer); });
  const r = await search();
  assert.equal(r.isError, undefined, r.content[0].text);
  assert.equal(signed.payload.authorization.from.toLowerCase(), payer.toLowerCase());
});

test("AGENTSEARCH_WALLET_FILE=agentcash resolves to ~/.agentcash/wallet.json", () => {
  process.env.HOME = dir;
  mkdirSync(join(dir, ".agentcash"));
  writeFileSync(join(dir, ".agentcash", "wallet.json"), JSON.stringify({ privateKey: key }));
  process.env.AGENTSEARCH_WALLET_FILE = "agentcash";
  assert.equal(walletFilePath(), join(dir, ".agentcash", "wallet.json"));
  assert.equal(readWalletKey(), key);
});

test("bad or missing wallet file fails cleanly without signing or leaking contents", async () => {
  const bad = join(dir, "bad.json"); writeFileSync(bad, JSON.stringify({ secret: "do-not-echo-me" }));
  process.env.AGENTSEARCH_WALLET_FILE = bad;
  mockPaid(() => assert.fail("must not sign"));
  let r = await search();
  assert.equal(r.isError, true); assert.match(r.content[0].text, /no "privateKey" field/); assert.doesNotMatch(r.content[0].text, /do-not-echo-me/);
  process.env.AGENTSEARCH_WALLET_FILE = join(dir, "missing.json");
  r = await search();
  assert.equal(r.isError, true); assert.match(r.content[0].text, /could not be read \(ENOENT\)/);
  assert.equal(calls.filter((c) => c.sig).length, 0);
});

test("searchModeLabel covers self-hosted and Pocket", () => {
  process.env.AGENTSEARCH_BASE_URL = "https://self.example";
  assert.match(searchModeLabel(), /^self-hosted/);
  delete process.env.AGENTSEARCH_BASE_URL;
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = key; process.env.AGENTSEARCH_PAYMENT_ROUTE = "pocket";
  assert.match(searchModeLabel(), /^paid: x402 via the Pocket portal/);
});
