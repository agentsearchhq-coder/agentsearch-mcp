# AgentSearch

MCP server for live web search, URL-to-markdown extract, headless JS render, search_and_read, news search and page screenshots.

- Default (no env): free keyless `agentsearch_web_search` (25 free searches per IP in total, then pay per call) and a small extract/render trial. Review Board tools need no setup.
- Paid: set `AGENTSEARCH_WALLET_PRIVATE_KEY` (a dedicated Base USDC wallet). Calls go to https://api.agentsearchhq.com (direct x402): extract $0.002, render $0.005, search_and_read $0.005, news $0.003, screenshot $0.004. Search, news and search_and_read accept freshness/date, country, language and domain filters. Search stays free unless `AGENTSEARCH_MODE=paid` ($0.003). Docs: https://agentsearchhq.com/docs/x402
- Prefer `agentsearch_search_and_read` when you need hits and page text in one payment ($0.005). Otherwise: free search, then extract, then render only for JS-heavy pages.
