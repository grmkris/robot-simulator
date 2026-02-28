FROM oven/bun:1.3 AS base
WORKDIR /app

# Copy workspace root config
COPY package.json bun.lock ./
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/sim/package.json packages/sim/package.json
COPY packages/agent-sdk/package.json packages/agent-sdk/package.json
COPY apps/server/package.json apps/server/package.json
COPY agents/random-agent/package.json agents/random-agent/package.json
COPY agents/heuristic-agent/package.json agents/heuristic-agent/package.json
COPY agents/aggressive-agent/package.json agents/aggressive-agent/package.json
COPY agents/claude-agent/package.json agents/claude-agent/package.json
# Viewer placeholder so bun install doesn't fail on missing workspace
COPY apps/viewer/package.json apps/viewer/package.json

# Install dependencies
RUN bun install

# Copy source
COPY packages/ packages/
COPY apps/server/ apps/server/
COPY agents/ agents/
COPY tsconfig.json ./

# Ensure data directory exists (Railway volume mounts at /data)
RUN mkdir -p /data

# Expose port (Railway sets PORT env var)
EXPOSE ${PORT:-3000}

# Run the server
CMD ["bun", "run", "apps/server/src/main.ts"]
