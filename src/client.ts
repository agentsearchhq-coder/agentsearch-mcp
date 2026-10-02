/**
 * HTTP client for AgentSearch search, extract, and render backends.
 * Modes: direct (local/self-hosted) | portal (Pocket agent portal).
 */

export type AgentSearchMode = "direct" | "portal";

export interface AgentSearchConfig {
  mode: AgentSearchMode;
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

export const RENDER_PORTAL_UNSUPPORTED_MESSAGE =
  "agentsearch_render is only supported in AGENTSEARCH_MODE=direct (POST {BASE}/v1/render); the portal render endpoint is not live yet. Switch to direct mode, or use agentsearch_extract / agentsearch_web_search.";

export class AgentSearchHttpError extends Error {
  readonly status: number;
  readonly body: string;
  readonly paymentRequired: boolean;

  constructor(status: number, body: string) {
    const paymentRequired = status === 402;
    super(
      paymentRequired
        ? `AgentSearch portal returned 402 Payment Required (x402). Use AGENTSEARCH_MODE=direct with a local/self-hosted AgentSearch API, or complete portal payment.`
        : `AgentSearch HTTP ${status}: ${body.slice(0, 500)}`
    );
    this.name = "AgentSearchHttpError";
    this.status = status;
    this.body = body;
    this.paymentRequired = paymentRequired;
  }
}

const PORTAL_SEARCH_URL =
  "https://agent.pocket.network/v1/agentsearch-web-search-v1/v1/search";

export function loadConfig(): AgentSearchConfig {
  const rawMode = (process.env.AGENTSEARCH_MODE ?? "direct").trim().toLowerCase();
  const mode: AgentSearchMode = rawMode === "portal" ? "portal" : "direct";
  const baseUrl = (
    process.env.AGENTSEARCH_BASE_URL ?? "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const apiKey = process.env.AGENTSEARCH_API_KEY?.trim() || undefined;
  return { mode, baseUrl, apiKey };
}

function searchUrl(cfg: AgentSearchConfig): string {
  if (cfg.mode === "portal") return PORTAL_SEARCH_URL;
  return `${cfg.baseUrl}/v1/search`;
}

function extractUrl(cfg: AgentSearchConfig): string {
  // Extract is only defined for direct in this package; portal extract may differ.
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
  });

  const text = await res.text();

  if (
    res.status === 401 &&
    apiKey &&
    opts?.retryWithoutKeyOn401 !== false
  ) {
    // Direct mode: some deployments reject a present key; retry once without it.
    return postJson(url, body, undefined, { retryWithoutKeyOn401: false });
  }

  if (res.status === 402) {
    throw new AgentSearchHttpError(402, text);
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
  const url = searchUrl(cfg);
  const key = cfg.mode === "direct" ? cfg.apiKey : undefined;
  return postJson(
    url,
    { query: req.query, max_results: req.max_results },
    key,
    { retryWithoutKeyOn401: cfg.mode === "direct" }
  );
}

export async function extractPage(
  cfg: AgentSearchConfig,
  req: ExtractRequest
): Promise<unknown> {
  if (cfg.mode === "portal") {
    throw new Error(
      "agentsearch_extract is only supported in AGENTSEARCH_MODE=direct (POST {BASE}/v1/extract). Switch to direct mode or call search only."
    );
  }
  const url = extractUrl(cfg);
  const body: Record<string, unknown> = { url: req.url };
  if (req.formats) body.formats = req.formats;
  if (req.max_chars !== undefined) body.max_chars = req.max_chars;
  return postJson(url, body, cfg.apiKey, { retryWithoutKeyOn401: true });
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
  if (cfg.mode === "portal") {
    // Portal render endpoint is not live yet: fail before any network call.
    throw new Error(RENDER_PORTAL_UNSUPPORTED_MESSAGE);
  }
  const body: Record<string, unknown> = { url: req.url };
  for (const key of RENDER_FIELDS) {
    if (req[key] !== undefined) body[key] = req[key];
  }
  return postJson(renderUrl(cfg), body, cfg.apiKey, {
    retryWithoutKeyOn401: true,
  });
}

export function clampMaxResults(n: number | undefined, fallback = 5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(10, Math.max(1, v));
}
