#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract, agentsearch_render
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const server = createServer();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  console.error(
    `agentsearch-mcp listening on stdio (base=${cfg.baseUrl})`
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`agentsearch-mcp failed to start: ${message}`);
  process.exit(1);
});
