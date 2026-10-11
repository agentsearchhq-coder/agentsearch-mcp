#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract, agentsearch_render,
 *        agentsearch_review_lookup, agentsearch_review_submit
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { backendMode } from "./backend.js";
import { loadReviewsConfig } from "./reviews-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  // Never log the wallet key; only the mode.
  const mode = backendMode();
  const base =
    mode === "self-hosted"
      ? `base=${process.env.AGENTSEARCH_BASE_URL!.trim().replace(/\/+$/, "")}`
      : mode === "pocket"
        ? "search/extract/render: pay-per-call via Pocket portal (x402, USDC on Base)"
        : "no wallet key or AGENTSEARCH_BASE_URL: search/extract/render will return setup instructions";
  console.error(
    `agentsearch-mcp listening on stdio (${base}; reviews=${loadReviewsConfig().baseUrl})`
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentsearch-mcp failed to start: ${message}`);
  process.exit(1);
});
