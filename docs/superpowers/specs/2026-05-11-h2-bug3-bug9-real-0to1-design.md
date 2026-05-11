# H-2 Bug 3 + Bug 9 Hotfix — Design Spec

**Date**: 2026-05-11
**Branch**: `cp-05111534-h2-bug3-bug9-real-0to1`
**Type**: hotfix (root cause 已定位 + scope 清晰，不走 brainstorming 重新设计)
**Goal**: 让 Path 2 Sprint B-1 lead 自验真 0-to-1 跑通 — chrome 真在 rog 弹 + user 真扫抖音小号 QR + 真抓 5 评论 + 真写飞书 Lead 表 5 行

## Background

H-1 backend hardening (PR #283 + #284) 收尾 0-touch lead 自验 8/8 PASS，但今天 ssh rog 真启 Agent 重测 Sprint B-1 lead 自验，**到 Step 6 chrome 没弹** — 与 Sprint B-1 当时卡的同一关。

真证据 ssh rog 真验暴露 2 个剩余 bug：
- **Bug 9 (新)**: Agent dual register race — 启动创 2 个 agent row，task 派给"online"那个但 WS connection key 不一致，message 没路由到 Agent
- **Bug 3 (H-2 设计已知)**: mock-agent endpoint NODE_ENV=production 硬 404，secret token 单门禁不够

修这 2 bug 后回去重跑 B-1 lead 自验，chrome 应真弹。其他 H-2 bug (4/5/8) 不阻塞 B-1 单账号链路（多账号才需要），范围外。

---

## Bug 9 — Agent Dual Register Race

### 真证据 (今天 ssh rog 真验)

mac SQL `SELECT * FROM zenithjoy.agents WHERE tenant_id='31518db7-8cfd-4196-a8dc-4482a11ce2af'`:
```
6c411488-9540-4115-b39c-fa0d45e4bbb5 | agent-env-mp0vhkjb       | offline | 2026-05-11 02:20:58
dc9fceaf-7cf8-40a6-93d3-962a58871a67 | ws1-d229794e193843f5     | online  | 2026-05-11 02:20:58 (hostname=XX-ROG)
```

mac POST qr-bind → publish_tasks `agent_id = dc9fceaf-...` (online)。Agent log 没收到 task — chrome 没弹。

### Root Cause (Research Subagent 验后细化)

`apps/api/src/services/license.service.ts:332` fallback — 当 `cfg.agentId` 没传时 register 用 `m-{machine_id}` 作 displayName。WS hello 又用不同 displayName (e.g. `ws1-d229794e...`)。

`apps/api/src/services/agent-ws.ts:62-101` hello handler 走 `findOrCreateAgentUuid(displayName)` — 因 displayName 不一致 → ON CONFLICT 不触发 → INSERT 第二行。

### Fix Design

**核心思路**：Agent register response 已含 `agent_id` (UUID, license.service.ts:283)。Agent 启动时把这个 UUID 存 config，WS hello payload 多带一个 `agent_uuid` 字段。Backend hello handler 优先用 `agent_uuid` (如果有) 复用 row，不创新。

#### Agent Client (`services/agent/src/index.ts`)

启动顺序已是「先 register HTTP → 后 connect WS」(line 384-414)，仅扩展 register response 处理：

```ts
// register response 已含 agent_id (UUID)
const r = await registerWithLicense(...);
cfg.agentUuid = r.agent_id;  // 新存
saveConfig(cfg);
// WS hello 时带 agent_uuid
ws.send(JSON.stringify({
  type: 'hello',
  agent_id: cfg.agentId,
  agent_uuid: cfg.agentUuid,  // 新加，向后兼容
  capabilities, version, ...
}));
```

#### Backend Hello Handler (`apps/api/src/services/agent-ws.ts`)

```ts
async function handleHello(payload: HelloPayload, ws) {
  let agentUuid: string;
  if (payload.agent_uuid) {
    // Bug 9 fix: 复用 register 时已创的 row
    const exists = await pool.query(
      `UPDATE zenithjoy.agents SET status='online', last_seen=now(), agent_id=$2, capabilities=$3 WHERE id=$1 RETURNING id`,
      [payload.agent_uuid, payload.agent_id, payload.capabilities]
    );
    if (exists.rows[0]) {
      agentUuid = exists.rows[0].id;
    } else {
      // 不该发生，但安全 fallback 到老 path
      agentUuid = await findOrCreateAgentUuid(payload.agent_id);
    }
  } else {
    // 老 Agent (无 agent_uuid) 走老 path
    agentUuid = await findOrCreateAgentUuid(payload.agent_id);
  }
  // WS connection map key 用 UUID (H-1 已做)
  connectionMap.set(agentUuid, ws);
}
```

#### Schema (`apps/api/src/schemas/agent-protocol.ts`)

```ts
// HelloPayload 加 agent_uuid 字段，optional 保持向后兼容
export const HelloPayloadSchema = z.object({
  type: z.literal('hello'),
  agent_id: z.string(),
  agent_uuid: z.string().uuid().optional(),  // Bug 9 fix
  capabilities: z.array(z.string()),
  version: z.string(),
});
```

### 向后兼容

- 老 Agent 不发 `agent_uuid` → backend 走老 path (findOrCreateAgentUuid by displayName)，行为不变
- 新 Agent 发 `agent_uuid` → backend 复用 row，单一 agent UUID 一致

---

## Bug 3 — mock-agent Production Gate

### 真证据
```bash
$ curl -X POST http://localhost:5200/api/_smoke/mock-agent -H "X-Smoke-Token: smoke-secret-2026" -H "Content-Type: application/json" -d '{...}'
{"success":false,"error":{"code":"NOT_FOUND","message":"route not found"}}  # 404
```

NODE_ENV=production 时无视 token 一律 404。

### Fix Design (`apps/api/src/routes/_smoke-mock-agent.ts`)

```ts
router.use('/mock-agent', (req, res, next) => {
  // Bug 3 fix: 拆 production 硬 404，token 单一鉴权
  if (process.env.NODE_ENV === 'production' && !process.env.SMOKE_TOKEN) {
    // 生产环境必须显式设 SMOKE_TOKEN env，无 fallback (防 'smoke-secret-2026' 默认值生产泄漏)
    return res.status(503).json({
      success: false,
      error: { code: 'SMOKE_TOKEN_NOT_CONFIGURED', message: 'SMOKE_TOKEN env required in production' },
      timestamp: new Date().toISOString(),
    });
  }
  const expected = process.env.SMOKE_TOKEN || 'smoke-secret-2026'; // dev/test fallback
  const tok = req.header('X-Smoke-Token');
  if (!tok || tok !== expected) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: 'invalid X-Smoke-Token' },
      timestamp: new Date().toISOString(),
    });
  }
  return next();
});
```

---

## 测试策略 (TDD iron law)

### Bug 9

**Unit (commit-1 RED)**:
- `apps/api/src/services/__tests__/agent-ws-hello.test.ts` (新): mock pool, simulate hello with `agent_uuid` → 验证 UPDATE 走的而非 INSERT；hello 无 `agent_uuid` → 走 findOrCreateAgentUuid (老 path)

**Integration (commit-1 RED)**:
- `apps/api/tests/integration/agent-dual-register.test.ts` (新): mac inline 跑真 license register (HTTP) → 拿 agent_uuid → 启 mock WS client 发 hello with agent_uuid → SELECT count(*) FROM agents WHERE tenant_id=$1 = **1** (不是 2)

**E2E (lead 真机)**:
- ssh rog → 真 Agent register → 真 WS hello → mac SQL 查 agents 表 only 1 row + 派 qr-bind task → chrome 真在 rog 弹 → user 物理扫抖音小号 QR → 真抓 5 评论 → 真写飞书 Lead 表 5 行

### Bug 3

**Unit (commit-1 RED)**:
- `apps/api/src/routes/_smoke-mock-agent.test.ts` (改) — 替换 SECURITY 合同：
  - 删: `[SECURITY] NODE_ENV=production → 404 (endpoint disabled)`
  - 加: `[SECURITY] NODE_ENV=production + 未设 SMOKE_TOKEN env → 503 SMOKE_TOKEN_NOT_CONFIGURED`
  - 加: `[SECURITY] NODE_ENV=production + SMOKE_TOKEN env 已设 + 正确 header → 200 (生产可调)`
  - 保: `[SECURITY] 缺 X-Smoke-Token → 403`
  - 保: `[SECURITY] X-Smoke-Token 错 → 403`

---

## DoD

- 2 fix 实施 (TDD commit-1 RED + commit-2 GREEN)
- backend tsc + lint + unit test 全绿
- services/agent build clean + dist 含 agent_uuid hello payload
- PR + CI 全绿 + merge + redeploy backend (launchctl restart) + scp 新 dist 到 rog + restart rog Agent
- **真 E2E**: ssh rog 真 Agent → mac trigger qr-bind → chrome 真弹 (user 配合扫码 1 次物理介入) → 真抓评论 → 真飞书 Lead 表 5 行截图 → 归档 `.agent-knowledge/agent-system-hardening/lead-acceptance-h2-bug3-bug9.md` PASS

---

## 关键约束

- **不动 Sprint A** (feishu-app-bind / feishu-bitable-multitenant / feishu-token)
- **不动 H-1 既有 contract** (license.service register response shape / publish-tasks status enum / WS routing UUID)
- **不动 Path 4** wechat-related code
- **保持向后兼容** — 老 Agent (无 agent_uuid) 仍能 register
- **TDD iron law** — commit-1 RED test 先，commit-2 GREEN impl 后

---

## 范围外 (明确推到后续)

- Bug 4 install pack auto-deploy (需 user 配 GitHub Actions SSH secrets)
- Bug 5 Agent health server port collision (.env override + auto-detect — 多 Agent 同 host 才需要)
- Bug 8 Agent chrome port 19222 collision (同上)
- Lead 自验 dispatcher v1 (后续 sprint)

---

## 预期受影响文件

- **Backend**:
  - `apps/api/src/services/agent-ws.ts` — hello handler 加 agent_uuid 优先 (~15 line)
  - `apps/api/src/schemas/agent-protocol.ts` — HelloPayload 加 agent_uuid optional 字段 (~1 line)
  - `apps/api/src/routes/_smoke-mock-agent.ts` — 拆 production 硬 404，加 503 SMOKE_TOKEN_NOT_CONFIGURED (~10 line)
  - `apps/api/src/services/__tests__/agent-ws-hello.test.ts` — 新 unit test (Bug 9, ~80 line)
  - `apps/api/tests/integration/agent-dual-register.test.ts` — 新 integration test (Bug 9, ~100 line)
  - `apps/api/src/routes/_smoke-mock-agent.test.ts` — 改 SECURITY 合同 (Bug 3, ~30 line diff)
- **Agent**:
  - `services/agent/src/index.ts` — register response 存 agent_uuid + hello payload 加字段 (~10 line)
  - `services/agent/src/lib/config-loader.ts` (或类似) — config schema 加 agentUuid 字段 (~3 line)

总改动 ~250 line。
