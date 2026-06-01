# renovate: datasource=docker depName=node versioning=docker
FROM node:18-alpine@sha256:8e5f4f1791f0e8a4e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production && npm ci
COPY . .
RUN npm run build && npx prisma generate

# renovate: datasource=docker depName=node versioning=docker
FROM node:18-alpine@sha256:8e5f4f1791f0e8a4e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e5e AS runner
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma
COPY --chown=nodejs:nodejs package*.json ./
USER nodejs
EXPOSE 3001
CMD ["node", "dist/main"]
