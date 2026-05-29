# 抖音运营员 Session CI E2E 验证 — 设计文档

**日期**：2026-05-29  
**Journey**：ZenithJoy 运营中枢（Line 00）  
**类型**：路径 B 小改动  

---

## 背景

运营员通过 xian-pc 扫码登录抖音，session 已保存为 Playwright storageState 格式（含 40 个 cookies，`sessionid` 有效期至 2026-07-28），并存入 GHA secret `DOUYIN_OPERATOR_SESSION`。

当前 `session-health-check.yml` 只验证 `DOUYIN_COOKIES`（cookie 数组格式，HTTP 请求校验），不验证 `DOUYIN_OPERATOR_SESSION`（storageState 格式，需真实浏览器）。需要专门的 CI job 定期验证该 session 仍能无扫码访问 creator dashboard。

---

## 目标

- CI 自动验证 `DOUYIN_OPERATOR_SESSION` 在 windows-latest runner 上能加载并访问 creator.douyin.com
- PASS → exit 0 + 截图留证
- FAIL → exit 1 + Bark/飞书双渠道告警 + 截图留证
- 支持手动触发（`workflow_dispatch`）+ 每周定时巡检

---

## 架构

### 新增文件

```
scripts/sessions/verify-operator-douyin.js    ← ESM 验证脚本
.github/workflows/douyin-operator-session-e2e.yml  ← CI workflow
```

### 验证脚本逻辑（verify-operator-douyin.js）

1. 读 `DOUYIN_OPERATOR_SESSION` 环境变量，JSON.parse 解析 storageState
2. 检查 `sessionid` cookie 过期时间（快速失败，无需启动浏览器）
3. 写临时 storageState 文件（os.tmpdir）
4. 用 `services/agent` 的 `playwright@1.49` 启动 headless chromium
5. `browser.newContext({ storageState: tmpFile })` 加载 session
6. 导航至 `https://creator.douyin.com/creator-micro/home`（waitUntil: domcontentloaded）
7. 等待 3000ms SPA settle（抖音 JS 重定向需时间）
8. 检查最终 URL 是否含 `/login` → 含则 FAIL
9. 拦截 `creator.douyin.com/web/api/base/creator/user/info` 响应，验证 status_code=0
10. 截图至 `douyin-session-pass.png` 或 `douyin-session-fail.png`
11. FAIL 时调用 Bark + 飞书告警
12. 清理临时文件，exit 0/1

### CI Workflow（douyin-operator-session-e2e.yml）

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 16 * * 0'  # 每周日北京午夜（UTC 16:00）

jobs:
  verify-operator-session:
    runs-on: windows-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4 (node 20)
      - cd services/agent && npm ci
      - npx playwright install chromium --with-deps
      - node scripts/sessions/verify-operator-douyin.js
      - upload-artifact: douyin-session-*.png
```

Secrets 注入：
- `DOUYIN_OPERATOR_SESSION` — storageState JSON
- `FEISHU_BOT_WEBHOOK` — 飞书告警
- `BARK_URL` — hardcoded（同 session-health-check.yml）

---

## 告警格式

FAIL 时：
- Bark：`抖音运营员 Session 失效 — CI 验证失败，请重新扫码`
- 飞书：`🔴 DOUYIN_OPERATOR_SESSION 验证失败\n需要重新扫码更新 session（GitHub Actions → DOUYIN_OPERATOR_SESSION secret）`

---

## 测试策略

| 档位 | 内容 |
|---|---|
| **E2E** | 本 workflow 本身就是 E2E — windows-latest + 真实 Playwright + 真实 douyin.com |
| **integration** | 不需要（无 DB/API 依赖） |
| **unit** | 不需要（脚本逻辑简单，E2E 已覆盖） |
| **trivial** | 不需要 |

---

## 验收标准

- [ ] `workflow_dispatch` 手动触发，`verify-operator-session` job PASS
- [ ] 截图 artifact 可下载，显示 creator dashboard（非登录页）
- [ ] FAIL 场景：删除/损坏 session 时，Bark + 飞书收到告警
- [ ] CI 全绿

---

## 不包含

- 不更新 `DOUYIN_OPERATOR_SESSION` secret（那是扫码流程的工作）
- 不验证其他平台 operator session（可后续扩展）
- 不做真实发布测试（仅验证登录状态）
