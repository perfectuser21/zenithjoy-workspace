# Sprint PRD — GET /api/acquisition/overview 端点

## OKR 对齐

- **对应 KR**：KR-ZJ1（智能获客能力上线）
- **当前进度**：0%
- **本次推进预期**：GET /api/acquisition/overview 端点可用，返回获客模块能力概览

## 背景

ZenithJoy 平台需要一个获客（acquisition）模块能力概览接口，供客户端和 Dashboard 探测当前获客功能的开关状态、功能标识、可用能力列表及版本号，以便按需展示或隐藏相关功能入口。

## Golden Path（核心场景）

客户端/Dashboard 从 `GET /api/acquisition/overview` → 读取获客模块元数据 → 按 `enabled` 字段决定是否渲染获客功能入口

具体：
1. 客户端向 `GET /api/acquisition/overview` 发起请求（携带 `Authorization: Bearer <license_key>` 头）
2. API 返回 HTTP 200，body 含 `{enabled, feature, capabilities, version}` 四个字段
3. 客户端可根据 `enabled: true/false` 决定展示逻辑；`capabilities` 列表用于细粒度功能开关

## Response Schema

### Endpoint: GET /api/acquisition/overview

**认证**：licenseAuth（`Authorization: Bearer <license_key>`）

**Success (HTTP 200)**:
```json
{
  "enabled": true,
  "feature": "smart_acquisition",
  "capabilities": ["platform_binding", "content_generation", "auto_publish"],
  "version": "1.0.0"
}
```
- `enabled` (boolean, 必填): 获客模块是否开启
- `feature` (string, 必填): 字面量 `"smart_acquisition"`，禁用变体 `acquisition`/`smartAcquisition`/`smart-acquisition`
- `capabilities` (string[], 必填): 可用能力数组，至少包含 1 个元素
- `version` (string, 必填): semver 格式，例如 `"1.0.0"`

**Error (HTTP 401)**:
```json
{"error": "Unauthorized"}
```

**禁用响应字段名**: `data`/`payload`/`result`/`status`/`info`（generator 不得自由发挥 key 名）

**Schema 完整性**: response 顶层 keys 必须**完全等于** `["enabled", "feature", "capabilities", "version"]`，不允许多余字段

## 边界情况

- 无有效 license → HTTP 401 `{"error": "Unauthorized"}`
- `capabilities` 可为空数组 `[]`（模块启用但无可用能力时）
- `enabled: false` 时，`capabilities` 应为 `[]`

## 范围限定

**在范围内**：
- `GET /api/acquisition/overview` 端点实现
- licenseAuth 鉴权
- 返回静态/配置驱动的 `{enabled, feature, capabilities, version}`

**不在范围内**：
- Dashboard UI 展示逻辑
- 获客流程的具体业务逻辑（平台绑定、内容生成等）
- acquisition 数据的增删改端点
- 动态能力注册机制

## 假设

- [ASSUMPTION: `enabled` 初始值为 `true`，表示获客模块已就绪]
- [ASSUMPTION: `capabilities` 初始值为 `["platform_binding", "content_generation", "auto_publish"]`]
- [ASSUMPTION: `version` 初始值为 `"1.0.0"`]
- [ASSUMPTION: 端点使用与其他 `apps/api` 路由一致的 licenseAuth 中间件]
- [ASSUMPTION: 端点为只读，无需写权限]

## 预期受影响文件

- `apps/api/src/routes/acquisition.ts`: 新增路由文件，实现 `GET /overview`
- `apps/api/src/app.ts`: 挂载 `acquisitionRouter` 到 `/api/acquisition`
- `.github/workflows/scripts/smoke/acquisition-overview-smoke.sh`: E2E smoke test（先写）

## E2E 验收

```bash
#!/bin/bash
# acquisition-overview-smoke.sh — 先于实现提交（E2E-First）
set -e

API_PORT=${API_PORT:-3000}
BASE_URL="http://localhost:${API_PORT}"

echo "=== Step 1: 服务健康检查 ==="
curl -f "${BASE_URL}/health" | jq -e '.status == "ok"'

echo "=== Step 2: 无 license → 401 ==="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${BASE_URL}/api/acquisition/overview")
[ "$STATUS" = "401" ] || { echo "FAIL: 期望 401，得到 $STATUS"; exit 1; }

echo "=== Step 3: 有效 license → 200 + 正确 schema ==="
RESP=$(curl -sf -H "Authorization: Bearer test-license-key" "${BASE_URL}/api/acquisition/overview")
echo "$RESP" | jq -e '.enabled == true'
echo "$RESP" | jq -e '.feature == "smart_acquisition"'
echo "$RESP" | jq -e '.capabilities | type == "array"'
echo "$RESP" | jq -e '.version | test("^[0-9]+\\.[0-9]+\\.[0-9]+$")'

echo "=== Step 4: 响应无多余字段 ==="
KEY_COUNT=$(echo "$RESP" | jq 'keys | length')
[ "$KEY_COUNT" = "4" ] || { echo "FAIL: 期望 4 个顶层 key，得到 $KEY_COUNT"; exit 1; }

echo "✅ acquisition /overview smoke 全部通过"
```

---

## journey_type: autonomous
## journey_type_reason: 纯后端 API 端点，无 Dashboard UI 交互，无 Windows 客户端依赖
## target_environment: local_api
## target_environment_reason: 在本地运行 apps/api 服务（curl localhost:3000），用 licenseAuth 测试，无需真实 DB 或外部服务
