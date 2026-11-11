# Changelog

## 1.8.0

### Added
- **`agentsearch_news_search`:** recent news articles (title, URL, snippet, domain, publish date) from AgentSearch's direct x402 API (`POST /x402/v1/news`, $0.008 / 8000 atomic USDC, empty results not charged). `max_results` 1–10 plus filters.
- **`agentsearch_screenshot`:** PNG or JPEG of a public page (`POST /x402/v1/screenshot`, $0.010 / 10000 atomic USDC), returned as an MCP image content block plus JSON metadata (the base64 is not duplicated in the text). Options: `format`, `full_page` (clipped at 4000 px), `viewport`.
- **Search filters** on paid `agentsearch_web_search`, `agentsearch_news_search` and `agentsearch_search_and_read`: `freshness` (day/week/month/year) or `date_from`/`date_to`, `country`, `language`, `include_domains`, `exclude_domains` (up to 5 each). The free tier ignores them.
- **Extract options on the direct route:** `max_chars` is now forwarded (capped at the API's 50000) and new `include_links` (set `false` to save tokens). Before 1.8.0 the direct route dropped `max_chars`.

### Changed
- Direct prices in tool text and errors: **extract $0.004** (was $0.007) and **search_and_read $0.009** (was $0.015), matching the API. Search $0.008 and render $0.010 unchanged. The per-call ceiling stays $0.020.

### Unchanged
- Free search, the extract/render free trial, the Pocket route ($0.005; search, extract and render only), self-hosted mode and review tools. News and screenshot are direct-only like Search + Read.

## 1.7.0

### Added
- **`agentsearch_search_and_read`:** search the live web and return the top pages as markdown in one paid call ($0.015 / 15000 atomic USDC) on AgentSearch's direct x402 API (`POST /x402/v1/search_and_read`). Charged only when at least one page has text. Inputs: `query`, optional `num_results` (default 3, max 5; `max_results` alias), `max_chars` (default 8000, max 20000), `render_fallback` (default false, at most one page). Direct-only and paid-only: not on the free relay, the Pocket route, or a self-hosted `AGENTSEARCH_BASE_URL`.

### Changed
- Direct per-call hard ceiling raised from $0.010 (`10000`) to **$0.020** (`20000`) so Search + Read is accepted, with a little headroom. `AGENTSEARCH_MAX_PER_CALL_ATOMIC` can still only lower the ceiling. A cap of `10000` now refuses `search_and_read` and says to raise it to `20000`, remove it, or use the Pocket route for the a la carte tools.

### Unchanged
- Search stays free by default. Extract/render free trial, Pocket route ($0.005 for search, extract and render), self-hosted mode and review tools are unchanged.


## 1.6.0

### Changed
- **Direct x402 is now the default paid route.** With a wallet key, paid calls go to AgentSearch's own x402 API on Base mainnet (`https://api.agentsearchhq.com/x402/v1/{search,extract,render}`), paid to AgentSearch's payee `0xC49B157887e51c21CB655f39CF65D6a4c2a4C337`: **extract $0.007, render $0.010, search $0.008** (search only with `AGENTSEARCH_MODE=paid`). **Wallet users now pay these direct prices, slightly more than the Pocket route's $0.005.** Hard ceiling $0.010 per call; the session cap (default $1.00) is unchanged.
- Messages, tool descriptions, manifest/registry metadata and README lead with the direct route.

### Added
- `AGENTSEARCH_PAYMENT_ROUTE=direct|pocket`. `pocket` keeps the Pocket Network Agentic Portal ($0.005 per call, $0.005 ceiling, portal payee pinned) exactly as in 1.5.0. The 1.5.0 switch still works: `AGENTSEARCH_X402_DIRECT=0` selects `pocket`. An unrecognized route value refuses paid calls with nothing signed.
- If `AGENTSEARCH_MAX_PER_CALL_ATOMIC` is below a direct price (e.g. an old `5000`), the refusal says how to fix it (raise to `10000`, remove it, or use the Pocket route). Nothing is signed.

### Unchanged
- No wallet key: free search (up to 25/day per IP) and the extract/render free trial behave exactly as before; no payment is possible without a key. Search stays free with only a wallet key. Self-hosted mode and review tools are unchanged.

## 1.5.0

### Added
- **Direct x402 (opt-in).** `AGENTSEARCH_X402_DIRECT=1` (with `AGENTSEARCH_WALLET_PRIVATE_KEY`) sends paid calls to AgentSearch's own x402 API on Base mainnet (`https://api.agentsearchhq.com/x402/v1/{search,extract,render}`) instead of the Pocket portal: extract $0.007, render $0.010, search $0.008 (search only with `AGENTSEARCH_MODE=paid`). Signs only exact/USDC on Base to AgentSearch's pinned payee, hard ceiling $0.010 per call, shared session cap. `AGENTSEARCH_X402_DIRECT_URL` overrides the host (https, or http on localhost) for testing.

### Unchanged
- Default behavior: without the new variable, the paid rail is the Pocket portal ($0.005), search modes, free tier/trial, self-hosted mode and review tools are as in 1.4.0.

## 1.4.0

### Added
- **No-wallet free trial for Extract and Render.** With no wallet key and no `AGENTSEARCH_BASE_URL`, `agentsearch_extract` (5 calls/day per IP) and `agentsearch_render` (3 calls/day per IP, text output only; screenshot/full_page are dropped with a note) call the AgentSearch free relay (`POST /v1/extract`, `POST /v1/render`) instead of returning a setup message. Past the trial the tool returns the relay's 429 reason plus wallet setup steps (https://agentsearchhq.com/wallet-setup). If the relay doesn't offer the trial (404/405), the old setup message is returned.
- `AGENTSEARCH_FREE_TRIAL=0` turns the trial off (no-wallet extract/render then make no network call, as in 1.3.x).
- Relay requests send `X-Agent-Client: agentsearch-mcp/<version>` (package name and version only) so free usage can be counted per client.

### Unchanged
- Wallet paid path (Pocket portal, x402, per-call and session caps), search modes, self-hosted mode and review tools.

## 1.3.7
- Metadata only: MCP Registry and npm descriptions now name URL-to-markdown extract and JS render; npm keywords add web-extract, url-to-markdown, markdown, web-scraping, rag. README: search-then-read loop with Extract/Render guide links. No code or tool changes.

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
