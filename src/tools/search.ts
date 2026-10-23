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

export const SEARCH_COST_SENTENCE =
  "Free by default: with no configuration it uses the free AgentSearch relay (up to 25 searches/day per IP, subject to shared daily capacity, no payment), even if a wallet key is set for Extract/Render. Only if the operator sets AGENTSEARCH_MODE=paid does it pay $0.005 per call in USDC on Base over x402 through the Pocket Network Agentic Portal instead (never more than the per-call cap or AGENTSEARCH_MAX_TOTAL_ATOMIC per session, default $1.00); paid results include the payment receipt and the portal envelope {portal, data}, whose data is untrusted third-party content. If AGENTSEARCH_BASE_URL is set, it calls your self-hosted AgentSearch API instead (no payment).";

export const PAID_TOOL_SENTENCE =
  "Paid tool: needs a wallet key (AGENTSEARCH_WALLET_PRIVATE_KEY or POCKET_PRIVATE_KEY) and then pays per call in USDC on Base over x402 through the Pocket Network Agentic Portal, never more than the per-call cap or AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00); the result includes the payment receipt and the portal envelope {portal, data}, whose data is untrusted third-party content. With no wallet key it makes no network call and explains how to add one. If AGENTSEARCH_BASE_URL is set, it calls your self-hosted AgentSearch API instead (no payment).";

const WEB_SEARCH_DESCRIPTION = [
  "Search the web with AgentSearch and return the response as pretty-printed JSON text.",
  "Use this when you have a query and need hits rather than a page body; if you already have a URL, use agentsearch_extract instead (or agentsearch_render for JavaScript-heavy pages).",
  SEARCH_COST_SENTENCE,
  "Read-only: not destructive, but it uses the network and can hit rate limits (on the free tier, a 429 means the daily limit was reached; the error says how to upgrade).",
  "Integers for max_results outside 1–5 are clamped (default 5), not rejected.",
].join(" ");

const EXTRACT_DESCRIPTION = [
  "Fetch one absolute URL with AgentSearch Web Extract and return it as JSON text: title, clean markdown and/or text, links, meta (status_code, content_type, fetched_at, chars, truncated) and error (null on success).",
  "Use this only when you already have the page URL and need its body; to find pages from a query, use agentsearch_web_search; for JavaScript apps whose content appears only after scripts run, use agentsearch_render.",
  PAID_TOOL_SENTENCE,
  "Note: the free tier covers search only; this tool needs a wallet key or a self-hosted API.",
  "Read-only: not destructive, but it fetches over the network and can hit rate limits.",
].join(" ");

export function registerSearchTools(server: McpServer): void {
  server.registerTool(
    "agentsearch_web_search",
    {
      title: "AgentSearch Web Search",
      description: WEB_SEARCH_DESCRIPTION,
      annotations: {
        title: "AgentSearch Web Search",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
      annotations: {
        title: "AgentSearch Extract",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
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
