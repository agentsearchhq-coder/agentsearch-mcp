import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { backendMode, searchMode } from "../dist/backend.js";
import { FREE_RELAY_LIMIT_MESSAGE, FREE_RELAY_URL, WALLET_SETUP_URL, freeTrialLimitMessage, paidOnlyMessage } from "../dist/relay.js";

const ENV_KEYS = ["AGENTSEARCH_FREE_TRIAL", "AGENTSEARCH_MODE", "AGENTSEARCH_BASE_URL", "AGENTSEARCH_API_KEY", "AGENTSEARCH_WALLET_PRIVATE_KEY", "POCKET_PRIVATE_KEY"];
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
  process.env.AGENTSEARCH_FREE_TRIAL = "0";
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

// ---- 1.4.0: no-wallet extract/render free trial ----
test("no wallet: extract uses the relay free trial (POST /v1/extract, no auth, client header) and returns the page", async () => {
  mock(200, { url: "https://example.com/", title: "Example Domain", markdown: "hi", provider: "x", free_trial: { remaining_today: 4 } });
  const r = await (await connect()).callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.equal(r.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${FREE_RELAY_URL}/v1/extract`);
  assert.equal(calls[0].body.url, "https://example.com/");
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.match(calls[0].init.headers["x-agent-client"], /^agentsearch-mcp\/1\.5\.0$/);
  const data = JSON.parse(r.content[0].text);
  assert.equal(data.title, "Example Domain");
  assert.equal(data.free_trial.remaining_today, 4);
  assert.equal("provider" in data, false);
  assert.match(data.note, /Free trial call/);
});

test("no wallet: render trial drops screenshot/full_page and says so", async () => {
  mock(200, { url: "https://example.com/", title: "Example Domain", markdown: "hi" });
  const r = await (await connect()).callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/", screenshot: true, full_page: true, formats: ["text"] } });
  assert.equal(r.isError, undefined);
  assert.equal(calls[0].url, `${FREE_RELAY_URL}/v1/render`);
  assert.equal("screenshot" in calls[0].body, false);
  assert.equal("full_page" in calls[0].body, false);
  assert.deepEqual(calls[0].body.formats, ["text"]);
  assert.match(JSON.parse(r.content[0].text).note, /Screenshots are not part of the free trial/);
});

test("free trial 429 returns the limit message with wallet setup and the relay reason", async () => {
  mock(429, { error: { code: "free_trial_limit_reached", scope: "per_ip", message: "Free limit reached: 5 free extract calls per IP per day" } });
  const r = await (await connect()).callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Free trial limit reached for agentsearch_extract/);
  assert.ok(r.content[0].text.includes(WALLET_SETUP_URL));
  assert.match(r.content[0].text, /AGENTSEARCH_WALLET_PRIVATE_KEY/);
  assert.match(r.content[0].text, /5 free extract calls per IP/);
  assert.match(freeTrialLimitMessage("agentsearch_render"), /3 render calls\/day per IP/);
});

test("relay without the trial (404) falls back to the setup message", async () => {
  mock(404, { detail: "Not Found", error: { code: "search_only_relay" } });
  const r = await (await connect()).callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/" } });
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, paidOnlyMessage("agentsearch_render"));
});

test("free trial 400 (disallowed URL) is an error that says it was not counted", async () => {
  mock(400, { error: { code: "URL_NOT_ALLOWED", message: "Private addresses are not allowed." } });
  const r = await (await connect()).callTool({ name: "agentsearch_extract", arguments: { url: "http://10.0.0.1/" } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /HTTP 400, not counted/);
  assert.match(r.content[0].text, /URL_NOT_ALLOWED/);
});

test("AGENTSEARCH_FREE_TRIAL=0 makes no network call for extract/render; search still free", async () => {
  process.env.AGENTSEARCH_FREE_TRIAL = "off";
  mock(200, { results: [] });
  const c = await connect();
  const r = await c.callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.equal(r.content[0].text, paidOnlyMessage("agentsearch_extract"));
  assert.match(r.content[0].text, /turned off/);
  assert.equal(calls.length, 0);
  await c.callTool({ name: "agentsearch_web_search", arguments: { query: "q" } });
  assert.equal(calls[0].url, `${FREE_RELAY_URL}/v1/search`);
});

test("wallet key: extract/render never touch the relay trial (paid path unchanged)", async () => {
  process.env.AGENTSEARCH_WALLET_PRIVATE_KEY = KEY;
  mock(500, "portal down");
  const c = await connect();
  await c.callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/" } });
  for (const x of calls) assert.ok(x.url.startsWith("https://agent.pocket.network/"), x.url);
});

test("self-hosted base URL wins over the trial", async () => {
  process.env.AGENTSEARCH_BASE_URL = "https://self.test";
  mock(200, { title: "S" });
  await (await connect()).callTool({ name: "agentsearch_extract", arguments: { url: "https://example.com/" } });
  assert.equal(calls[0].url, "https://self.test/v1/extract");
});
