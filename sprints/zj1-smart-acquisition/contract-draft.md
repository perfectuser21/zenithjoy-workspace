# Sprint Contract Draft (Round 1)

## Golden Path

[客户端发起请求] → [Step 1: licenseAuth 鉴权] → [Step 2: 路由处理返回概览] → [Step 3: 客户端消费 enabled 字段] → [出口: 获客入口渲染决策完成]

---

### Step 1: 无有效 license 时拦截并返回 401

**可观测行为**: `GET /api/acquisition/overview` 在无 `Authorization: Bearer` 头时，返回 HTTP 401 + `{"error":"Unauthorized"}`，不暴露内部路由逻辑

**验证命令**:
```bash
API_PORT="${API_PORT:-3000}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${API_PORT}/api/acquisition/overview")
[ "$CODE" = "401" ] || { echo "FAIL: 期望 401，得到 $CODE"; exit 1; }
BODY=$(curl -s "http://localhost:${API_PORT}/api/acquisition/overview")
echo "$BODY" | jq -e 'has("error")' || { echo "FAIL: 401 响应缺少 error 字段"; exit 1; }
echo "$BODY" | jq -e '.error | type == "string"' || { echo "FAIL: error 字段非 string"; exit 1; }
echo "✅ Step 1 通过"
```

**硬阈值**: HTTP 状态码 = 401，响应 body `has("error") == true`

---

### Step 2: 有效 license 返回获客模块能力概览（四字段 schema）

**可观测行为**: 携带有效 Bearer token 的 `GET /api/acquisition/overview` 返回 HTTP 200，body 精确包含 `{enabled, feature, capabilities, version}` 四个顶层字段，无多余字段

**验证命令**:
```bash
API_PORT="${API_PORT:-3000}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"

# 创建测试 license
LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"basic","customer_name":"smoke-acq-contract"}' | jq -r '.data.license_key // empty')
[ -n "$LK" ] || { echo "FAIL: 无法生成测试 license"; exit 1; }

# 调用被测端点
RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview")

# 字段值验证（PRD 字面 key）
echo "$RESP" | jq -e '.enabled == true' || { echo "FAIL: enabled != true"; exit 1; }
echo "$RESP" | jq -e '.feature == "smart_acquisition"' || { echo "FAIL: feature 错误"; exit 1; }
echo "$RESP" | jq -e '.capabilities | type == "array"' || { echo "FAIL: capabilities 非 array"; exit 1; }
echo "$RESP" | jq -e '.capabilities | length >= 1' || { echo "FAIL: capabilities 为空"; exit 1; }
echo "$RESP" | jq -e '.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")' || { echo "FAIL: version 非 semver"; exit 1; }

# Schema 完整性（jq keys 字母序）
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' || { echo "FAIL: 顶层 keys 不匹配"; exit 1; }

# 禁用字段反向检查
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data 出现"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not' || { echo "FAIL: 禁用字段 payload 出现"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result 出现"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status 出现"; exit 1; }
echo "$RESP" | jq -e 'has("info") | not' || { echo "FAIL: 禁用字段 info 出现"; exit 1; }

echo "✅ Step 2 通过"
```

**硬阈值**: HTTP 200，`keys == ["capabilities","enabled","feature","version"]`，各字段类型正确，无禁用字段，耗时 < 500ms

---

### Step 3: 客户端读取 enabled 字段做渲染决策（Golden Path 出口验证）

**可观测行为**: `enabled == true` 且 `capabilities` 包含 `platform_binding`/`content_generation`/`auto_publish` 三项默认能力，`version` 为 `"1.0.0"`，feature 固定为 `"smart_acquisition"`

**验证命令**:
```bash
API_PORT="${API_PORT:-3000}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"
LK=$(curl -fs -X POST "http://localhost:${API_PORT}/api/admin/license" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"basic","customer_name":"smoke-acq-step3"}' | jq -r '.data.license_key // empty')
[ -n "$LK" ] || { echo "FAIL: 无法生成测试 license"; exit 1; }

RESP=$(curl -sf -H "Authorization: Bearer $LK" "http://localhost:${API_PORT}/api/acquisition/overview")
echo "$RESP" | jq -e '.capabilities | contains(["platform_binding","content_generation","auto_publish"])' \
  || { echo "FAIL: capabilities 缺少默认三项"; exit 1; }
echo "$RESP" | jq -e '.version == "1.0.0"' || { echo "FAIL: version != 1.0.0"; exit 1; }
echo "$RESP" | jq -e '.feature == "smart_acquisition"' || { echo "FAIL: feature 字段漂移"; exit 1; }

echo "✅ Step 3 通过 — Golden Path 完成"
```

**硬阈值**: capabilities 含三项默认能力，version = "1.0.0"，feature 字面量匹配

