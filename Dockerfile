# syntax=docker/dockerfile:1
# AgentSearch MCP server (stdio). Default: no env, keyless free search
# (up to 25/day per IP) plus the extract/render trial. Optional runtime
# env (AGENTSEARCH_WALLET_PRIVATE_KEY, etc.) enables paid calls to
# https://api.agentsearchhq.com. Never bake secrets into the image.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src
RUN npm ci --ignore-scripts && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 1001 --create-home --home-dir /app --shell /usr/sbin/nologin mcp
COPY --from=build --chown=mcp:mcp /app/package.json /app/package-lock.json ./
COPY --from=build --chown=mcp:mcp /app/dist ./dist
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force \
    && chown -R mcp:mcp /app
USER mcp
# stdio MCP; run with `docker run --rm -i`
ENTRYPOINT ["node", "dist/index.js"]
