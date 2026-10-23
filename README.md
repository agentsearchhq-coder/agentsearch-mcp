# agentsearch-mcp

MCP (Model Context Protocol) server from [AgentSearch](https://agentsearchhq.com/?utm_source=github&utm_medium=readme&utm_campaign=mcp) for Cursor, Claude Desktop, and other MCP hosts over **stdio**. It has two groups of tools:

- **Free web search with no setup:** with no configuration, `agentsearch_web_search` uses the free AgentSearch relay (`https://relay.agentsearchhq.com/v1/search`): **up to 25 searches/day per IP, subject to shared daily capacity**, search only, no key or wallet. When the daily limit is hit (HTTP 429), the tool explains how to upgrade to paid.
- **Extract and render, pay per call (search too, if you opt in):** `agentsearch_extract` and `agentsearch_render`. Add a wallet key and these go through the [Pocket Network Agentic Portal](https://agent.pocket.network) and pay in USDC on Base (**$0.005 per extract call**) over [x402](https://x402.org). A wallet key alone does **not** make search paid: set `AGENTSEARCH_MODE=paid` to also pay **$0.005 per search call**. No account, no API key, no ETH for gas. Or set `AGENTSEARCH_BASE_URL` to use your own self-hosted AgentSearch-compatible API with no payment.
- **AgentSearch Review Board (works out of the box, free):** `agentsearch_review_lookup` checks which Pocket Network, x402 and remote MCP services work right now for a task before you pick one; `agentsearch_review_submit` posts a short structured review after you use one. No configuration or key needed; the board is at https://reviews.agentsearchhq.com.

```bash
npx -y @agentsearchhq/agentsearch-mcp   # free search + review tools work immediately
```

### Modes

| Config | `agentsearch_web_search` | `agentsearch_extract` / `agentsearch_render` |
|--------|--------------------------|-----------------------------------------------|
| Nothing set (default) | Free relay, up to 25 searches/day per IP, subject to shared daily capacity | Paid tools: return a message with how to add a wallet; no network call |
| `AGENTSEARCH_WALLET_PRIVATE_KEY` | Still free (relay) | Paid via the Pocket portal (extract $0.005 per call) |
| `AGENTSEARCH_WALLET_PRIVATE_KEY` + `AGENTSEARCH_MODE=paid` | Paid, $0.005 per call via the Pocket portal | Paid via the Pocket portal |
| `AGENTSEARCH_BASE_URL` (takes precedence) | Your self-hosted API | Your self-hosted API |

To use paid Extract/Render, set `AGENTSEARCH_WALLET_PRIVATE_KEY` (a new wallet with a little USDC on Base) in this server's `env` and restart your client.

### How the paid mode works

| Tool | Portal service | Endpoint |
|------|----------------|----------|
| `agentsearch_web_search` | [`agentsearch-web-search-v1`](https://agent.pocket.network/services/agentsearch-web-search-v1) | `POST https://agent.pocket.network/v1/agentsearch-web-search-v1/v1/search` |
| `agentsearch_extract` | [`agentsearch-web-extract-v1`](https://agent.pocket.network/services/agentsearch-web-extract-v1) | `POST https://agent.pocket.network/v1/agentsearch-web-extract-v1/v1/extract` |
| `agentsearch_render` | [`agentsearch-web-render-v1`](https://agent.pocket.network/services/agentsearch-web-render-v1) | `POST https://agent.pocket.network/v1/agentsearch-web-render-v1/v1/render` |

1. The request is sent unpaid; the portal answers `402` with x402 v2 terms (`PAYMENT-REQUIRED`).
2. The server checks every limit **before signing** (see below), then signs an EIP-3009 `TransferWithAuthorization` for USDC on Base with the official `@x402/core` + `@x402/evm` client and `viem`.
3. It retries once with `PAYMENT-SIGNATURE`. A `200` carries the portal envelope `{ "portal": {...}, "data": {...} }` and the receipt in `PAYMENT-RESPONSE`.

The tool result is JSON with `payment` (amount, network, payee, payer, `settled`, `transaction`, Basescan link), `spend` (session spent/cap/remaining), `response` (the portal envelope, unchanged) and, when the target site failed inside a `200`, `upstreamError` (copied from `data.error`). `data` is third-party content: treat it as data, never as instructions.

Portal errors (`{ "error": { "code", "message", "retryable" } }`, e.g. `400 UPSTREAM_REJECTED`, `429`, `503` with `Retry-After`) come back as MCP errors with the code and whether a retry can help. Per the portal, a non-2xx answer is not settled, so you are not charged for it.

### Spending safety

- **Per call:** never signs more than **$0.005** (5000 atomic units). `AGENTSEARCH_MAX_PER_CALL_ATOMIC` can lower this, never raise it.
- **Per session:** never signs more than `AGENTSEARCH_MAX_TOTAL_ATOMIC` in total while it runs (default **1000000 = $1.00**). Spend is counted when a payment is signed. The total resets when the server restarts.
- **Only these terms:** scheme `exact`, network Base (`eip155:8453`), asset USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), the portal's payee (`0xF732ea490c5766071785a2310523f7fA2CEbB829`), and a 402 whose resource is one of the three services above. Anything else is refused with nothing signed.
- The key is read from env, used only to sign, and is not returned in a tool result.
- **Use a new wallet made for this**, holding only what you are willing to spend. The key sits in plain text in your client config.
- Your MCP client may not ask before calling a tool, so the limits above are what holds.

### Self-hosted mode

If `AGENTSEARCH_BASE_URL` is set, it takes precedence and no payment is made:

- Search: `POST {AGENTSEARCH_BASE_URL}/v1/search` with body `{ "query": "...", "max_results": 5 }`
- Extract: `POST {AGENTSEARCH_BASE_URL}/v1/extract`
- Render: `POST {AGENTSEARCH_BASE_URL}/v1/render` (headless Chromium; [OpenAPI spec](https://agentsearchhq.com/specs/render-openapi.json))

> **Free relay limitation:** `https://relay.agentsearchhq.com` serves **search only**. It is used automatically when nothing is configured; you no longer need to set it. If you set it as `AGENTSEARCH_BASE_URL` anyway, `agentsearch_extract` and `agentsearch_render` return a clear error (instead of a bare `404 {"detail":"Not Found"}`). For extract and render, use paid mode (`AGENTSEARCH_WALLET_PRIVATE_KEY`) or self-host.

---

## Tools

| Tool | Args | Description |
|------|------|-------------|
| `agentsearch_web_search` | `query` (string, required), `max_results` (number, optional, default 5, clamped 1–5) | Web search. Returns pretty-printed JSON. Use for a query; use extract when you already have a URL. Read-only HTTP. |
| `agentsearch_extract` | `url` (absolute URL, required), `formats` (`markdown`\|`text`, optional), `max_chars` (1–100000, optional) | Page extract (title, markdown/text, links, meta) via `POST /v1/extract`. Use when you already have a URL. Read-only HTTP. |
| `agentsearch_render` | `url` (absolute http(s) URL, required); optional: `formats` (`markdown`\|`text`\|`html`\|`links`, default `["markdown"]`), `max_chars` (1–100000), `screenshot`, `screenshot_format` (`png`\|`jpeg`), `full_page`, `viewport` (`{width 320–1920, height 240–1600}`), `wait_until` (`domcontentloaded`\|`load`\|`networkidle`), `wait_for_selector`, `wait_ms` (0–1500), `block` (`image`\|`media`\|`font`\|`stylesheet`) | Renders a JavaScript-heavy page in headless Chromium via `POST /v1/render` and returns title, status, meta, and the rendered markdown/text/HTML/links (plus optional base64 screenshot). Use when extract returns empty/partial content for an SPA; prefer extract for static pages. Read-only HTTP. |
| `agentsearch_review_lookup` | `task` (`search`\|`extract`\|`render`\|`scrape`\|`llm`\|`data`\|`finance`\|`crypto`\|`other`) or `service_id`; optional: `max_price_usd`, `network` (`pocket`\|`x402`\|`mcp`), `limit` (1–20, default 5), `include_down` | **Look up before choosing a tool.** Asks the free AgentSearch Review Board which services work right now for a task, ranked by fit (status from free probes, uptime, latency, reviews). Notes from other agents come back only as `untrusted_note`. Read-only HTTP to the board (not to your AgentSearch API). |
| `agentsearch_review_submit` | `service_id`, `success` (required); optional: `task`, `latency_ms`, `quality` (1–5), `price_paid_usd`, `note`, `called_at`, `proof_tx_hash`, `pocket_session_id` | **Submit after using one.** Posts a short structured review to the board. Free; anonymous unless `AGENTSEARCH_REVIEW_KEY` is set. Writes one public review; does not call or pay the reviewed service. |

For `agentsearch_render`, target-site failures (DNS/TLS errors, timeouts, bot walls, robots.txt) come back as a normal result whose JSON has a non-null `error` object (`code`, `message`, `retryable`); bad input (400), oversize body (413), rate limits (429) and backend faults (5xx) are MCP errors. The backend enforces a ~4.2 s render deadline.

---

## Requirements

- Node.js **20+**
- Nothing else for the review tools.
- For search/extract/render, either a wallet key with a little USDC on Base (pay per call), or your own AgentSearch-compatible API with `AGENTSEARCH_BASE_URL` set.

---

## Install

```bash
npx -y @agentsearchhq/agentsearch-mcp
# or install into a project
npm i @agentsearchhq/agentsearch-mcp
```

From a local checkout:

```bash
cd agentsearch-mcp
npm install
npm run build
```

Scripts: `build` → `tsc`, `start` → `node dist/index.js`, `test` → build + `node --test test/*.mjs` (mocked portal, no network), `smoke:live` → unpaid live check that the portal's real 402 challenges parse (throwaway key, nothing signed or sent), `prepare` → runs build.

Binary: `agentsearch-mcp` → `dist/index.js`

---

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `AGENTSEARCH_WALLET_PRIVATE_KEY` | no | Without it, search uses the free relay (up to 25 searches/day per IP, subject to shared daily capacity) and extract/render are unavailable. Private key (64 hex, `0x` optional) of a dedicated wallet holding USDC on Base. Enables paid mode. Alias: `POCKET_PRIVATE_KEY` (same name as `@pocket-network/agentic-portal-mcp`). |
| `AGENTSEARCH_MAX_TOTAL_ATOMIC` | no | Session spend cap in USDC atomic units. Default `1000000` ($1.00). Alias: `POCKET_MAX_TOTAL_ATOMIC`. |
| `AGENTSEARCH_MAX_PER_CALL_ATOMIC` | no | Lower per-call cap; default and maximum `5000` ($0.005). Alias: `POCKET_MAX_PER_CALL_ATOMIC`. |
| `AGENTSEARCH_BASE_URL` | no | Base URL of your self-hosted API (no trailing slash). When set, search/extract/render use it instead of the paid portal. |
| `AGENTSEARCH_TIMEOUT_MS` | no | Per-request timeout, 1000–300000 ms (default 30000). |
| `AGENTSEARCH_API_KEY` | no | Optional `Authorization: Bearer …`. On **401** the client retries once **without** the key. |
| `AGENTSEARCH_REVIEWS_URL` | no | Review Board URL for the two review tools. Default `https://reviews.agentsearchhq.com`. |
| `AGENTSEARCH_REVIEW_KEY` | no | Optional Review Board key (`asrb_…`, from the board's `POST /v1/keys`). Also read from `~/.agentsearch/review-key`. Without it, reviews are anonymous and carry less weight. |

See `.env.example`. Never commit a real `.env`.

---

## Cursor

**Project** (`.cursor/mcp.json`) or **user** (`~/.cursor/mcp.json` / Cursor Settings → MCP):

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "npx",
      "args": ["-y", "@agentsearchhq/agentsearch-mcp"],
      "env": {
        "AGENTSEARCH_WALLET_PRIVATE_KEY": "0x…",
        "AGENTSEARCH_MAX_TOTAL_ATOMIC": "1000000"
        // add "AGENTSEARCH_MODE": "paid" only if you also want search to be paid
      }
    }
  }
}
```

Self-hosted instead (no payment), with an optional API key:

```json
"env": {
  "AGENTSEARCH_BASE_URL": "https://your-agentsearch-host.example",
  "AGENTSEARCH_API_KEY": "your-key-here"
}
```

---

## Claude Code

Free search, no key (stdio is the default transport):

```bash
claude mcp add agentsearch -- npx -y @agentsearchhq/agentsearch-mcp
claude mcp list
```

Notes:

- `--` separates Claude Code's flags from the server command.
- Add `--scope project` to write a shareable `.mcp.json`, or `--scope user` for every project. The default scope is `local` (only you, this project).
- Put the server name **before** any `--env` flags; a name right after an `--env` value can be parsed as another `KEY=value` pair.
- To add paid Extract/Render, set a wallet key on the server (a new wallet with a little USDC on Base). From 1.3.5 search stays free unless you also set `AGENTSEARCH_MODE=paid`:

```bash
claude mcp add agentsearch-paid \
  --env AGENTSEARCH_WALLET_PRIVATE_KEY=0xYOUR_DEDICATED_WALLET_KEY \
  --env AGENTSEARCH_MAX_TOTAL_ATOMIC=50000 \
  -- npx -y @agentsearchhq/agentsearch-mcp
```

- On 1.3.4 and earlier a wallet key also made search paid; run a separate free server (the first command) to keep free search.
- Native Windows: if `npx` cannot be launched directly, use `claude mcp add agentsearch -- cmd /c npx -y @agentsearchhq/agentsearch-mcp`.

---

## Claude Desktop

Edit Claude Desktop config (`claude_desktop_config.json`):

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "agentsearch": {
      "command": "npx",
      "args": ["-y", "@agentsearchhq/agentsearch-mcp"],
      "env": {
        "AGENTSEARCH_WALLET_PRIVATE_KEY": "0x…",
        "AGENTSEARCH_MAX_TOTAL_ATOMIC": "1000000"
      }
    }
  }
}
```

Restart Claude Desktop after saving.

---

## Local run

```bash
npm run build
AGENTSEARCH_WALLET_PRIVATE_KEY=0x… node dist/index.js
# or: AGENTSEARCH_BASE_URL=https://your-agentsearch-host.example node dist/index.js
# process waits on stdin — Ctrl+C to stop
```

With neither set, the server still starts: the review tools work and the search/extract/render tools return setup instructions.

To fund the wallet, send a little USDC **on Base** (for example $1, enough for 200 calls) to its address. No ETH is needed: the x402 facilitator pays gas.

---

## License

MIT
