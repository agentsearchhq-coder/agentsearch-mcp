import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { runOperation } from "../backend.js";
import { PAYMENT_SENTENCE } from "./search.js";

export const RENDER_DESCRIPTION = [
  "Render one absolute http(s) URL in headless Chromium with AgentSearch Web Render, so JavaScript runs before content is captured, and return the backend response as pretty-printed JSON text (a non-JSON body is wrapped as {raw: text}).",
  "The response includes the final url, title, status_code, meta (render_ms, chars, truncated, js, lang …), warnings, error, and the rendered page body in each requested format: markdown (default), text, html, and/or links; plus an optional base64 screenshot.",
  "Use this when the page is a JavaScript-heavy app (SPA, client-rendered docs or dashboards) where agentsearch_extract returns empty or partial content; for static pages prefer agentsearch_extract (faster), and to find pages from a query use agentsearch_web_search.",
  PAYMENT_SENTENCE,
  "Note: the free relay (AGENTSEARCH_BASE_URL=https://relay.agentsearchhq.com) serves search only; this tool needs paid mode (AGENTSEARCH_WALLET_PRIVATE_KEY) or a self-hosted API.",
  "Read-only: it loads the page like a browser visit and does not click, submit, or change anything, but it uses the network, has a hard backend deadline of about 4.2 s, and can hit rate limits (HTTP 429).",
  "Target-site failures (DNS, TLS, timeouts, bot walls, robots.txt) come back as a normal result with a non-null error object {code, message, retryable} and empty or partial content; invalid input or a disallowed URL (HTTP 400, e.g. UPSTREAM_REJECTED), rate limits (429) and service faults (5xx) are MCP errors with the code and whether it is retryable.",
  "Optional fields are forwarded unchanged to the API, which applies its own defaults and limits.",
].join(" ");

export function registerRenderTool(server: McpServer): void {
  server.registerTool(
    "agentsearch_render",
    {
      title: "AgentSearch Web Render",
      description: RENDER_DESCRIPTION,
      annotations: {
        title: "AgentSearch Web Render",
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
      inputSchema: {
        url: z
          .string()
          .url()
          .max(4096)
          .describe("Absolute public http(s) URL to render (port 80/443)."),
        formats: z
          .array(z.enum(["markdown", "text", "html", "links"]))
          .optional()
          .describe(
            'Output formats to return (default ["markdown"]). Add "html" for the rendered DOM, "text" for plain text, "links" for anchors.'
          ),
        max_chars: z
          .number()
          .int()
          .min(1)
          .max(100000)
          .optional()
          .describe("Cap on returned characters per format (1–100000, API default 20000)."),
        screenshot: z
          .boolean()
          .optional()
          .describe("Also capture a screenshot, returned as base64 (default false)."),
        screenshot_format: z
          .enum(["png", "jpeg"])
          .optional()
          .describe("Screenshot encoding (default png; PNG over 1 MB is re-encoded as JPEG)."),
        full_page: z
          .boolean()
          .optional()
          .describe("Capture the full page height, clipped to 4000 px (default false)."),
        viewport: z
          .object({
            width: z
              .number()
              .int()
              .min(320)
              .max(1920)
              .optional()
              .describe("Viewport width in px (320–1920, default 1280)."),
            height: z
              .number()
              .int()
              .min(240)
              .max(1600)
              .optional()
              .describe("Viewport height in px (240–1600, default 800)."),
          })
          .optional()
          .describe("Browser viewport size."),
        wait_until: z
          .enum(["domcontentloaded", "load", "networkidle"])
          .optional()
          .describe("Navigation event to wait for before capture (default domcontentloaded)."),
        wait_for_selector: z
          .string()
          .max(300)
          .nullable()
          .optional()
          .describe("CSS selector to wait for (at most 1.5 s) before capture."),
        wait_ms: z
          .number()
          .int()
          .min(0)
          .max(1500)
          .optional()
          .describe("Extra fixed wait in ms after load (0–1500, default 0)."),
        block: z
          .array(z.enum(["image", "media", "font", "stylesheet"]))
          .optional()
          .describe('Resource types to block while rendering (default ["media","font"]).'),
      },
    },
    async (args) => {
      return runOperation("render", args);
    }
  );
}
