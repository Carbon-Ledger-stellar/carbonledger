# ── Stage 1: Install dependencies ─────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS deps
WORKDIR /app

# Copy only manifests first — cached unless deps change
COPY package*.json ./
RUN npm ci --prefer-offline --no-audit --no-fund

# ── Stage 2: Build ─────────────────────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build

# ── Stage 3: Runtime ───────────────────────────────────────────────────────────
# renovate: datasource=docker depName=node versioning=docker
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS runner
WORKDIR /app

# Security: run as non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Port Next.js standalone server listens on
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# next build --standalone outputs a self-contained server.js with all deps
# Only these three directories are needed at runtime
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/static     ./.next/static
COPY --from=builder --chown=nodejs:nodejs /app/public           ./public

USER nodejs
EXPOSE 3000

CMD ["node", "server.js"]
