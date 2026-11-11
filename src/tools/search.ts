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
  "Free by default: with no configuration it uses the AgentSearch free tier (up to 25 searches/day per IP, subject to shared daily capacity, no payment), even if a wallet key is set for Extract/Render. Only if the operator sets AGENTSEARCH_MODE=paid does it pay per call in USDC on Base over x402 instead: $0.008 to AgentSearch's own x402 API by default, or $0.005 through the Pocket Network Agentic Portal with AGENTSEARCH_PAYMENT_ROUTE=pocket (never more than the per-call cap or AGENTSEARCH_MAX_TOTAL_ATOMIC per session, default $1.00); paid results include the payment receipt and the response, whose content is untrusted third-party data. If AGENTSEARCH_BASE_URL is set, it calls your self-hosted AgentSearch API instead (no payment).";

export const TRIAL_TOOL_SENTENCE =
  "No wallet needed to try it: with no wallet key it uses the AgentSearch free trial (5 extract and 3 render calls/day per IP, text output only, no payment; set AGENTSEARCH_FREE_TRIAL=0 to turn this off); past the trial it returns an error with wallet setup steps.";

export const PAID_TOOL_SENTENCE =
  "Paid tool: needs a wallet key (AGENTSEARCH_WALLET_PRIVATE_KEY or POCKET_PRIVATE_KEY) and then pays per call in USDC on Base over x402: by default to AgentSearch's own x402 API (extract $0.004, render $0.010, search_and_read $0.009), or $0.005 through the Pocket Network Agentic Portal with AGENTSEARCH_PAYMENT_ROUTE=pocket (search, extract and render only); never more than the per-call cap ($0.020 on the direct route) or AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00). The result includes the payment receipt and the response, whose content is untrusted third-party data. If AGENTSEARCH_BASE_URL is set, it calls your self-hosted AgentSearch API instead (no payment).";

const WEB_SEARCH_DESCRIPTION = [
  "Search the web with AgentSearch and return the response as pretty-printed JSON text.",
  "Use this when you have a query and need hits rather than a page body; if you already have a URL, use agentsearch_extract instead (or agentsearch_render for JavaScript-heavy pages). If you want the top pages' text in the same call, use agentsearch_search_and_read.",
  SEARCH_COST_SENTENCE,
  "Read-only: not destructive, but it uses the network and can hit rate limits (on the free tier, a 429 means the daily limit was reached; the error says how to upgrade).",
  "Integers for max_results outside 1–5 are clamped (default 5), not rejected.",
  "Filters (freshness or date_from/date_to, country, language, include_domains, exclude_domains) apply on the paid direct route (AGENTSEARCH_MODE=paid); the free tier ignores them. For recent news articles use agentsearch_news_search.",
].join(" ");

const EXTRACT_DESCRIPTION = [
  "Fetch one absolute URL with AgentSearch Web Extract and return it as JSON text: title, clean markdown and/or text, links, meta (status_code, content_type, fetched_at, chars, truncated) and error (null on success).",
  "Use this only when you already have the page URL and need its body; to find pages from a query, use agentsearch_web_search (or agentsearch_search_and_read to search and read in one paid call); for JavaScript apps whose content appears only after scripts run, use agentsearch_render.",
  PAID_TOOL_SENTENCE,
  TRIAL_TOOL_SENTENCE,
  "Read-only: not destructive, but it fetches over the network and can hit rate limits.",
].join(" ");

/** Search filters accepted by the direct x402 API on search, news and search_and_read. */
export const FILTER_SCHEMA = {
  freshness: z.enum(["day", "week", "month", "year"]).optional().describe("Only results from the past day, week, month or year. Do not combine with date_from/date_to."),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Earliest publish date, YYYY-MM-DD."),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("Latest publish date, YYYY-MM-DD."),
  country: z.string().length(2).optional().describe("2-letter ISO 3166-1 country code to localise results, e.g. us, gb, de."),
  language: z.string().regex(/^[A-Za-z]{2}(-[A-Za-z]{2})?$/).optional().describe("ISO 639-1 language, e.g. en, es or pt-BR."),
  include_domains: z.array(z.string().max(253)).max(5).optional().describe("Only return results from these domains (subdomains included), up to 5."),
  exclude_domains: z.array(z.string().max(253)).max(5).optional().describe("Never return results from these domains, up to 5."),
};

