/**
 * HTTP client for the AgentSearch Review Board (free works-now checks and agent reviews).
 * Independent of AGENTSEARCH_BASE_URL: the board is a public service with its own URL.
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AgentSearchHttpError } from "./client.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

export const DEFAULT_REVIEWS_URL = "https://reviews.agentsearchhq.com";
export const REVIEW_TASKS = ["search", "extract", "render", "scrape", "llm", "data", "finance", "crypto", "other"] as const;
export const REVIEW_NETWORKS = ["pocket", "x402", "mcp"] as const;

export interface ReviewsConfig {
  baseUrl: string;
  key?: string;
}

/** AGENTSEARCH_REVIEWS_URL overrides the board URL; the key comes from AGENTSEARCH_REVIEW_KEY or ~/.agentsearch/review-key. */
export function loadReviewsConfig(): ReviewsConfig {
  const baseUrl = (process.env.AGENTSEARCH_REVIEWS_URL?.trim() || DEFAULT_REVIEWS_URL).replace(/\/+$/, "");
  let key = process.env.AGENTSEARCH_REVIEW_KEY?.trim() || undefined;
  if (!key) {
    try {
      key = readFileSync(join(homedir(), ".agentsearch", "review-key"), "utf8").trim() || undefined;
    } catch {
      key = undefined;
    }
  }
  if (key && !/^asrb_[A-Za-z0-9_-]{20,80}$/.test(key)) key = undefined;
  return { baseUrl, key };
}

async function call(cfg: ReviewsConfig, path: string, init?: RequestInit, useKey = false): Promise<unknown> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": `${SERVER_NAME}/${SERVER_VERSION}`,
  };
  if (init?.body) headers["content-type"] = "application/json";
  if (useKey && cfg.key) headers.authorization = `Bearer ${cfg.key}`;
  const res = await fetch(`${cfg.baseUrl}${path}`, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new AgentSearchHttpError(res.status, text || res.statusText);
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

export interface LookupArgs {
  task?: string;
  service_id?: string;
  max_price_usd?: number;
  network?: string;
  limit?: number;
  include_down?: boolean;
}

export function reviewLookup(cfg: ReviewsConfig, a: LookupArgs): Promise<unknown> {
  if (a.service_id) return call(cfg, `/v1/services/${encodeURIComponent(a.service_id)}`);
  const q = new URLSearchParams();
  if (a.task) q.set("task", a.task);
  if (a.network) q.set("network", a.network);
  if (a.max_price_usd !== undefined) q.set("max_price_usd", String(a.max_price_usd));
  if (a.include_down) q.set("include_down", "true");
  q.set("limit", String(a.limit ?? 5));
  return call(cfg, `/v1/services?${q.toString()}`);
}

export interface SubmitArgs {
  service_id: string;
  task?: string;
  success: boolean;
  latency_ms?: number;
  quality?: number;
  price_paid_usd?: number;
  note?: string;
  called_at?: string;
  proof_tx_hash?: string;
  pocket_session_id?: string;
}

export function reviewSubmit(cfg: ReviewsConfig, a: SubmitArgs): Promise<unknown> {
  const body: Record<string, unknown> = { service_id: a.service_id, success: a.success, client: `${SERVER_NAME}/${SERVER_VERSION}` };
  for (const k of ["task", "latency_ms", "quality", "price_paid_usd", "note", "called_at"] as const) {
    if (a[k] !== undefined) body[k] = a[k];
  }
  if (a.proof_tx_hash) body.proof = { type: "x402_base_tx", tx_hash: a.proof_tx_hash };
  else if (a.pocket_session_id) body.proof = { type: "pocket_session", session_id: a.pocket_session_id };
  return call(cfg, "/v1/reviews", { method: "POST", body: JSON.stringify(body) }, true);
}
