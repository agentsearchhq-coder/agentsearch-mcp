# Changelog

## 1.3.6

### Changed
- Docs/wording only, no behavior change. Tool descriptions, the startup line and limit messages say "AgentSearch free tier" instead of "free AgentSearch relay".
- README: Modes table states search stays free with only a wallet key (paid search needs `AGENTSEARCH_MODE=paid`); new Cline section (`cline_mcp_settings.json` entry and `cline mcp add` one-liner).

## 1.3.5

### Changed
- **A wallet key no longer makes search paid.** Search is free by default even when `AGENTSEARCH_WALLET_PRIVATE_KEY` / `POCKET_PRIVATE_KEY` is set (for example inherited from the parent shell), so Extract/Render can be enabled while search stays on the free tier. Paid search is an explicit opt-in: `AGENTSEARCH_MODE=paid`. `AGENTSEARCH_MODE=auto` restores the 1.3.0-1.3.4 behavior (paid search when a wallet key is set). An unrecognized value makes search return an error and make no call. `AGENTSEARCH_BASE_URL` still takes precedence. Same pattern as `@agentsearchhq/langchain` 0.2.1.
  **Migration:** if you relied on a wallet key making search paid, add `AGENTSEARCH_MODE=paid` (or `auto`).
- When the free daily limit is hit and a wallet key is already configured, the message says to set `AGENTSEARCH_MODE=paid` instead of how to add a wallet.
- Tool descriptions lead with the real default (free search) instead of "Default mode: ... PAYS", and no longer include the relay hostname.
- Startup log reflects the search mode.

### Added
- MCP tool annotations (`readOnlyHint`, `destructiveHint: false`, `idempotentHint`, `openWorldHint`) on `agentsearch_web_search` and `agentsearch_extract`.
- README: Claude Code section (`claude mcp add ...`, scopes, `--env` ordering, paid server, Windows note), modes table and `AGENTSEARCH_MODE` docs.

## 1.3.4

### Changed
- Free-tier wording everywhere: up to 25 searches/day per IP, subject to shared daily capacity (no "per user" or "unlimited").
- Prices stated only for search and extract ($0.005 per call); no behavior changes.

## 1.3.3

### Fixed
- Startup log no longer says search/extract/render return setup instructions with no config; it now says search uses the free relay and extract/render need a wallet key.

## 1.3.2

### Changed
- **Free search by default.** With no configuration, `agentsearch_web_search` now uses the free AgentSearch relay (`https://relay.agentsearchhq.com/v1/search`, 25 searches per day per user, search only) instead of returning setup instructions. Setting `AGENTSEARCH_BASE_URL` is no longer needed for free search.
- With no wallet, `agentsearch_extract` and `agentsearch_render` make no network call and return a clear message: they are paid tools ($0.005 per call via the Pocket Network Agentic Portal), with how to add a wallet.
- A `429` from the free relay returns a message that the daily limit was reached and how to upgrade to paid (`AGENTSEARCH_WALLET_PRIVATE_KEY`).
- Unchanged: a wallet key keeps the paid portal behavior; `AGENTSEARCH_BASE_URL` still takes precedence (self-hosted).

## 1.3.1

### Fixed
- `agentsearch_extract` and `agentsearch_render`: when the base URL returns `404 {"detail":"Not Found"}` for `/v1/extract` or `/v1/render` (e.g. the free relay `https://relay.agentsearchhq.com`, which serves search only), return a clear error: "This base URL does not serve /v1/extract (or /v1/render). The free relay supports search only. Use paid mode (AGENTSEARCH_WALLET_PRIVATE_KEY) or self-host." Other 404s are unchanged.

### Docs
- README, extract/render tool descriptions and `MISSING_BASE_URL_MESSAGE` now state that the free relay serves search only.

## 1.3.0
- Pay-per-call search/extract/render via the Pocket Agentic Portal (x402, USDC on Base) with per-call and session caps; self-hosted mode kept.
