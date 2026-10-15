# Changelog

## 1.3.1 (unreleased)

### Fixed
- `agentsearch_extract` and `agentsearch_render`: when the base URL returns `404 {"detail":"Not Found"}` for `/v1/extract` or `/v1/render` (e.g. the free relay `https://relay.agentsearchhq.com`, which serves search only), return a clear error: "This base URL does not serve /v1/extract (or /v1/render). The free relay supports search only. Use paid mode (AGENTSEARCH_WALLET_PRIVATE_KEY) or self-host." Other 404s are unchanged.

### Docs
- README, extract/render tool descriptions and `MISSING_BASE_URL_MESSAGE` now state that the free relay serves search only.

## 1.3.0
- Pay-per-call search/extract/render via the Pocket Agentic Portal (x402, USDC on Base) with per-call and session caps; self-hosted mode kept.
