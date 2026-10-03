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
  "AGENTSEARCH_BASE_URL is required. Set it to the base URL of your self-hosted AgentSearch-compatible API (no trailing slash). This package does not call the Pocket portal.";

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

export function loadConfig(): AgentSearchConfig {
  const raw = process.env.AGENTSEARCH_BASE_URL?.trim() ?? "";
  const baseUrl = raw.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error(MISSING_BASE_URL_MESSAGE);
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
