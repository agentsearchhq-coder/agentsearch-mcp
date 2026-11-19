#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract, agentsearch_render, agentsearch_search_and_read, agentsearch_news_search, agentsearch_screenshot,
 *        agentsearch_review_lookup, agentsearch_review_submit
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { backendMode, searchMode, searchModeLabel } from "./backend.js";
import { walletSource } from "./pocket.js";
import { paidRoute } from "./route.js";
import { loadReviewsConfig } from "./reviews-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  // Never log the wallet key; only the mode.
  const search = backendMode("search");
  const extract = backendMode("extract");
  const base =
    search === "self-hosted"
      ? `base=${process.env.AGENTSEARCH_BASE_URL!.trim().replace(/\/+$/, "")}`
      : searchMode() === "invalid"
        ? "AGENTSEARCH_MODE is invalid (use auto, free or paid): search calls will return an error until it is fixed"
        : paidRoute() === "invalid"
          ? "AGENTSEARCH_PAYMENT_ROUTE is invalid (use direct or pocket): paid calls will return an error until it is fixed"
          : `search mode: ${searchModeLabel()}; extract/render: ${
              extract === "direct"
                ? `paid via AgentSearch's own x402 API on Base (extract $0.002, render $0.005; wallet from ${walletSource()})`
                : extract === "pocket"
                  ? `paid via the Pocket portal ($0.005 per call; wallet from ${walletSource()})`
                  : "free trial (5/3 calls per day per IP) unless AGENTSEARCH_FREE_TRIAL=0"
            }`;
  console.error(
    `agentsearch-mcp listening on stdio (${base}; reviews=${loadReviewsConfig().baseUrl})`
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentsearch-mcp failed to start: ${message}`);
  process.exit(1);
});
