FROM oven/bun:1.3 AS deps
WORKDIR /app

# Copy just the viewer package.json for dependency install
COPY apps/viewer/package.json ./
RUN bun install

# Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Copy deps from previous stage
COPY --from=deps /app/node_modules ./node_modules
COPY apps/viewer/ ./

# Build Next.js
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx next build

# Production stage
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE ${PORT:-3001}
CMD ["node", "server.js"]
