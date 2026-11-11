/**
 * Paid route (since 1.6.0). Paid calls default to AgentSearch's own x402 API on Base ("direct":
 * https://api.agentsearchhq.com, search $0.008, extract $0.004, render $0.010, paid to AgentSearch).
 * AGENTSEARCH_PAYMENT_ROUTE=pocket (or the 1.5.0 switch AGENTSEARCH_X402_DIRECT=0) keeps the
 * Pocket Network Agentic Portal ($0.005 per call). The free tier and the no-wallet free trial are not affected.
 */
export const ROUTE_ENV_VAR = "AGENTSEARCH_PAYMENT_ROUTE";
export const LEGACY_DIRECT_ENV_VAR = "AGENTSEARCH_X402_DIRECT";
export const PAID_ROUTES = ["direct", "pocket"] as const;
export type PaidRoute = (typeof PAID_ROUTES)[number];

/** Published prices per route, for messages only (the 402 terms are authoritative; the per-call ceilings are the guard). */
export const ROUTE_PRICES_USD: Record<PaidRoute, { search: string; extract: string; render: string }> = {
  direct: { search: "$0.008", extract: "$0.004", render: "$0.010" },
  pocket: { search: "$0.005", extract: "$0.005", render: "$0.005" },
};

export function paidRoute(): PaidRoute | "invalid" {
  const v = (process.env[ROUTE_ENV_VAR] ?? "").trim().toLowerCase();
  if (v) {
    if (v === "direct" || v === "x402" || v === "agentsearch") return "direct";
    if (v === "pocket" || v === "portal") return "pocket";
    return "invalid";
  }
  const legacy = (process.env[LEGACY_DIRECT_ENV_VAR] ?? "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(legacy)) return "pocket";
  return "direct";
}

export function invalidRouteMessage(): string {
  return `${ROUTE_ENV_VAR} must be 'direct' (default: AgentSearch's own x402 API) or 'pocket' (Pocket Network Agentic Portal), got ${JSON.stringify((process.env[ROUTE_ENV_VAR] ?? "").trim())}. Nothing was signed.`;
}

/** One sentence describing the paid route, shared by tool descriptions and messages. */
export const PAID_ROUTE_SENTENCE =
  "Paid calls go by default to AgentSearch's own x402 API on Base (https://api.agentsearchhq.com; search $0.008, extract $0.004, render $0.010 per call in USDC, no account, no API key, no ETH, failed calls not charged); set AGENTSEARCH_PAYMENT_ROUTE=pocket to pay through the Pocket Network Agentic Portal instead ($0.005 per call).";
