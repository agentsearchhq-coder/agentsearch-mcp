import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { extractPage, renderPage, webSearch, MISSING_BASE_URL_MESSAGE, unsupportedEndpointMessage } from "../dist/client.js";
import { RENDER_DESCRIPTION } from "../dist/tools/render.js";

const cfg = { baseUrl: "https://relay.agentsearchhq.com" };
let realFetch;
function mock(status, body) {
  globalThis.fetch = async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}
beforeEach(() => { realFetch = globalThis.fetch; });
afterEach(() => { globalThis.fetch = realFetch; });

for (const [name, fn, path] of [["extract", extractPage, "/v1/extract"], ["render", renderPage, "/v1/render"]]) {
  test(`${name}: 404 {detail:"Not Found"} gives relay-limitation error`, async () => {
    mock(404, { detail: "Not Found" });
    await assert.rejects(fn(cfg, { url: "https://example.com" }), (e) => {
      assert.equal(e.status, 404);
      assert.match(e.message, new RegExp(`does not serve ${path}`));
      assert.match(e.message, /free relay supports search only/);
      assert.match(e.message, /AGENTSEARCH_WALLET_PRIVATE_KEY/);
      return true;
    });
  });
  test(`${name}: other 404 bodies are passed through unchanged`, async () => {
    mock(404, { detail: "URL not found upstream" });
    await assert.rejects(fn(cfg, { url: "https://example.com" }), (e) => {
      assert.doesNotMatch(e.message, /free relay/);
      assert.match(e.message, /URL not found upstream/);
      return true;
    });
  });
  test(`${name}: relay error also applies after 401 retry without key`, async () => {
    let n = 0;
    globalThis.fetch = async () => (++n === 1 ? new Response("{}", { status: 401 }) : new Response('{"detail":"Not Found"}', { status: 404 }));
    await assert.rejects(fn({ ...cfg, apiKey: "test-key" }, { url: "https://example.com" }), /free relay supports search only/);
  });
}

test("search 404 is not rewritten", async () => {
  mock(404, { detail: "Not Found" });
  await assert.rejects(webSearch(cfg, { query: "x" }), (e) => { assert.doesNotMatch(e.message, /free relay/); return true; });
});

test("messages and descriptions state the relay limitation", () => {
  assert.equal(unsupportedEndpointMessage("/v1/render"), "This base URL does not serve /v1/render. The free relay supports search only. Use paid mode (AGENTSEARCH_WALLET_PRIVATE_KEY) or self-host.");
  assert.match(MISSING_BASE_URL_MESSAGE, /serves search only/);
  assert.match(RENDER_DESCRIPTION, /serves search only/);
});
