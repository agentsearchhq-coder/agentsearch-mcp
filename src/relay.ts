/** Free AgentSearch relay: search only, up to 25 searches/day per IP, subject to shared daily capacity, no key or wallet needed. */
import { AgentSearchHttpError, requestTimeoutMs, type SearchRequest } from "./client.js";
import { hasWalletKey } from "./pocket.js";

export const FREE_RELAY_URL = "https://relay.agentsearchhq.com";
export const FREE_RELAY_DAILY_LIMIT = 25;

const ADD_WALLET =
  "To add a wallet: set AGENTSEARCH_WALLET_PRIVATE_KEY (or POCKET_PRIVATE_KEY) to the 64-hex private key of a NEW wallet made only for this, in the env block of this MCP server in your client config, fund it with a little USDC on Base (for example $1; no ETH needed), and restart the client. A wallet key alone enables Extract and Render; search stays on the free tier unless you also set AGENTSEARCH_MODE=paid.";

export const FREE_RELAY_LIMIT_MESSAGE = [
  `Free search limit reached: the free AgentSearch relay allows up to ${FREE_RELAY_DAILY_LIMIT} searches/day per IP, subject to shared daily capacity. It resets daily.`,
  "Upgrade to paid search (plus agentsearch_extract and agentsearch_render): each search or extract call costs $0.005 in USDC on Base via the Pocket Network Agentic Portal (https://agent.pocket.network) over x402.",
  ADD_WALLET,
  "Or set AGENTSEARCH_BASE_URL to your own self-hosted AgentSearch-compatible API.",
].join(" ");

export function paidOnlyMessage(tool: "agentsearch_extract" | "agentsearch_render"): string {
  return [
    `${tool} is a paid tool${tool === "agentsearch_extract" ? ": $0.005 per call" : ""} in USDC on Base, paid over x402 through the Pocket Network Agentic Portal (https://agent.pocket.network). No wallet is configured, so no call was made.`,
    `The free relay covers agentsearch_web_search only (up to ${FREE_RELAY_DAILY_LIMIT} searches/day per IP, subject to shared daily capacity).`,
    ADD_WALLET,
    "Spending is capped per call and AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00). Or set AGENTSEARCH_BASE_URL to your own self-hosted AgentSearch-compatible API.",
    "The review tools (agentsearch_review_lookup, agentsearch_review_submit) are free and need no setup.",
  ].join(" ");
}

/** Limit message when a wallet is already configured: only the search mode needs to change. */
export const FREE_RELAY_LIMIT_MESSAGE_WITH_WALLET = [
  `Free search limit reached: the free AgentSearch relay allows up to ${FREE_RELAY_DAILY_LIMIT} searches/day per IP, subject to shared daily capacity. It resets daily.`,
  "A wallet key is configured, but search is in free mode (the default). To pay $0.005 per search call instead (capped per call and by AGENTSEARCH_MAX_TOTAL_ATOMIC per session, default $1.00), set AGENTSEARCH_MODE=paid in the env block of this MCP server and restart the client.",
].join(" ");

/** Search through the free relay. Throws AgentSearchHttpError(429, FREE_RELAY_LIMIT_MESSAGE) when the daily limit is hit. */
export async function relaySearch(req: SearchRequest): Promise<unknown> {
  const body: Record<string, unknown> = { query: req.query };
  if (req.max_results !== undefined) body.max_results = req.max_results;
  const res = await fetch(`${FREE_RELAY_URL}/v1/search`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs()),
  });
  const text = await res.text();
  if (res.status === 429) throw new AgentSearchHttpError(429, hasWalletKey() ? FREE_RELAY_LIMIT_MESSAGE_WITH_WALLET : FREE_RELAY_LIMIT_MESSAGE);
  if (!res.ok) throw new AgentSearchHttpError(res.status, text || res.statusText);
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
  // Keep results provider-neutral.
  if (data && typeof data === "object" && !Array.isArray(data)) delete (data as Record<string, unknown>).provider;
  return data;
}
