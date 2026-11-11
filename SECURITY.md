# Security policy

## Supported versions

Security fixes go into the latest release of `@agentsearchhq/agentsearch-mcp` on npm. Please upgrade to the newest version before reporting.

## Reporting a vulnerability

Please do not open a public issue for security problems. Instead, use GitHub's private reporting ("Report a vulnerability" under the Security tab of this repository) or email **AgentSearchhq@gmail.com** with the subject "Security".

Include the affected version, steps to reproduce, and the impact you expect. We aim to acknowledge reports within 3 business days and to ship a fix or mitigation as quickly as the severity requires.

## Scope notes

- The server never needs an API key for the free tier. Optional wallet settings (`AGENTSEARCH_*`) are read from the environment only; the wallet key stays on your machine and is used locally to sign x402 payments.
- Paid calls are capped per call by the client (see README). Reports about bypassing those caps are in scope.
- Outbound requests require HTTPS for remote hosts; plain HTTP is refused unless explicitly allowed for local development.
