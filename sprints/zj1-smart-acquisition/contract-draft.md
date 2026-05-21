# Sprint Contract Draft (Round 2)

## Golden Path

[客户端] → [GET /api/acquisition/overview] → [API 返回 HTTP 200 + JSON 元数据 {enabled, feature, capabilities, version}]

---

### Step 1: 客户端发起 GET /api/acquisition/overview

**可观测行为**: API 返回 HTTP 200，body 含且仅含 4 个字段 `enabled`/`feature`/`capabilities`/`version`，无鉴权要求，硬编码静态返回

**验证命令**（仅可达性检查 — **schema 完整验证由下方 E2E 验收脚本统一执行，禁止在此重复 jq 断言**）:

```bash
API_PORT=${API_PORT:-3001}
curl -sf "http://localhost:$API_PORT/api/acquisition/overview" > /dev/null
echo "OK: 端点可达，HTTP 2xx"
```

**硬阈值**: HTTP 200，耗时 < 3s

---

### Step 2: 不存在的子路由返回 404

**可观测行为**: `GET /api/acquisition/nonexistent` 返回 HTTP 404（由 notFoundHandler 处理）

**验证命令**:

```bash
API_PORT=${API_PORT:-3001}
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$API_PORT/api/acquisition/nonexistent")
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }
echo "OK: 404 for nonexistent sub-route"
```

**硬阈值**: HTTP 404

---

## E2E 验收（final-e2e 跑 — 唯一完整验证执行源）

**journey_type**: autonomous
**target_environment**: local_api

> **SSOT 声明**：下方脚本是所有 schema 验证的**唯一执行源**。Step 1 不重复 jq 命令。

```bash
#!/bin/bash
set -e

API_PORT=${API_PORT:-3001}
BASE_URL="http://localhost:$API_PORT"

# 0. 前置检查：API 已启动（防止因服务未就绪导致假阳性）
curl -sf "$BASE_URL/api/health" > /dev/null \
  || { echo "FATAL: API 服务未就绪 ($BASE_URL)，先启动再跑 E2E"; exit 2; }

# 1. 主链路：GET /api/acquisition/overview 完整 schema 验证
RESP=$(curl -sf "$BASE_URL/api/acquisition/overview")

echo "$RESP" | jq -e '.enabled == true' \
  || { echo "FAIL: enabled 不是 true"; exit 1; }

echo "$RESP" | jq -e '.feature == "smart-acquisition"' \
  || { echo "FAIL: feature 字面量错误"; exit 1; }

echo "$RESP" | jq -e '.capabilities | type == "array"' \
  || { echo "FAIL: capabilities 非 array"; exit 1; }

echo "$RESP" | jq -e '.capabilities == ["overview"]' \
  || { echo "FAIL: capabilities 初始值错误"; exit 1; }

echo "$RESP" | jq -e '.version == "1.0.0"' \
  || { echo "FAIL: version 错误"; exit 1; }

# 2. Schema 完整性（顶层 keys 完全等于，不多不少）
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' \
  || { echo "FAIL: schema 完整性失败"; exit 1; }

# 3. 禁用字段反向检查（全部 6 个）
for field in status data result payload info meta; do
  echo "$RESP" | jq -e "has(\"$field\") | not" \
    || { echo "FAIL: 禁用字段 $field 出现"; exit 1; }
done

# 4. error path — 不存在子路由返回 404
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/acquisition/nonexistent")
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }

echo "✅ Golden Path 验证通过"
```

**通过标准**: 脚本 exit 0

---

## Risks

| ID | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | API 服务未就绪（localhost:$API_PORT 无响应，curl -sf 挂起或返回 ConnectionRefused） | E2E 脚本所有 curl 断言失败，exit 2 | E2E 脚本开头加 `curl -sf .../health` 前置检查；若未就绪 exit 2 而非 1，评估器可区分"服务未启动"与"功能错误" |
| R2 | app.ts import 路径写错（如 `./routes/acquisitions` 多一个 s），导致 Express 启动报 MODULE_NOT_FOUND | GET /api/acquisition/overview → 500，不是 200，BEHAVIOR 全部 FAIL | ARTIFACT 条目验 app.ts 含字面量 `acquisitionRouter`；BEHAVIOR Step 1 curl -sf 返回非 2xx 立即 exit 1 |

---

## Workstreams

workstream_count: 1

### Workstream 1: acquisition.ts 路由实现 + app.ts 注册

**范围**: 新增 `apps/api/src/routes/acquisition.ts` 实现 `GET /overview`，修改 `apps/api/src/app.ts` import + 注册 `/api/acquisition`
**大小**: S（净增 ~35 行，2 文件）
**依赖**: 无

**DoD 文件**: `contract-dod-ws1.md`（含 [ARTIFACT] + [BEHAVIOR] 内嵌 manual:bash 命令）

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 红证据（TDD Red 实际失败输出） |
|---|---|---|---|
| WS1 | `tests/ws1/acquisition.test.ts` | enabled值/feature字面量/capabilities值/version值/schema完整性/禁用字段/error-path | **6 FAIL 2 pass**：①L9 `expected 404 to be 200`（路由未注册→notFoundHandler返404）②L15 `expected undefined to be true`（body无enabled字段）③L20 `expected undefined to be 'smart-acquisition'`④L25 `expected undefined to deeply equal ['overview']`⑤L30 `expected undefined to be '1.0.0'`⑥L36 `expected ['error'] to deeply equal ['capabilities','enabled','feature','version']`（body={error:{code:'NOT_FOUND'}}，keys=['error']）；L43禁用字段PASS（body无禁用字段）；L49 error-path PASS（nonexistent→404符合期望） |
