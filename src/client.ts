/**
 * HTTP client for AgentSearch search + extract backends.
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

export function clampMaxResults(n: number | undefined, fallback = 5): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : fallback;
  return Math.min(10, Math.max(1, v));
}
