#!/usr/bin/env node
/**
 * AgentSearch MCP server — stdio transport.
 * Tools: agentsearch_web_search, agentsearch_extract
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchTools } from "./tools/search.js";
import { loadConfig } from "./client.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const server = new McpServer({
    name: "agentsearch-mcp",
    version: "1.0.0",
  });

  registerSearchTools(server);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout is reserved for MCP JSON-RPC; log to stderr only
  console.error(
    `agentsearch-mcp listening on stdio (mode=${cfg.mode}, base=${cfg.baseUrl})`
  );
}

main().catch((err) => {
  console.error("agentsearch-mcp failed to start:", err);
  process.exit(1);
});
