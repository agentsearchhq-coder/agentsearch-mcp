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

const WEB_SEARCH_DESCRIPTION = [
  "Search the web through AgentSearch and return the backend response as pretty-printed JSON text (a non-JSON body is wrapped as {raw: text}).",
  "Use this when you have a query and need hits rather than a page body; if you already have a URL, use agentsearch_extract instead.",
  "Works in AGENTSEARCH_MODE=direct (default; POST {AGENTSEARCH_BASE_URL}/v1/search) or portal (Pocket).",
  "Read-only HTTP POST: not destructive, but it uses the network and can hit backend rate limits.",
  "Direct mode sends a Bearer token from AGENTSEARCH_API_KEY when that variable is set, and retries once without the key on HTTP 401; portal ignores the key, and HTTP 402 is an MCP error that x402 payment is required (or switch to direct).",
  "Other HTTP failures are MCP errors with the status and a truncated body.",
  "Integers for max_results outside 1–10 are clamped (default 5), not rejected.",
].join(" ");

const EXTRACT_DESCRIPTION = [
  "Extract the content of one absolute URL through AgentSearch and return the backend response as pretty-printed JSON text (a non-JSON body is wrapped as {raw: text}).",
  "Use this only when you already have the page URL and need its body; to find pages from a query, use agentsearch_web_search instead.",
  "Direct mode only: AGENTSEARCH_MODE=portal fails immediately with an MCP error telling you to switch to direct or call search, and no HTTP request is sent; direct mode POSTs {AGENTSEARCH_BASE_URL}/v1/extract.",
  "Read-only HTTP POST: not destructive, but it fetches through AgentSearch and can hit network or backend rate limits.",
  "When AGENTSEARCH_API_KEY is set it is sent as a Bearer token, and HTTP 401 is retried once without the key; HTTP 402 is an MCP error that x402 payment is required (or switch to direct), and any other HTTP failure includes the status and a truncated body.",
  'formats, when provided, is forwarded unchanged (for example "markdown" or "text") and is not limited to an enum; max_chars, when set, is a positive integer cap sent to the API rather than applied by this server.',
].join(" ");

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "agentsearch_web_search",
    {
      title: "AgentSearch Web Search",
      description: WEB_SEARCH_DESCRIPTION,
      inputSchema: {
        query: z
          .string()
          .min(1)
          .describe("Keywords or a natural-language question to search for."),
        max_results: z
          .number()
          .int()
          .optional()
          .describe("How many hits to request (1–10, default 5)."),
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
      description: EXTRACT_DESCRIPTION,
      inputSchema: {
        url: z.string().url().describe("Absolute URL of the page to extract."),
        formats: z
          .array(z.string())
          .optional()
          .describe('Optional format names to request, e.g. ["markdown","text"].'),
        max_chars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Optional positive limit on extracted characters."),
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
