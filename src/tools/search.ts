import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AgentSearchHttpError,
  clampMaxResults,
  loadConfig,
  webSearch,
  extractPage,
} from "../client.js";

function formatResult(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function errorContent(err: unknown): {
  content: { type: "text"; text: string }[];
  isError: true;
} {
  let text: string;
  if (err instanceof AgentSearchHttpError) {
    text = err.message;
  } else if (err instanceof Error) {
    text = err.message;
  } else {
    text = String(err);
  }
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "agentsearch_web_search",
    {
      title: "AgentSearch Web Search",
      description:
        "Search the web via AgentSearch. Uses AGENTSEARCH_MODE=direct (local API) or portal (Pocket). Returns structured JSON results.",
      inputSchema: {
        query: z.string().min(1).describe("Search query string"),
        max_results: z
          .number()
          .int()
          .optional()
          .describe("Max results to return (1–10, default 5)"),
      },
    },
    async ({ query, max_results }) => {
      try {
        const cfg = loadConfig();
        const clamped = clampMaxResults(max_results);
        const data = await webSearch(cfg, {
          query,
          max_results: clamped,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: formatResult(data),
            },
          ],
        };
      } catch (err) {
        return errorContent(err);
      }
    }
  );

  server.registerTool(
    "agentsearch_extract",
    {
      title: "AgentSearch Extract",
      description:
        "Extract page content from a URL via AgentSearch POST /v1/extract (direct mode only).",
      inputSchema: {
        url: z.string().url().describe("Absolute URL to extract"),
        formats: z
          .array(z.string())
          .optional()
          .describe('Optional formats, e.g. ["markdown","text"]'),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional max characters to return"),
      },
    },
    async ({ url, formats, max_chars }) => {
      try {
        const cfg = loadConfig();
        const data = await extractPage(cfg, { url, formats, max_chars });
        return {
          content: [
            {
              type: "text" as const,
              text: formatResult(data),
            },
          ],
        };
      } catch (err) {
        return errorContent(err);
      }
    }
  );
}
