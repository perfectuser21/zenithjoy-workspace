# Sprint Contract Draft (Round 1)

## Golden Path

[客户端] → [GET /api/acquisition/overview] → [API 返回 HTTP 200 + JSON 元数据 {enabled, feature, capabilities, version}]

---

### Step 1: 客户端发起 GET /api/acquisition/overview（无鉴权）

**可观测行为**: API 返回 HTTP 200，body 含且仅含 4 个顶层字段 `enabled`/`feature`/`capabilities`/`version`，无需 Authorization header，硬编码静态返回

**验证命令**:

```bash
API_PORT=${API_PORT:-3001}
curl -sf "http://localhost:$API_PORT/api/acquisition/overview" > /dev/null
echo "OK: 端点可达，HTTP 2xx"
```

**硬阈值**: HTTP 200，耗时 < 3s

---

### Step 2: API 返回 schema 完整正确（完整 jq 验证）

**可观测行为**: 4 个字段值严格匹配，顶层 keys 完全等于 `["capabilities","enabled","feature","version"]`，禁用字段不存在

**验证命令**:

```bash
API_PORT=${API_PORT:-3001}
RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview")

echo "$RESP" | jq -e '.enabled == true' || { echo "FAIL: enabled"; exit 1; }
echo "$RESP" | jq -e '.feature == "smart-acquisition"' || { echo "FAIL: feature"; exit 1; }
echo "$RESP" | jq -e '.capabilities == ["overview"]' || { echo "FAIL: capabilities"; exit 1; }
echo "$RESP" | jq -e '.version == "1.0.0"' || { echo "FAIL: version"; exit 1; }
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' || { echo "FAIL: schema completeness"; exit 1; }

for field in status data result payload info meta; do
  echo "$RESP" | jq -e "has(\"$field\") | not" || { echo "FAIL: 禁用字段 $field 出现"; exit 1; }
done

echo "OK: schema 验证通过"
```

**硬阈值**: 全部 jq -e 断言 exit 0

---

### Step 3: 不存在的子路由返回 404

**可观测行为**: `GET /api/acquisition/nonexistent` 返回 HTTP 404

**验证命令**:

```bash
API_PORT=${API_PORT:-3001}
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$API_PORT/api/acquisition/nonexistent")
[ "$CODE" = "404" ] || { echo "FAIL: 期望 404 实际 $CODE"; exit 1; }
echo "OK: 404 for nonexistent sub-route"
```

**硬阈值**: HTTP 404

---

## E2E 验收（final-e2e 跑 — target_environment=local_api）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

API_PORT=${API_PORT:-3001}
BASE_URL="http://localhost:$API_PORT"

# 0. 前置检查：API 已启动
curl -sf "$BASE_URL/api/health" > /dev/null \
  || { echo "FATAL: API 服务未就绪 ($BASE_URL)，先启动再跑 E2E"; exit 2; }

# 1. 主链路：GET /api/acquisition/overview 完整 schema 验证
RESP=$(curl -sf "$BASE_URL/api/acquisition/overview")

echo "$RESP" | jq -e '.enabled == true' \
  || { echo "FAIL: enabled 不是 true"; exit 1; }

echo "$RESP" | jq -e '.feature == "smart-acquisition"' \
  || { echo "FAIL: feature 字面量错误（禁用变体 acquisition/smart_acquisition/smartAcquisition）"; exit 1; }

echo "$RESP" | jq -e '.capabilities | type == "array"' \
  || { echo "FAIL: capabilities 非 array"; exit 1; }

echo "$RESP" | jq -e '.capabilities == ["overview"]' \
  || { echo "FAIL: capabilities 初始值错误"; exit 1; }

echo "$RESP" | jq -e '.version == "1.0.0"' \
  || { echo "FAIL: version 错误"; exit 1; }

# 2. Schema 完整性（顶层 keys 完全等于，不多不少）
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' \
  || { echo "FAIL: schema 完整性失败（多余或缺少 key）"; exit 1; }

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
| R1 | API 服务未就绪（localhost:$API_PORT 无响应）| E2E 全部 curl 断言失败 | E2E 脚本开头加 /api/health 前置检查；未就绪 exit 2（可区分"服务未启动"与"功能错误"）|
| R2 | app.ts import 路径写错导致 MODULE_NOT_FOUND | GET /api/acquisition/overview → 500 | ARTIFACT 条目验 app.ts 含字面量 `acquisitionRouter`；Step 1 curl -sf 非 2xx 立即 exit 1 |

---

## Workstreams

workstream_count: 1

### Workstream 1: acquisition.ts 路由实现 + app.ts 注册

**范围**: 新增 `apps/api/src/routes/acquisition.ts` 实现 `GET /overview`，修改 `apps/api/src/app.ts` import + 注册 `/api/acquisition`
**大小**: S（净增 ~35 行，2 文件）
**依赖**: 无

**DoD 文件**: `contract-dod-ws1.md`

---

## Workstreams 切分说明

整体净增 < 35 行，ws_count=1 符合规则（整 contract 净增 < 200 行）。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/acquisition.test.ts` | enabled值/feature字面量/capabilities值/version值/schema完整性/禁用字段/error-path | 路由未注册时 8 个 it() → HTTP 404 (notFoundHandler) → 多项 expect FAIL |