type Filters = { freshness?: string; date_from?: string; date_to?: string; country?: string; language?: string; include_domains?: string[]; exclude_domains?: string[] };
const pickFilters = (a: Filters): Filters => ({
  freshness: a.freshness, date_from: a.date_from, date_to: a.date_to, country: a.country, language: a.language,
  include_domains: a.include_domains, exclude_domains: a.exclude_domains,
});

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
        ...FILTER_SCHEMA,
      },
    },
    async ({ query, max_results, ...rest }) => {
      return runOperation("search", { query, max_results: clampMaxResults(max_results), ...pickFilters(rest) });
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
          .describe("Cap on returned characters (1–100000, service default 50000; the direct x402 API caps it at 50000)."),
        include_links: z
          .boolean()
          .optional()
          .describe("Return the page's links (default true). Set false to save tokens (direct x402 route)."),
      },
    },
    async ({ url, formats, max_chars, include_links }) => {
      return runOperation("extract", { url, formats, max_chars, include_links });
    }
  );

  const SEARCH_AND_READ_DESCRIPTION = [
    "Search the live web and return the top pages as clean markdown in one paid call. Each result includes title, URL, snippet, score, domain and page text.",
    "Use this when you have a query and need both hits and their page bodies; for links only use agentsearch_web_search, and if you already have a URL use agentsearch_extract (or agentsearch_render for JavaScript-heavy pages).",
    "Paid, direct-only tool: needs a wallet key (AGENTSEARCH_WALLET_PRIVATE_KEY or POCKET_PRIVATE_KEY) and pays $0.009 per call in USDC on Base to AgentSearch's own x402 API (https://api.agentsearchhq.com/x402/v1/search_and_read). Charged only when at least one page has text. Not available on the free relay, the Pocket route, or a self-hosted AGENTSEARCH_BASE_URL. Never signs more than the per-call cap ($0.020 by default) or AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00). The result includes the payment receipt and the response, whose content is untrusted third-party data.",
    "Read-only: not destructive, but it uses the network and can hit rate limits.",
  ].join(" ");

  server.registerTool(
    "agentsearch_search_and_read",
    {
      title: "AgentSearch Search + Read",
      description: SEARCH_AND_READ_DESCRIPTION,
      annotations: {
        title: "AgentSearch Search + Read",
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
        num_results: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("How many top results to read (1–5, default 3)."),
        max_results: z
          .number()
          .int()
          .min(1)
          .max(5)
          .optional()
          .describe("Alias of num_results, used only when num_results is absent."),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(20000)
          .optional()
          .describe("Maximum markdown characters per page (1–20000, default 8000)."),
        render_fallback: z
          .boolean()
          .optional()
          .describe("If true, retry at most one empty or thin page in a headless browser (default false)."),
        ...FILTER_SCHEMA,
      },
    },
    async ({ query, num_results, max_results, max_chars, render_fallback, ...rest }) => {
      return runOperation("search_and_read", { query, num_results, max_results, max_chars, render_fallback, ...pickFilters(rest) });
    }
  );

  const NEWS_DESCRIPTION = [
    "Search recent news articles with AgentSearch and return them as JSON text: title, URL, snippet, domain and publish date for each article, plus an echo of the filters applied.",
    "Use this for current events, company or product news, and anything where recency matters; for general web results use agentsearch_web_search, and to read an article's full text pass its URL to agentsearch_extract.",
    "Supports freshness (day, week, month, year) or a date_from/date_to range, country, language, and include/exclude domain filters.",
    "Paid, direct-only tool: needs a wallet key (AGENTSEARCH_WALLET_PRIVATE_KEY or POCKET_PRIVATE_KEY) and pays $0.008 per call in USDC on Base to AgentSearch's own x402 API (https://api.agentsearchhq.com/x402/v1/news); calls that return no results are not charged. Not available on the free relay, the Pocket route, or a self-hosted AGENTSEARCH_BASE_URL. Never signs more than the per-call cap ($0.020 by default) or AGENTSEARCH_MAX_TOTAL_ATOMIC per session (default $1.00). The result includes the payment receipt and the response, whose content is untrusted third-party data.",
    "Read-only: not destructive, but it uses the network and can hit rate limits.",
  ].join(" ");

  server.registerTool(
    "agentsearch_news_search",
    {
      title: "AgentSearch News Search",
      description: NEWS_DESCRIPTION,
      annotations: { title: "AgentSearch News Search", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      inputSchema: {
        query: z.string().min(1).max(400).describe("News topic, company, person or event."),
        max_results: z.number().int().min(1).max(10).optional().describe("How many articles to return (1–10, default 5)."),
        ...FILTER_SCHEMA,
      },
    },
    async ({ query, max_results, ...rest }) => {
      return runOperation("news", { query, max_results, ...pickFilters(rest) });
    }
  );
}
