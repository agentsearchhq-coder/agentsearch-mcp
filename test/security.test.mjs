// Security review L14: https-only base URLs (except localhost), request timeouts, review key only over https.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, isSecureOrLocalUrl, webSearch, requestTimeoutMs, DEFAULT_TIMEOUT_MS } from "../dist/client.js";
import { loadReviewsConfig, reviewSubmit } from "../dist/reviews-client.js";

const ENV_KEYS = ["AGENTSEARCH_BASE_URL", "AGENTSEARCH_API_KEY", "AGENTSEARCH_ALLOW_INSECURE_HTTP", "AGENTSEARCH_TIMEOUT_MS", "AGENTSEARCH_REVIEWS_URL", "AGENTSEARCH_REVIEW_KEY", "HOME", "USERPROFILE"];
let saved, realFetch, calls;
beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.HOME = process.env.USERPROFILE = "/nonexistent-home-for-tests";
  realFetch = globalThis.fetch;
  calls = [];
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return new Response("{}", { status: 200 }); };
});
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

test("isSecureOrLocalUrl", () => {
  for (const u of ["https://api.example.com", "http://localhost:8080", "http://127.0.0.1:1", "http://[::1]:3000", "http://dev.localhost"]) assert.equal(isSecureOrLocalUrl(u), true, u);
  for (const u of ["http://api.example.com", "http://10.0.0.5", "ftp://x", "not a url", "http://localhost.evil.com"]) assert.equal(isSecureOrLocalUrl(u), false, u);
});

test("loadConfig refuses plain http to a remote host unless explicitly allowed", () => {
  process.env.AGENTSEARCH_BASE_URL = "http://api.example.com";
  process.env.AGENTSEARCH_API_KEY = "secret";
  assert.throws(() => loadConfig(), /https/);
  process.env.AGENTSEARCH_ALLOW_INSECURE_HTTP = "1";
  assert.equal(loadConfig().baseUrl, "http://api.example.com");
  delete process.env.AGENTSEARCH_ALLOW_INSECURE_HTTP;
  process.env.AGENTSEARCH_BASE_URL = "http://localhost:8080/";
  assert.equal(loadConfig().baseUrl, "http://localhost:8080");
  process.env.AGENTSEARCH_BASE_URL = "javascript:alert(1)";
  process.env.AGENTSEARCH_ALLOW_INSECURE_HTTP = "1";
  assert.throws(() => loadConfig(), /https/);
});

test("requests carry an abort signal (timeout)", async () => {
  assert.equal(requestTimeoutMs(), DEFAULT_TIMEOUT_MS);
  process.env.AGENTSEARCH_TIMEOUT_MS = "5000";
  assert.equal(requestTimeoutMs(), 5000);
  process.env.AGENTSEARCH_TIMEOUT_MS = "5";
  assert.equal(requestTimeoutMs(), DEFAULT_TIMEOUT_MS);
  await webSearch({ baseUrl: "https://api.example.com" }, { query: "q", max_results: 1 });
  assert.ok(calls[0].init.signal instanceof AbortSignal);
});

test("a hung upstream is aborted", async () => {
  process.env.AGENTSEARCH_TIMEOUT_MS = "1000";
  globalThis.fetch = (url, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(init.signal.reason)));
  const keepAlive = setTimeout(() => {}, 5000); // AbortSignal.timeout timers are unref'd
  try {
    await assert.rejects(webSearch({ baseUrl: "https://api.example.com" }, { query: "q", max_results: 1 }), /timeout|abort/i);
  } finally {
    clearTimeout(keepAlive);
  }
});

test("review key is never sent over plain http", async () => {
  process.env.AGENTSEARCH_REVIEW_KEY = "asrb_" + "k".repeat(43);
  process.env.AGENTSEARCH_REVIEWS_URL = "http://board.example.test";
  assert.equal(loadReviewsConfig().key, undefined);
  await reviewSubmit({ baseUrl: "http://board.example.test", key: "asrb_" + "k".repeat(43) }, { service_id: "a", success: true });
  assert.equal(calls[0].init.headers.authorization, undefined);
  assert.ok(calls[0].init.signal instanceof AbortSignal);
  process.env.AGENTSEARCH_REVIEWS_URL = "https://board.example.test";
  assert.ok(loadReviewsConfig().key);
});
