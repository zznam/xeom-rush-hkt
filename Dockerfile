# Use official Bun Alpine image for a small footprint
FROM oven/bun:1-alpine

# Create app directory
WORKDIR /app

# Copy bun lockfile and workspace package.json files first to leverage Docker layer caching
COPY bun.lock package.json ./

# Copy all project package.json files
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
COPY apps/e2e/package.json ./apps/e2e/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (frozen lockfile for deterministic builds)
RUN bun install --frozen-lockfile

# Copy the rest of the monorepo source code
COPY . .

# Build the shared package and the server package
RUN bun run build:shared && bun run --filter server build

# Expose the WebSocket/Express port
EXPOSE 3002

ENV NODE_ENV=production

# Start the server using the compiled dist
CMD ["bun", "run", "--filter", "server", "start"]
