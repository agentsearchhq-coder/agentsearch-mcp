# AgentSearch

MCP server for live web search, URL-to-markdown extract, headless JS render, and search_and_read.

- Default (no env): free keyless `agentsearch_web_search` (up to 25/day per IP) and a small extract/render trial. Review Board tools need no setup.
- Paid: set `AGENTSEARCH_WALLET_PRIVATE_KEY` (a dedicated Base USDC wallet). Calls go to https://api.agentsearchhq.com (direct x402): extract $0.007, render $0.010, search_and_read $0.015. Search stays free unless `AGENTSEARCH_MODE=paid` ($0.008). Docs: https://agentsearchhq.com/docs/x402
- Prefer `agentsearch_search_and_read` when you need hits and page text in one payment ($0.015). Otherwise: free search, then extract, then render only for JS-heavy pages.
