# Sprint Contract Draft (Round 1)

## Golden Path

[客户端] → [GET /api/acquisition/overview] → [API 返回 HTTP 200 + JSON 元数据 {enabled, feature, capabilities, version}]

---

### Step 1: 客户端发起 GET /api/acquisition/overview

**可观测行为**: API 返回 HTTP 200，body 含且仅含 4 个字段 `enabled`/`feature`/`capabilities`/`version`，无鉴权要求，硬编码静态返回

**验证命令**:
```bash
API_PORT=${API_PORT:-3001}
RESP=$(curl -sf "http://localhost:$API_PORT/api/acquisition/overview")

# 1. enabled 字段值 = true
echo "$RESP" | jq -e '.enabled == true' || { echo "FAIL: enabled 不是 true"; exit 1; }

# 2. feature 字面量精确匹配
echo "$RESP" | jq -e '.feature == "smart-acquisition"' || { echo "FAIL: feature 字面量错误"; exit 1; }

# 3. capabilities 类型 + 值
echo "$RESP" | jq -e '.capabilities | type == "array"' || { echo "FAIL: capabilities 非 array"; exit 1; }
echo "$RESP" | jq -e '.capabilities == ["overview"]' || { echo "FAIL: capabilities 初始值错误"; exit 1; }

# 4. version 值
echo "$RESP" | jq -e '.version == "1.0.0"' || { echo "FAIL: version 错误"; exit 1; }

# 5. Schema 完整性 — 顶层 keys 完全等于（jq 按字母排序）
echo "$RESP" | jq -e 'keys == ["capabilities","enabled","feature","version"]' || { echo "FAIL: schema 完整性失败（多余或缺少字段）"; exit 1; }

# 6. 禁用字段反向检查
echo "$RESP" | jq -e 'has("status") | not'  || { echo "FAIL: 禁用字段 status 出现"; exit 1; }
echo "$RESP" | jq -e 'has("data") | not'    || { echo "FAIL: 禁用字段 data 出现"; exit 1; }
echo "$RESP" | jq -e 'has("result") | not'  || { echo "FAIL: 禁用字段 result 出现"; exit 1; }
echo "$RESP" | jq -e 'has("payload") | not' || { echo "FAIL: 禁用字段 payload 出现"; exit 1; }
echo "$RESP" | jq -e 'has("info") | not'    || { echo "FAIL: 禁用字段 info 出现"; exit 1; }
echo "$RESP" | jq -e 'has("meta") | not'    || { echo "FAIL: 禁用字段 meta 出现"; exit 1; }
```

**硬阈值**: HTTP 200，keys 完全等于 `["capabilities","enabled","feature","version"]`，耗时 < 3s

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

## E2E 验收（final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

```bash
#!/bin/bash
set -e

API_PORT=${API_PORT:-3001}
BASE_URL="http://localhost:$API_PORT"

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

## Workstreams

workstream_count: 1

### Workstream 1: acquisition.ts 路由实现 + app.ts 注册

**范围**: 新增 `apps/api/src/routes/acquisition.ts` 实现 `GET /overview`，修改 `apps/api/src/app.ts` import + 注册 `/api/acquisition`
**大小**: S（净增 ~35 行，2 文件）
**依赖**: 无

**BEHAVIOR 覆盖测试文件**: `tests/ws1/acquisition.test.ts`

---

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/ws1/acquisition.test.ts` | enabled值/feature字面量/schema完整性/禁用字段/capabilities值/error-path | WS1 → 导入失败 → N failures |
