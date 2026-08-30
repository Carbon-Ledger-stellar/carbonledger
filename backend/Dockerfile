# ── Stage 1: Install dependencies ─────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app

# Copy only manifests first so this layer is cached unless deps change
COPY package*.json ./
COPY prisma/schema.prisma ./prisma/

# Install ALL deps (dev included) needed to build, then prune to prod below
RUN npm ci --prefer-offline --no-audit --no-fund

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build NestJS and generate Prisma client
RUN npm run build && npx prisma generate

# Prune dev dependencies so runner image only gets production packages
RUN npm prune --production

# ── Stage 3: Runtime ───────────────────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

ENV NODE_ENV=production
# Reduce Node.js memory overhead in containers
ENV NODE_OPTIONS="--max-old-space-size=384"

# Only copy the artefacts needed at runtime
COPY --from=builder --chown=nodejs:nodejs /app/dist          ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules  ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/prisma        ./prisma
COPY --chown=nodejs:nodejs package*.json ./

USER nodejs
EXPOSE 3001

# Use tini-compatible node startup to properly handle signals
CMD ["node", "dist/main"]
