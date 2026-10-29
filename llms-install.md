# Install AgentSearch MCP in Cline

AgentSearch is a stdio MCP server (`@agentsearchhq/agentsearch-mcp`) for web search, turning a URL into markdown (extract), rendering JavaScript-heavy pages, and the AgentSearch Review Board. Free search works with no API key and no signup.

This file is enough to add the server in Cline. Do not clone the repo and do not build from source.

## Requirements

- Node.js 20 or newer, which includes `npx`. Check with `node -v`.

## 1. Zero-config install

Add an `agentsearch` entry under `mcpServers` in Cline's MCP settings. Keep every server already in the file.

- IDE (VS Code, Cursor, JetBrains): MCP Servers icon → Configure → **Configure MCP Servers**.
- Cline CLI: `~/.cline/data/settings/cline_mcp_settings.json` (or `CLINE_MCP_SETTINGS_PATH` if set).

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

Save the file. Cline starts the server over stdio. No restart of the whole app is required after the settings file is saved.

On Windows, if `npx` cannot be launched directly, use `"command": "cmd"` and `"args": ["/c", "npx", "-y", "@agentsearchhq/agentsearch-mcp"]`.

## 2. Confirm the five tools

After the server connects, it lists exactly these tools:

- `agentsearch_web_search`
- `agentsearch_extract`
- `agentsearch_render`
- `agentsearch_review_lookup`
- `agentsearch_review_submit`

With nothing else configured:

- `agentsearch_web_search` works immediately (free relay, no API key, no signup, no wallet).
- `agentsearch_review_lookup` and `agentsearch_review_submit` work immediately. No key.
- `agentsearch_extract` and `agentsearch_render` are listed, but they return setup instructions and make no network call until a wallet key or a self-hosted base URL is set.

## Free tier

Free search is per IP: up to 25 searches/day per IP, subject to shared daily capacity. It resets daily. There is no account. When the limit is hit, the tool explains how to switch that call to paid search.

The two review tools stay free with no configuration. The board is https://reviews.agentsearchhq.com.

## 3. Optional paid search, extract, and render

Paid calls go through the [Pocket Network Agentic Portal](https://agent.pocket.network) and pay **$0.005 per call** in USDC on Base over [x402](https://x402.org). No AgentSearch account, no API key, and no ETH for gas. The server never signs more than $0.005 per call.

Use a new wallet that holds only what you are willing to spend. The private key is stored in plain text in the Cline config and is used only to sign payments.

Set the wallet key and a session spend cap on the same `agentsearch` entry:

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "npx",
      "args": ["-y", "@agentsearchhq/agentsearch-mcp"],
      "env": {
        "AGENTSEARCH_WALLET_PRIVATE_KEY": "0xYOUR_DEDICATED_WALLET_KEY",
        "AGENTSEARCH_MAX_TOTAL_ATOMIC": "1000000"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

| Variable | Role |
|----------|------|
| `AGENTSEARCH_WALLET_PRIVATE_KEY` | Private key (64 hex, `0x` optional) of a dedicated wallet with a little USDC on Base. Alias: `POCKET_PRIVATE_KEY`. |
| `AGENTSEARCH_MAX_TOTAL_ATOMIC` | Session spend cap in USDC atomic units. `1000000` = $1.00 (the default). Alias: `POCKET_MAX_TOTAL_ATOMIC`. |
| `AGENTSEARCH_MAX_PER_CALL_ATOMIC` | Optional. Can only lower the per-call cap; default and maximum `5000` ($0.005). Alias: `POCKET_MAX_PER_CALL_ATOMIC`. |
| `AGENTSEARCH_MODE` | Search only. Leave unset (or `free`) to keep search on the free relay. Set to `paid` to pay $0.005 per search call. A wallet key alone does **not** make search paid. |

A wallet key enables `agentsearch_extract` and `agentsearch_render` at $0.005 per call. Search stays free until you also set `"AGENTSEARCH_MODE": "paid"`. Leave `autoApprove` empty so Cline asks before a tool runs; the caps above are what limit spend if it does not.

Fund the wallet with a little USDC **on Base** (for example $1, enough for 200 calls). Save the settings file again so Cline restarts the server with the new env.

## Optional self-hosted API

To use your own AgentSearch-compatible API and skip payment, set `AGENTSEARCH_BASE_URL` (no trailing slash). It takes precedence over the free relay and the paid portal. `AGENTSEARCH_API_KEY` is an optional bearer token. The free relay URL serves search only; do not point `AGENTSEARCH_BASE_URL` at it if you need extract or render.
