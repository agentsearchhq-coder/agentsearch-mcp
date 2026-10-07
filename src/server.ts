import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerSearchTools } from "./tools/search.js";
import { registerRenderTool } from "./tools/render.js";
import { registerReviewTools } from "./tools/reviews.js";
import { SERVER_NAME, SERVER_VERSION } from "./version.js";

/** Build the MCP server with every AgentSearch tool registered (no transport). */
export function createServer(): McpServer {
  const server = new McpServer({
    name: SERVER_NAME,
    version: SERVER_VERSION,
  });
  registerSearchTools(server);
  registerRenderTool(server);
  registerReviewTools(server);
  return server;
}
