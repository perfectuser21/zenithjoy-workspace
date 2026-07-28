# Build stage — compiles TypeScript (build context = monorepo root)
FROM node:20-alpine AS builder
# npm run build 里的 write-build-info.sh 是 bash 脚本；alpine 默认无 bash
RUN apk add --no-cache bash
WORKDIR /repo

# build-info：容器 build 无 .git，sha 必须由 build arg 注入（deploy-staging-hk.yml 传入）
ARG BUILD_SHA=unknown
ENV BUILD_SHA=${BUILD_SHA}

# Monorepo root tsconfig (extended by apps/api/tsconfig.json)
COPY tsconfig.base.json ./

COPY apps/api/package*.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/scripts/ ./apps/api/scripts/

WORKDIR /repo/apps/api
RUN npm install
RUN npm run build
RUN mkdir -p dist/templates && cp src/templates/*.jsx dist/templates/

# Production stage
FROM node:20-alpine
# tzdata：TZ=Asia/Shanghai 生效依赖（无 tzdata 时 date 恒 UTC，日志/调度时区全错）
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=builder /repo/apps/api/package*.json ./
RUN npm install --production
COPY --from=builder /repo/apps/api/dist/ ./dist/
# product-map.json 是业务线清单权威来源（staff-health.ts 每次请求真读），此前从未拷进镜像，
# 生产/staging 容器里恒 ENOENT，line-health 端点只能走硬编码兜底清单（2026-07-28 真机复现）
COPY product-map/generated/ ./product-map/generated/

EXPOSE 5200

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:5200/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "dist/index.js"]
