# Build stage — compiles TypeScript (build context = monorepo root)
FROM node:20-alpine AS builder
WORKDIR /repo

# Monorepo root tsconfig (extended by apps/api/tsconfig.json)
COPY tsconfig.base.json ./

COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/

WORKDIR /repo/apps/api
RUN npm install
RUN npm run build

# Production stage
FROM node:20-alpine
WORKDIR /app
COPY --from=builder /repo/apps/api/package*.json ./
RUN npm install --production
COPY --from=builder /repo/apps/api/dist/ ./dist/

EXPOSE 5200

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:5200/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "dist/index.js"]
