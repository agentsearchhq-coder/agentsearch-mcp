#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract, agentsearch_render,
 *        agentsearch_review_lookup, agentsearch_review_submit
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { hasBaseUrl } from "./client.js";
import { loadReviewsConfig } from "./reviews-client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  const base = hasBaseUrl()
    ? `base=${process.env.AGENTSEARCH_BASE_URL!.trim().replace(/\/+$/, "")}`
    : "AGENTSEARCH_BASE_URL not set: search/extract/render will return a setup error";
  console.error(
    `agentsearch-mcp listening on stdio (${base}; reviews=${loadReviewsConfig().baseUrl})`
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentsearch-mcp failed to start: ${message}`);
  process.exit(1);
});
