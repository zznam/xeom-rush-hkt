# Use official Node.js Alpine image for a small footprint
FROM node:20-alpine

# Enable corepack for pnpm support
RUN corepack enable

# Create app directory
WORKDIR /app

# Copy pnpm lockfile and workspace config first to leverage Docker layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Copy all project package.json files
COPY apps/client/package.json ./apps/client/
COPY apps/server/package.json ./apps/server/
COPY packages/shared/package.json ./packages/shared/

# Install dependencies (frozen lockfile for deterministic builds)
RUN pnpm install --frozen-lockfile

# Copy the rest of the monorepo source code
COPY . .

# Build the shared package and the server package
RUN pnpm build:shared && pnpm --filter server build

# Expose the WebSocket/Express port
EXPOSE 3002

# Start the server using the compiled dist
CMD ["pnpm", "--filter", "server", "start"]
