---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 3: 抖音 video dryrun + 真发脚本 + image 加扫码

**范围**: 新建 qr-login 共享模块 + video 真发/dryrun 脚本 + image 脚本接入扫码
**大小**: L
**依赖**: WS2（需要路由能 spawn 这些脚本）

## ARTIFACT 条目

- [ ] [ARTIFACT] qr-login 共享模块存在且导出 requireLogin
  Test: ls services/agent/publishers/douyin-publisher/lib/qr-login.cjs && node -e "const m=require('./services/agent/publishers/douyin-publisher/lib/qr-login.cjs'); if(typeof m.requireLogin!=='function')process.exit(1)"

- [ ] [ARTIFACT] publish-douyin-video.cjs 存在且引用 qr-login
  Test: ls services/agent/publishers/douyin-publisher/publish-douyin-video.cjs && grep -E "require.*lib/qr-login" services/agent/publishers/douyin-publisher/publish-douyin-video.cjs

- [ ] [ARTIFACT] publish-douyin-video-dryrun.cjs 存在且不点最后发布按钮
  Test: ls services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs && ! grep -E "page\.click.*publish-button|发布.*click" services/agent/publishers/douyin-publisher/publish-douyin-video-dryrun.cjs

- [ ] [ARTIFACT] publish-douyin-image.cjs 改用 qr-login（正向校验，铁律 6：先减肥）
  Test: grep -E "require.*lib/qr-login" services/agent/publishers/douyin-publisher/publish-douyin-image.cjs

- [ ] [ARTIFACT] image.cjs 入口必须先 `await requireLogin(...)` 才进发布流程（防作弊：避免 require 但不调）
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/douyin-publisher/publish-douyin-image.cjs','utf8'); if(!/await\s+requireLogin\s*\(/.test(c) && !/requireLogin\s*\([^)]*\)\.then/.test(c))process.exit(1)"

- [ ] [ARTIFACT] image.cjs Playwright 选择器禁用 class（R3 mitigation：用 data-testid / aria-label / role / text）
  Test: node -e "const c=require('fs').readFileSync('services/agent/publishers/douyin-publisher/publish-douyin-image.cjs','utf8'); const classSel=(c.match(/page\.\\w+\\(['\\\"]\\.[a-z][a-zA-Z0-9_-]*/g)||[]).length; if(classSel>0)process.exit(1)"

## BEHAVIOR 索引（实际测试在 tests/ws3/）

见 `tests/ws3/qr-login.test.cjs` + `tests/ws3/publish-douyin-video-dryrun.test.cjs`，覆盖：
- qr-login 检测未登录时 throw 'NEED_QR' + 把 QR 截屏路径 attach 到 error
- qr-login 检测已登录直接 return
- video-dryrun 启动后 stdout 含 "等待发布按钮" 字样且 exit 0
- video-dryrun 永不点最后发布按钮（spawn 后看 stdout 不能含 "click publish"）