---

## E2E 验收（final-e2e — local_api 模板）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
# acquisition-overview-smoke.sh — E2E-First 先于实现提交
set -e

API_PORT="${API_PORT:-3000}"
BASE_URL="http://localhost:${API_PORT}"
INTERNAL_TOKEN="${ZENITHJOY_INTERNAL_TOKEN:-internal-dev-token}"

echo "=== Step 1: 服务健康检查 ==="
curl -f "${BASE_URL}/health" | jq -e '.status == "ok"'

echo "=== Step 2: 无 license → 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/acquisition/overview")
[ "$STATUS" = "401" ] || { echo "FAIL: 期望 401，得到 $STATUS"; exit 1; }
BODY=$(curl -s "${BASE_URL}/api/acquisition/overview")
echo "$BODY" | jq -e 'has("error")' || { echo "FAIL: 401 响应缺 error 字段"; exit 1; }

echo "=== Step 3: 生成测试 license ==="
LK=$(curl -fs -X POST "${BASE_URL}/api/admin/license" \
  -H "X-Internal-Token: $INTERNAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tier":"basic","customer_name":"e2e-acq-smoke"}' | jq -r '.data.license_key // empty')
[ -n "$LK" ] || { echo "FAIL: 无法生成测试 license"; exit 1; }
echo "license_key=$LK"

echo "=== Step 4: 有效 license → 200 + 正确 schema ==="
RESP=$(curl -sf -H "Authorization: Bearer $LK" "${BASE_URL}/api/acquisition/overview")
echo "$RESP" | jq -e '.enabled == true'
echo "$RESP" | jq -e '.feature == "smart_acquisition"'
echo "$RESP" | jq -e '.capabilities | type == "array"'
echo "$RESP" | jq -e '.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")'

echo "=== Step 5: Schema 完整性 — 顶层 keys 精确匹配 ==="
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' \
  || { echo "FAIL: 顶层 keys 不匹配，期望 [capabilities,enabled,feature,version]"; exit 1; }

echo "=== Step 6: 禁用字段反向检查 ==="
echo "$RESP" | jq -e 'has("data") | not' || { echo "FAIL: 禁用字段 data"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not' || { echo "FAIL: 禁用字段 payload"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not' || { echo "FAIL: 禁用字段 result"; exit 1; }
echo "$RESP" | jq -e 'has("status") | not' || { echo "FAIL: 禁用字段 status"; exit 1; }
echo "$RESP" | jq -e 'has("info") | not' || { echo "FAIL: 禁用字段 info"; exit 1; }

echo "=== Step 7: feature 禁用变体检查 ==="
echo "$RESP" | jq -e '.feature != "acquisition"' || { echo "FAIL: 用了禁用变体 acquisition"; exit 1; }
echo "$RESP" | jq -e '.feature != "smartAcquisition"' || { echo "FAIL: 用了禁用变体 smartAcquisition"; exit 1; }
echo "$RESP" | jq -e '.feature != "smart-acquisition"' || { echo "FAIL: 用了禁用变体 smart-acquisition"; exit 1; }

echo "=== Step 8: 默认能力列表验证 ==="
echo "$RESP" | jq -e '.capabilities | contains(["platform_binding","content_generation","auto_publish"])'

echo "✅ acquisition /overview E2E smoke 全部通过"
```

**通过标准**: 脚本 exit 0

---

## Workstreams

workstream_count: 2

### Workstream 1: E2E smoke test（E2E-First 先提交）

**范围**: `.github/workflows/scripts/smoke/acquisition-overview-smoke.sh` — 定义"完成"的验收条件，API 实现前先写红测试
**大小**: S（~30 行）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/acquisition-smoke-structure.test.ts`

---

### Workstream 2: 路由实现 + app.ts 挂载

**范围**: `apps/api/src/routes/acquisition.ts`（新增路由）+ `apps/api/src/app.ts`（挂载 `/api/acquisition`）
**大小**: S（~55 行净增）
**依赖**: Workstream 1 完成后

**BEHAVIOR 覆盖测试文件**: `tests/ws2/acquisition-route.test.ts`

---

## Workstreams 切分合规说明（v7.7）

整 contract 净增估算：ws1 ~30 行 + ws2 ~55 行 = ~85 行 < 200 行上限。
两个 ws 均 ≤ 200 行，≤ 3 文件。ws2 depends_on ws1（E2E-First 强制串行）。

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/acquisition-smoke-structure.test.ts` | smoke 文件结构完整性 | smoke 文件不存在 → 1 failure |
| WS2 | `tests/ws2/acquisition-route.test.ts` | 端点 schema 验证 / 401 / 字段值 | 路由文件不存在 → import 报错 |
