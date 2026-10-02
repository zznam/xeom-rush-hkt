FROM oven/bun:1.4.0 AS build
WORKDIR /app
COPY bun.lock package.json ./
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
COPY apps/e2e/package.json ./apps/e2e/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --ignore-scripts
COPY packages/shared packages/shared
COPY apps/server apps/server
RUN bun run build:server

FROM oven/bun:1.4.0 AS dependencies
WORKDIR /app
COPY bun.lock package.json ./
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
COPY apps/e2e/package.json ./apps/e2e/
COPY packages/shared/package.json ./packages/shared/
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3002 DEPLOY_TARGET=legacy
COPY --from=dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/server/dist ./apps/server/dist
USER node
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3002/api/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
