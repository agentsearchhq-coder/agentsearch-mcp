# agentsearch-mcp

MCP (Model Context Protocol) server that exposes **AgentSearch** web search — and optional URL extract — to Cursor, Claude Desktop, and other MCP hosts over **stdio**.

[AgentSearch](https://agentsearchhq.com) is a web-search API aimed at agents. You can run it against a **local/self-hosted** AgentSearch instance (`direct` mode) or the **Pocket Network agent portal** (`portal` mode).

- Portal search endpoint (reference):  
  `POST https://agent.pocket.network/v1/agentsearch-web-search-v1/v1/search`  
  body: `{ "query": "...", "max_results": 5 }`
- Direct search: `POST {AGENTSEARCH_BASE_URL}/v1/search` with the same body  
- Direct extract: `POST {AGENTSEARCH_BASE_URL}/v1/extract`

Pocket explorer: [agentsearch-web-search-v1](https://explorer.pocket.network/service/agentsearch-web-search-v1)

> **Discovery:** This package is free to list and use. There is no paid promotion channel — discovery comes from MCP Registry / Smithery / Glama listings and real usage.

---

## Tools

| Tool | Args | Description |
|------|------|-------------|
| `agentsearch_web_search` | `query` (string, required), `max_results` (number, optional, default 5, clamped 1–10) | Calls the search backend; returns JSON text |
| `agentsearch_extract` | `url` (string), `formats` (string[], optional), `max_chars` (number, optional) | `POST /v1/extract` — **direct mode only** |

On portal **HTTP 402**, the search tool returns a clear MCP error that **x402 payment is required** (or switch to `AGENTSEARCH_MODE=direct`).

---

## Requirements

- Node.js **20+**
- An AgentSearch backend for `direct` mode (default `http://127.0.0.1:8000`), **or** portal access for `portal` mode

---

## Install & build

```bash
cd agentsearch-mcp
npm install
npm run build
```

Scripts: `build` → `tsc`, `start` → `node dist/index.js`, `prepare` → runs build (for publish).

Binary: `agentsearch-mcp` → `dist/index.js`

---

## Environment variables

| Variable | Default | Notes |
|----------|---------|--------|
| `AGENTSEARCH_MODE` | `direct` | `direct` \| `portal` |
| `AGENTSEARCH_BASE_URL` | `http://127.0.0.1:8000` | Direct mode base URL (no trailing slash) |
| `AGENTSEARCH_API_KEY` | _(empty)_ | Optional `Authorization: Bearer …` for direct; on **401** the client retries once **without** the key |

See `.env.example`. Never commit a real `.env`.

---

## Cursor `mcp.json`

**Project** (`.cursor/mcp.json`) or **user** (`~/.cursor/mcp.json` / Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "node",
      "args": [
        "C:/Users/Holla/OneDrive/Desktop/AgentSearch/agentsearch-mcp/dist/index.js"
      ],
      "env": {
        "AGENTSEARCH_MODE": "direct",
        "AGENTSEARCH_BASE_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

After `npm install && npm run build`, optionally use the bin:

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "npx",
      "args": ["-y", "agentsearch-mcp"],
      "env": {
        "AGENTSEARCH_MODE": "direct",
        "AGENTSEARCH_BASE_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

(Local path form is recommended until the package is published to npm.)

Optional API key (direct only):

```json
"env": {
  "AGENTSEARCH_MODE": "direct",
  "AGENTSEARCH_BASE_URL": "http://127.0.0.1:8000",
  "AGENTSEARCH_API_KEY": "your-key-here"
}
```

---

## Claude Desktop

Edit Claude Desktop config (`claude_desktop_config.json`):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "node",
      "args": [
        "C:/Users/Holla/OneDrive/Desktop/AgentSearch/agentsearch-mcp/dist/index.js"
      ],
      "env": {
        "AGENTSEARCH_MODE": "direct",
        "AGENTSEARCH_BASE_URL": "http://127.0.0.1:8000"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Local run (smoke)

```bash
npm run build
# MCP hosts spawn the process; for a quick boot check:
node dist/index.js
# (process waits on stdin — Ctrl+C to stop)
```

---

## Publish (high level)

No paid promo — list the package so tools can discover it via registries and usage.

### npm

1. `npm login`
2. Confirm `name` / `version` in `package.json`
3. `npm publish --access public` (ensure `prepare`/`build` succeed; no secrets in the tarball)

### MCP Registry

1. Ensure `server.json` matches your npm package + stdio transport
2. Follow the [MCP Registry](https://github.com/modelcontextprotocol/registry) publish flow (authenticate publisher, submit server metadata)
3. Verify the listing resolves `agentsearch-mcp` / stdio

### Smithery

Publish with the durable helper (preferred):

```bash
npm run smithery:publish
```

That runs `scripts/publish-smithery.mjs`, which ensures `agentsearch-mcp.mcpb` exists (`npm run mcpb:pack` if missing), idempotently patches the global Smithery CLI so the deploy payload always includes a tool `inputSchema` object when the MCPB omitted it, then runs `smithery mcp publish ./agentsearch-mcp.mcpb -n agentsearchhq/agentsearch-mcp`.

**MCPB note:** `manifest.json` must **omit** tool `inputSchema` — `mcpb validate` rejects it. The publish helper patches the CLI payload side instead.

Manual equivalent (after CLI is patched):

```bash
npm run mcpb:pack
smithery mcp publish ./agentsearch-mcp.mcpb -n agentsearchhq/agentsearch-mcp
```

`npm run mcpb:pack` compiles TypeScript to `dist/index.js`, installs production dependencies, then writes `agentsearch-mcp.mcpb`. Check the manifest with `npm run mcpb:validate`. `manifest.json` (MCPB 0.3) launches `node ${__dirname}/dist/index.js` and maps optional `AGENTSEARCH_MODE` (default `direct`), `AGENTSEARCH_BASE_URL` (default `http://127.0.0.1:8000`), and sensitive `AGENTSEARCH_API_KEY`. `smithery.yaml` remains as start-command metadata. Dry-run patch detection only: `node scripts/publish-smithery.mjs --dry-patch`.

### Glama

1. Submit the GitHub (or npm) package to [Glama](https://glama.ai) MCP directory
2. Link README + tools list; keep env docs in sync

---

## License

MIT
