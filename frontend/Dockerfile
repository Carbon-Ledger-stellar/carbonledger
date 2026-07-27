# renovate: datasource=docker depName=node versioning=docker
FROM node:18-alpine@sha256:8e5f4f1791f0e8a4e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# renovate: datasource=docker depName=node versioning=docker
FROM node:18-alpine@sha256:8e5f4f1791f0e8a4e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# renovate: datasource=docker depName=node versioning=docker
FROM node:18-alpine@sha256:8e5f4f1791f0e8a4e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=builder --chown=nodejs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nodejs:nodejs /app/public ./public
USER nodejs
EXPOSE 3000
CMD ["node", "server.js"]
