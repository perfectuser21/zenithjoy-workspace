## Lane0 小红书 qr-bind cookie 名 + CDP 端口修复（2026-05-30）

### 根本原因
- `qr-bind-operator.ts/.cjs` 中 xiaohongshu 的 cookie 检测名沿用了占位符 `webId`，而真实登录 cookie 为 `galaxy_creator_session_info`（check-health.js 早已正确，但 handler 侧未同步）
- `spawnQrBindOperator` 未按平台注入 `ZENITHJOY_CHROME_DEBUG_PORT`，导致 .cjs 默认连 19222（抖音），而小红书 Chrome 实例跑在 19224

### 下次预防
- [ ] 新增平台 qr-bind 支持时，三处文件必须同步：handler.ts / publisher.cjs / check-health.js
- [ ] 每个平台的 Session cookie 名在 handler/cjs/check-health 三处必须完全一致，CI lint 可加跨文件对比检查
- [ ] `PLATFORM_CDP_PORTS` 映射集中管理端口，避免散落在各处
