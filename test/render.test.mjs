import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";
import { renderPage, RENDER_PORTAL_UNSUPPORTED_MESSAGE } from "../dist/client.js";
import { SERVER_VERSION } from "../dist/version.js";

const ENV_KEYS = ["AGENTSEARCH_MODE", "AGENTSEARCH_BASE_URL", "AGENTSEARCH_API_KEY"];
let savedEnv;
let realFetch;
let calls;

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
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

test("lists agentsearch_render alongside existing tools, read-only", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["agentsearch_extract", "agentsearch_render", "agentsearch_web_search"]);
  const render = tools.find((t) => t.name === "agentsearch_render");
  assert.equal(render.annotations?.readOnlyHint, true);
  assert.deepEqual(render.inputSchema.required, ["url"]);
  assert.deepEqual(
    Object.keys(render.inputSchema.properties).sort(),
    ["block", "formats", "full_page", "max_chars", "screenshot", "screenshot_format", "url", "viewport", "wait_for_selector", "wait_ms", "wait_until"]
  );
  assert.match(render.description, /headless Chromium/);
  assert.match(render.description, /agentsearch_extract/);
});

test("direct mode POSTs {BASE}/v1/render with only provided fields", async () => {
  process.env.AGENTSEARCH_BASE_URL = "http://render.test:9000/";
  mockFetch(() => ({ body: { request_id: "r1", url: "https://example.com/", title: "Example", meta: {}, error: null, markdown: "# Hi" } }));
  const client = await connect();
  const res = await client.callTool({
    name: "agentsearch_render",
    arguments: { url: "https://example.com/", formats: ["text", "html"], max_chars: 500, wait_until: "networkidle", viewport: { width: 1024 } },
  });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://render.test:9000/v1/render");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].body, {
    url: "https://example.com/",
    formats: ["text", "html"],
    max_chars: 500,
    wait_until: "networkidle",
    viewport: { width: 1024 },
  });
  assert.equal(JSON.parse(res.content[0].text).title, "Example");
});

test("portal mode returns an MCP error without any network call", async () => {
  process.env.AGENTSEARCH_MODE = "portal";
  mockFetch(() => assert.fail("fetch must not be called in portal mode"));
  const client = await connect();
  const res = await client.callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/" } });
  assert.equal(res.isError, true);
  assert.equal(res.content[0].text, RENDER_PORTAL_UNSUPPORTED_MESSAGE);
  assert.equal(calls.length, 0);
  await assert.rejects(renderPage({ mode: "portal", baseUrl: "http://x" }, { url: "https://example.com/" }));
});

test("sends Bearer key and retries once without it on 401", async () => {
  process.env.AGENTSEARCH_API_KEY = "test-key";
  mockFetch((n) => (n === 1 ? { status: 401, body: "nope" } : { body: { error: null } }));
  const client = await connect();
  const res = await client.callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/" } });
  assert.equal(res.isError, undefined);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
  assert.equal(calls[1].init.headers.authorization, undefined);
});

test("HTTP 400 becomes an MCP error with status", async () => {
  mockFetch(() => ({ status: 400, body: { error: { code: "URL_NOT_ALLOWED", message: "no", retryable: false } } }));
  const client = await connect();
  const res = await client.callTool({ name: "agentsearch_render", arguments: { url: "https://example.com/" } });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /HTTP 400.*URL_NOT_ALLOWED/);
});

test("rejects invalid input before any network call", async () => {
  mockFetch(() => assert.fail("fetch must not be called"));
  const client = await connect();
  const res = await client.callTool({ name: "agentsearch_render", arguments: { url: "not a url" } });
  assert.equal(res.isError, true);
  assert.equal(calls.length, 0);
});

test("versions are consistent at 1.1.0 across package metadata", () => {
  const read = (f) => JSON.parse(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  const pkg = read("package.json");
  const manifest = read("manifest.json");
  const serverJson = read("server.json");
  assert.equal(pkg.version, "1.1.0");
  assert.equal(SERVER_VERSION, pkg.version);
  assert.equal(manifest.version, pkg.version);
  assert.equal(serverJson.version, pkg.version);
  assert.equal(serverJson.packages[0].version, pkg.version);
  assert.ok(manifest.tools.some((t) => t.name === "agentsearch_render"));
});
