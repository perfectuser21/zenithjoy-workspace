## Sprint 2.1f 真客户首次成功 Path 1 产品级容错（2026-05-09）

### 根本原因

Sprint 2.1e ship 时 lead 自验只跑 `npm test` 全绿就以为通了。今天下午同事第一次用真 Windows 客户机走完整 SOP，5 分钟内暴露 9 个产品 bug：

1. **跨系统配置漂移**：mac 后端跑 production mode 但 .env 没配 `LICENSE_HMAC_SECRET`，sprint 2.1e 没真测 register endpoint 端到端，导致同事 register 全部 500
2. **历史 schema/code 漂移**：早期 PR #244 free-tier-onboarding 的 hot-fix migration 用 `md5() hex` 生成 license（含 0/1 字符），跟 `generateLicenseKey` base32 `[A-Z2-9]` 两套规则。9 条历史 license（含 4 条真客户 qq.com 邮箱）被新校验拒
3. **客户视角 vs 开发者视角失配**：lead 自验机（xian-pc / rog）都装过 agent 多次，状态污染（%APPDATA% 残留 license）掩盖了 install pack 缺陷。同事的全新机直接暴露
4. **install pack 把 license 占位写在 .env.template 让客户手填**，跟 SaaS 产品一键安装预期不符。客户手抄/复制 license 易错（`44D00A51` vs 真值差 1 字符客户都看不出来）
5. **agent 启动失败时无客户可见错误**：黑窗口刷屏 401，客户看不出 license 错。要客户跑 PowerShell 查 .env 是反产品的
6. **agent 不读 .env，读 %APPDATA%/config.json**：客户改 .env 完全无效，但客户无从知晓
7. **start.bat 编码 BOM**：第二次启动 `set ZENITHJOY_LICENSE=...` 被拆碎成 `'ent' / 'tlocal' / 'et' / '/d' 不是命令`，env var 没传入，agent 走 fallback 读老 license

### 下次预防 checklist

- [ ] **生产 env 配置变更必须新加 lint job** — 验证后端启动不报 missing env（防止 `LICENSE_HMAC_SECRET` 类静默失败）
- [ ] **migration 模板用 PG function** (`gen_base32_chars`) 而不是 `md5() hex`，避免 generate / 回填两套规则漂移
- [ ] **sprint ship 必须在 fresh 机器走完整 SOP**，不能只跑 vitest + 自检机（污染状态会骗自己）
- [ ] **install pack download endpoint 默认 server-side 烧入用户特定数据**，不能让客户手填关键字段
- [ ] **客户 SOP 失败必须能在客户端看到清晰错误信息** — start.bat 加 `[precheck]` 调 /heartbeat 验 license，401/403/503 报清晰文案再 exit
- [ ] **register/heartbeat 端到端要有真 e2e curl 测试** + CI smoke job 在 production-like env 跑
- [ ] **正则校验和 generator 字符集解耦** — generator 用受限字符集（base32 防歧义），校验用宽字符集（兼容历史数据）
- [ ] **重大产品行为变更（如 install pack download endpoint server-side 烧 license）必须配套 vitest integration test** 真起 fastify + supertest，不能只单元测 mock

### 9 件 fix 验收 evidence

见 `docs/evidence/sprint-2-1f-prod-readiness.md`。

### Brain Task

3d1a05d9-ef45-4765-a150-47e4d3376435（status=completed）

### PR

https://github.com/perfectuser21/zenithjoy-workspace/pull/273
