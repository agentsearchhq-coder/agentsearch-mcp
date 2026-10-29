# Installing AgentSearch MCP (for AI agents such as Cline)

No API key, account or env vars are needed for free web search (up to 25 searches/day per IP, up to 5 results per search).

Requirements: Node.js 20 or later (`npx` on PATH).

Add this entry to the MCP settings file (Cline: `cline_mcp_settings.json`):

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "npx",
      "args": ["-y", "@agentsearchhq/agentsearch-mcp"],
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Cline CLI alternative: `cline mcp add agentsearch --yes -- npx -y @agentsearchhq/agentsearch-mcp`

Verify: the server exposes `agentsearch_web_search`, `agentsearch_extract`, `agentsearch_render`, `agentsearch_review_lookup` and `agentsearch_review_submit`. Run a test search such as "Cline MCP settings".

Optional (paid, only if the user asks): `agentsearch_extract` ($0.005 per call) and `agentsearch_render` need `AGENTSEARCH_WALLET_PRIVATE_KEY` (a new wallet with a little USDC on Base) in the server's `env` block. Never invent or request a key on the user's behalf. Search stays free unless `AGENTSEARCH_MODE=paid` is also set.

Docs: https://agentsearchhq.com/mcp · Guide: https://agentsearchhq.com/blog/add-web-search-to-cline-mcp
