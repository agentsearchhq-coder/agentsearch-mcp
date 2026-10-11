/**
 * HTTP client for a self-hosted AgentSearch-compatible API
 * (search, extract, and render).
 */

export interface AgentSearchConfig {
  baseUrl: string;
  apiKey?: string;
}

export interface SearchRequest {
  query: string;
  max_results: number;
}

export interface ExtractRequest {
  url: string;
  formats?: string[];
  max_chars?: number;
}

export type RenderFormat = "markdown" | "text" | "html" | "links";
export type RenderBlockType = "image" | "media" | "font" | "stylesheet";
export type RenderWaitUntil = "domcontentloaded" | "load" | "networkidle";

/** Mirrors RenderRequest in https://agentsearchhq.com/specs/render-openapi.json */
export interface RenderRequest {
  url: string;
  formats?: RenderFormat[];
  max_chars?: number;
  screenshot?: boolean;
  screenshot_format?: "png" | "jpeg";
  full_page?: boolean;
  viewport?: { width?: number; height?: number };
  wait_until?: RenderWaitUntil;
  wait_for_selector?: string | null;
  wait_ms?: number;
  block?: RenderBlockType[];
}

export const MISSING_BASE_URL_MESSAGE =
  "AGENTSEARCH_BASE_URL is not set, so agentsearch_web_search, agentsearch_extract and agentsearch_render are unavailable. Set AGENTSEARCH_BASE_URL to the base URL of your self-hosted AgentSearch-compatible API (no trailing slash) in this MCP server's env and restart it. The review tools (agentsearch_review_lookup, agentsearch_review_submit) work without it.";

/** True when AGENTSEARCH_BASE_URL is set (non-blank). */
export function hasBaseUrl(): boolean {
  return Boolean(process.env.AGENTSEARCH_BASE_URL?.trim());
}

export class AgentSearchHttpError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`AgentSearch HTTP ${status}: ${body.slice(0, 500)}`);
    this.name = "AgentSearchHttpError";
    this.status = status;
    this.body = body;
  }
}

/** Default per-request timeout; override with AGENTSEARCH_TIMEOUT_MS (1000–300000). */
export const DEFAULT_TIMEOUT_MS = 30_000;
export function requestTimeoutMs(): number {
  const n = Number(process.env.AGENTSEARCH_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1000 && n <= 300_000 ? Math.trunc(n) : DEFAULT_TIMEOUT_MS;
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** True for https URLs, or http URLs that point at this machine (localhost / loopback). */
export function isSecureOrLocalUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol === "https:") return true;
  if (u.protocol !== "http:") return false;
  const host = u.hostname.toLowerCase();
  return LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost") || /^127\.\d+\.\d+\.\d+$/.test(host);
}

/** Opt-in escape hatch for trusted private networks (keys are then sent over plain HTTP). */
function insecureHttpAllowed(): boolean {
  return /^(1|true|yes)$/i.test(process.env.AGENTSEARCH_ALLOW_INSECURE_HTTP?.trim() ?? "");
}

export function loadConfig(): AgentSearchConfig {
  const raw = process.env.AGENTSEARCH_BASE_URL?.trim() ?? "";
  const baseUrl = raw.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(MISSING_BASE_URL_MESSAGE);
  }
  if (!isSecureOrLocalUrl(baseUrl) && !(insecureHttpAllowed() && /^http:\/\//i.test(baseUrl))) {
    throw new Error(
      "AGENTSEARCH_BASE_URL must be an https:// URL (plain http:// is allowed only for localhost). Refusing to send requests or your API key in clear text. Set AGENTSEARCH_ALLOW_INSECURE_HTTP=1 only for a trusted private network."
    );
  }
  const apiKey = process.env.AGENTSEARCH_API_KEY?.trim() || undefined;
  return { baseUrl, apiKey };
}

function searchUrl(cfg: AgentSearchConfig): string {
  return `${cfg.baseUrl}/v1/search`;
}

function extractUrl(cfg: AgentSearchConfig): string {
  return `${cfg.baseUrl}/v1/extract`;
}

function renderUrl(cfg: AgentSearchConfig): string {
  return `${cfg.baseUrl}/v1/render`;
}

async function postJson(
  url: string,
  body: unknown,
  apiKey: string | undefined,
  opts?: { retryWithoutKeyOn401?: boolean }
): Promise<unknown> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });

  const text = await res.text();

  if (
    res.status === 401 &&
    apiKey &&
    opts?.retryWithoutKeyOn401 !== false
  ) {
    // Some deployments reject a present key; retry once without it.
    return postJson(url, body, undefined, { retryWithoutKeyOn401: false });
  }

  if (!res.ok) {
    throw new AgentSearchHttpError(res.status, text || res.statusText);
  }

  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { raw: text };
  }
}

export async function webSearch(
  cfg: AgentSearchConfig,
  req: SearchRequest
): Promise<unknown> {
  return postJson(
    searchUrl(cfg),
    { query: req.query, max_results: req.max_results },
    cfg.apiKey,
    { retryWithoutKeyOn401: true }
  );
}

export async function extractPage(
  cfg: AgentSearchConfig,
  req: ExtractRequest
): Promise<unknown> {
  const body: Record<string, unknown> = { url: req.url };
  if (req.formats) body.formats = req.formats;
  if (req.max_chars !== undefined) body.max_chars = req.max_chars;
  return postJson(extractUrl(cfg), body, cfg.apiKey, { retryWithoutKeyOn401: true });
}

const RENDER_FIELDS = [
  "formats",
  "max_chars",
  "screenshot",
  "screenshot_format",
  "full_page",
  "viewport",
  "wait_until",
  "wait_for_selector",
  "wait_ms",
  "block",
] as const;

export async function renderPage(
  cfg: AgentSearchConfig,
  req: RenderRequest
): Promise<unknown> {
  const body: Record<string, unknown> = { url: req.url };
  for (const key of RENDER_FIELDS) {
    if (req[key] !== undefined) body[key] = req[key];
  }
  return postJson(renderUrl(cfg), body, cfg.apiKey, {
    retryWithoutKeyOn401: true,
  });
}

/** Backend allows at most 5 hits. Values outside 1–5 are clamped; default is 5. */
export function clampMaxResults(n: number | undefined, fallback = 5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(5, Math.max(1, v));
}
