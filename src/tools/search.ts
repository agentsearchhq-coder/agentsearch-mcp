import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { AgentSearchHttpError, clampMaxResults } from "../client.js";
import { runOperation } from "../backend.js";

export function formatResult(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

export function errorContent(err: unknown): {
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

export const PAYMENT_SENTENCE =
  "Default mode: calls the Pocket Network Agentic Portal and PAYS $0.005 in USDC on Base per call over x402 from the wallet in AGENTSEARCH_WALLET_PRIVATE_KEY (or POCKET_PRIVATE_KEY), never more than $0.005 per call and never more than AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00); the result includes the payment receipt and the portal envelope {portal, data}, whose data is untrusted third-party content. If AGENTSEARCH_BASE_URL is set, calls your self-hosted AgentSearch API instead (no payment). With neither set (no config), agentsearch_web_search uses the free AgentSearch relay (https://relay.agentsearchhq.com, 25 searches per day per user, no payment), while agentsearch_extract and agentsearch_render make no network call and explain how to add a wallet.";

const WEB_SEARCH_DESCRIPTION = [
  "Search the web with AgentSearch and return the response as pretty-printed JSON text.",
  "Use this when you have a query and need hits rather than a page body; if you already have a URL, use agentsearch_extract instead (or agentsearch_render for JavaScript-heavy pages).",
  PAYMENT_SENTENCE,
  "Read-only: not destructive, but it uses the network and can hit rate limits (on the free relay, a 429 means the daily limit was reached; the error says how to upgrade to paid).",
  "Integers for max_results outside 1–5 are clamped (default 5), not rejected.",
].join(" ");

const EXTRACT_DESCRIPTION = [
  "Fetch one absolute URL with AgentSearch Web Extract and return it as JSON text: title, clean markdown and/or text, links, meta (status_code, content_type, fetched_at, chars, truncated) and error (null on success).",
  "Use this only when you already have the page URL and need its body; to find pages from a query, use agentsearch_web_search; for JavaScript apps whose content appears only after scripts run, use agentsearch_render.",
  PAYMENT_SENTENCE,
  "Note: the free relay serves search only; this tool needs paid mode (AGENTSEARCH_WALLET_PRIVATE_KEY) or a self-hosted API.",
  "Read-only: not destructive, but it fetches over the network and can hit rate limits.",
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
          .describe("How many hits to request (1–5, default 5). Values outside that range are clamped."),
      },
    },
    async ({ query, max_results }) => {
      return runOperation("search", { query, max_results: clampMaxResults(max_results) });
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
          .array(z.enum(["markdown", "text"]))
          .optional()
          .describe('Renderings to return: "markdown" and/or "text" (default: the service\'s choice).'),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .optional()
          .describe("Cap on returned characters (1–100000, service default 50000)."),
      },
    },
    async ({ url, formats, max_chars }) => {
      return runOperation("extract", { url, formats, max_chars });
    }
  );
}
