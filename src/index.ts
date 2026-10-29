#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract, agentsearch_render,
 *        agentsearch_review_lookup, agentsearch_review_submit
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { backendMode, searchMode } from "./backend.js";
import { hasWalletKey } from "./pocket.js";
import { loadReviewsConfig } from "./reviews-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  // Never log the wallet key; only the mode.
  const search = backendMode("search");
  const base =
    search === "self-hosted"
      ? `base=${process.env.AGENTSEARCH_BASE_URL!.trim().replace(/\/+$/, "")}`
      : searchMode() === "invalid"
        ? "AGENTSEARCH_MODE is invalid (use free, paid or auto): search calls will return an error until it is fixed"
        : search === "pocket"
          ? "search: pay-per-call via Pocket portal (x402, USDC on Base) because AGENTSEARCH_MODE opts in; extract/render pay per call too"
          : hasWalletKey()
            ? "search: AgentSearch free tier (up to 25 searches/day per IP, subject to shared daily capacity; set AGENTSEARCH_MODE=paid to pay for search); extract/render: pay-per-call via Pocket portal (x402, USDC on Base)"
            : "no wallet key or AGENTSEARCH_BASE_URL: search uses the AgentSearch free tier (up to 25 searches/day per IP, subject to shared daily capacity); extract/render need a wallet key";
  console.error(
    `agentsearch-mcp listening on stdio (${base}; reviews=${loadReviewsConfig().baseUrl})`
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentsearch-mcp failed to start: ${message}`);
  process.exit(1);
});
