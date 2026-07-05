# 生产不变量（Production Invariants）

> 这份文档定义了**什么东西不能被改坏**。
> 每次开发新功能前，Claude Code 必须读这份文档，确保改动不破坏以下任何一条。
> 新发现的坑 → 加到这里，不要只放在 CLAUDE.md。

---

## 一、已锁定（有 CI smoke 覆盖，改坏会红）

### Auth（身份认证）
- `POST /api/auth/sign-in/email` 邮箱密码登录必须返回 session cookie
- `BETTER_AUTH_TRUSTED_ORIGINS` 必须同时包含 `https://` 和 `http://` 版本的域名（浏览器通过 Cloudflare 可能走 http）
- Session 跨重启持久（存 DB，不在内存）
- CI smoke：`auth-smoke.sh` + `auth-tenant-bridge-smoke.sh`

### Tenant 隔离
- 每个 agent 只能看到自己 tenant 的任务（`pending-collect-tasks` 按 tenant_id 过滤）
- `tenant_members.feishu_user_id` 存 better-auth user.id（不是真的飞书 ID，列名历史遗留）
- CI smoke：`multi-tenant-smoke.sh`

### Agent 注册 & 心跳
- Agent 启动后必须向 `/api/agent/heartbeat` 注册，每 30s 心跳
- `agents` 表 `status` 字段 online/offline 依心跳判断
- CI smoke：`agent-fleet-smoke.sh`

### Line02 采集管道
- 关键词任务状态机：`pending → dispatched → done`（或 `failed`）
- Stage 1（找视频 URL）和 Stage 2（抓评论者）分开上报
- `terminal: 'stage_1'` → status 变 `stage_1_done`；`terminal: 'done'` → status 变 `done`
- CI smoke：`acquisition-smoke.sh` + `acquisition-collect-smoke.sh`

### Dashboard 可访问性
- `https://autopilot.zenjoymedia.media` 必须返回 200
- `/health` endpoint 必须返回 `status: ok`
- CI：`deploy-dashboard-staging.yml` 部署后验证

---

## 二、NFR（非功能性要求，已知需守护的）

| 项目 | 要求 | 当前状态 |
|------|------|---------|
| API 冷启动 | < 5s | ✅ |
| 采集任务超时 | Stage 2 单视频 90s 强杀 | ✅（代码里有 CRAWL_TIMEOUT_MS） |
| 频控 | 私信 ≤1/陌生人硬限，不可绕过 | ✅ |
| 租户数据不跨库 | zenithjoy_sv（生产）vs zenithjoy_test（staging）完全隔离 | ✅ |
| Agent 版本自升级 | 中台推新版本后 agent 自动 OTA，不需要人工到每台机器操作 | ✅ |

---

## 三、已知 irrelevant（可以忽略/删除的历史遗留）

这些在代码里还存在，但业务上已经不用了，改动不需要保护：

| 内容 | 原因 |
|------|------|
| `X-Feishu-User-Id` header（`tenant-context.ts`） | 飞书登录已删，这是向后兼容路径，将来可清掉 |
| `ADMIN_FEISHU_OPENIDS` 环境变量 | 飞书超管路径，已被 `ADMIN_EMAILS` 替代，可删 |
| `tenant_feishu_bindings` 表 | 飞书 OAuth 绑定，已删飞书，表可留但不写入 |
| `feishu_customer_list` 相关路由 | 飞书客户表同步，已不用 |
| `smokeFeishuSeedRouter`（`/api/_smoke`） | 测试用飞书 seed，生产无用 |

---

## 四、CI 门禁层级（已有，必须保持）

```
L1 Process Gate     — 分支命名/PR 标题/密钥扫描（~2min，每 PR 必跑）
L2 Consistency      — 代码一致性检查
L3 Code Quality     — TypeScript + ESLint + 单测覆盖率 ≥65%
L4 Smoke            — API contract smoke + E2E smoke（关键路径）
L4 Integration      — 集成测试
```

**禁止操作**：
- 绝不用 `gh pr merge --admin` 绕过 CI
- 绝不删 L1-L4 任何一层的 required checks
- 新 API endpoint 必须有对应 vitest 单测（bash smoke 不算覆盖率）

---

## 五、如何告诉 Claude Code "不要改坏这些"

在每次 `/dev` 开发前，CLAUDE.md 里的指令会自动加载。**但最强的锁不是文档，是 CI。**

实操建议：
1. 把关键 smoke 脚本加进 `ci-l4-e2e-smoke.yml` 的 required checks → CI 红了就不能合并
2. 用 `decisions` 表记录不变量（`category=invariant`），/dev 的 Phase 1 会自动 match 并 enforce
3. 新功能 PR 描述里强制写：「本 PR 不影响以下 invariant：[列出]」

---

## 六、当前生产快照（2026-07-03）

| 组件 | 版本/状态 |
|------|---------|
| API sha | `003cf616` |
| Agent | `2.0.71` |
| Dashboard | 最新 main |
| DB | cecelia（US Mac localhost） |
| Auth | better-auth v1.6.9，email/password |
| 生产进程 | nohup node，PID 需重启后记录 |
| BETTER_AUTH_TRUSTED_ORIGINS | https + http 两个域名版本 + localhost |
