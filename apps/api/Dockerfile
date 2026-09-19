# Build stage — compiles TypeScript (build context = monorepo root)
#
# 基础镜像用 node:20-bookworm-slim（Debian，真 glibc），不用 node:20-alpine（musl）——
# 批量混剪 S3(GP f6f96e17) 本地 embedding 依赖 @xenova/transformers 在 Node 环境无条件
# `import * as ONNX_NODE from 'onnxruntime-node'`（backends/onnx.js 顶层 import，无
# try/catch、无 WASM 兜底分支），其原生 .node 绑定是 glibc 编译的。0919 真机 staging
# 部署两轮实测复现：① Alpine 缺 ld-linux-x86-64.so.2，dlopen 直接失败，进程启动即崩；
# ② 加 gcompat（glibc 兼容 shim）后 dlopen 能过，但 onnxruntime 内部执行路径仍抛
# `Ort::Exception: No error information` 反复崩溃重启——gcompat 只是部分 glibc 符号
# 兼容层，撑不住 onnxruntime 这种重度原生库的完整运行时需求。换真 glibc 基础镜像才是
# 这类"预编译 glibc 原生绑定 + Node 原生插件"组合的根治解法（Prisma/TensorFlow.js 等
# 同类库官方文档都是这个结论：native addon 多就别用 alpine）。
FROM node:20-bookworm-slim AS builder
WORKDIR /repo

# build-info：容器 build 无 .git，sha 必须由 build arg 注入（deploy-staging-hk.yml 传入）
ARG BUILD_SHA=unknown
ENV BUILD_SHA=${BUILD_SHA}

# Monorepo root tsconfig (extended by apps/api/tsconfig.json)
COPY tsconfig.base.json ./

# npm ci 需要根 package.json + 锁文件 + 全部 workspace 的 package.json 才能校验一致——
# 只拷 apps/api 自己的 package.json 做 `npm install`（旧做法）会绕开根 package-lock.json，
# 每次 build 都重新对 registry 解析一遍 semver range，caret 依赖（如 better-auth@^1.6.9）
# 一旦上游发新版本就悄悄装出跟本地/CI 完全不同的版本树——0919 真机复现：本地锁的是
# better-auth@1.6.19，容器 build 当天 registry 已发 1.7.5，装出来的新版改了
# internalAdapter.createUser 的类型签名，tsc 直接编译失败，且没有任何征兆（本地/CI
# 用锁文件装永远测不出这类"registry 今天恰好发新版"的定时炸弹）。
# 改用 npm ci 从根锁文件精确安装，与本地 npm test / CI 完全一致的依赖树，此类漂移
# 从根源上不可能再发生。
COPY package.json package-lock.json ./
COPY apps/agent-panel/package.json ./apps/agent-panel/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/geoai/package.json ./apps/geoai/
COPY apps/realtime-voice-mvp/package.json ./apps/realtime-voice-mvp/
COPY apps/staff-hub/package.json ./apps/staff-hub/

RUN npm ci --workspace=apps/api

COPY apps/api/tsconfig.json ./apps/api/
COPY apps/api/src/ ./apps/api/src/
COPY apps/api/scripts/ ./apps/api/scripts/

WORKDIR /repo/apps/api
RUN npm run build
RUN mkdir -p dist/templates && cp src/templates/*.jsx dist/templates/

# Production stage
FROM node:20-bookworm-slim
# tzdata：TZ=Asia/Shanghai 生效依赖（无 tzdata 时 date 恒 UTC，日志/调度时区全错）
# ffmpeg：批量混剪 S4（mashup-render-ffmpeg.ts concatAndScale）用 spawnSync('ffmpeg',...)
# 合成成片。0919 真机复现：这里从换 bookworm 基础镜像起就漏装了，找不到可执行文件时
# spawnSync 不抛异常，concatAndScale 静默返回 false，上层 fail-closed 成
# failed_pending_review——界面显示"内容安全审核处理中"，实际跟审核毫无关系，是这一行
# 缺失。dockerfile-ffmpeg.test.ts 固化这个断言，谁再删这行 CI 直接红。
RUN apt-get update && apt-get install -y --no-install-recommends tzdata ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# 直接复用 builder 阶段已经跑过 npm ci + tsc 编译验证过的 node_modules，不再单独
# `npm install --production` 二次安装——旧写法这里是第二次独立的、同样不锁版本的
# install，就算上面 builder 阶段侥幸没撞上 registry 漂移，这里还可能撞上（两次
# install 时间点不同，registry 状态可能已经变了）。复用同一份 node_modules 从根源
# 消掉这第二个漂移窗口。
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /repo/apps/api/package.json ./apps/api/package.json
COPY --from=builder /repo/apps/api/dist/ ./apps/api/dist/
# product-map.json 是业务线清单权威来源（staff-health.ts 每次请求真读），此前从未拷进镜像，
# 生产/staging 容器里恒 ENOENT，line-health 端点只能走硬编码兜底清单（2026-07-28 真机复现）
COPY product-map/generated/ ./product-map/generated/

WORKDIR /repo/apps/api

EXPOSE 5200

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:5200/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); })"

CMD ["node", "dist/index.js"]
