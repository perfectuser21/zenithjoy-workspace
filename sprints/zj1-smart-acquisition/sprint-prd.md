# Sprint PRD — GET /api/acquisition/overview 端点实现

## OKR 对齐

- **对应 KR**：KR-acquisition（智能获客模块能力就绪）
- **当前进度**：0%
- **本次推进预期**：25%（overview 端点上线，前端/Agent 可查询能力元数据）

## 背景

ZenithJoy 智能获客模块需要一个能力描述端点，供前端或 Agent 查询当前获客功能的启用状态、子能力列表及版本，作为模块的入口元数据接口。

## Golden Path（核心场景）

前端 / Agent 从 `GET /api/acquisition/overview` → API 返回能力元数据 → 得到 `{enabled, feature, capabilities, version}` JSON。

具体：
1. 客户端发起 `GET /api/acquisition/overview`（无需鉴权）
2. API 返回 HTTP 200 + JSON，含启用状态、功能标识、能力列表、版本
3. 客户端据此判断功能可用性及支持的子能力

## Response Schema

### Endpoint: GET /api/acquisition/overview

**Query Parameters**: 无

**Success (HTTP 200)**:
```json
{
  "enabled": true,
  "feature": "smart-acquisition",
  "capabilities": ["overview"],
  "version": "1.0.0"
}
```

- `enabled` (boolean, 必填): 功能是否启用
- `feature` (string, 必填): 功能标识，字面量 `"smart-acquisition"`，禁用变体 `acquisition`/`smart_acquisition`/`smartAcquisition`
- `capabilities` (string[], 必填): 当前支持的子能力，初始值 `["overview"]`
- `version` (string, 必填): 语义化版本，初始值 `"1.0.0"`

**禁用响应字段名**: `status`/`data`/`result`/`payload`/`info`/`meta`

**Schema 完整性**: response 顶层 keys 完全等于 `["enabled", "feature", "capabilities", "version"]`，禁止多余字段

## 边界情况

- 无鉴权（只读静态元数据，与 `/health` 同级开放）
- 无数据库查询（初始硬编码返回）
- 不存在的子路由返回标准 404

## 范围限定

**在范围内**：`GET /api/acquisition/overview` 实现，注册到 app.ts
**不在范围内**：动态 enabled 开关、DB 持久化、其他 acquisition 子路由、鉴权

## 假设

- [ASSUMPTION: enabled 初始值 true，硬编码静态返回，不读 DB]
- [ASSUMPTION: capabilities 初始为 `["overview"]`]
- [ASSUMPTION: 无需 auth middleware]

## 预期受影响文件

- `apps/api/src/routes/acquisition.ts`: 新增路由文件
- `apps/api/src/app.ts`: import + 注册 `/api/acquisition`

## E2E 验收

```bash
# curl 验证（API 已启动，PORT 为实际端口）
curl -sf http://localhost:$API_PORT/api/acquisition/overview \
  | jq -e '.enabled == true
    and .feature == "smart-acquisition"
    and (.capabilities | type == "array")
    and (.version | length > 0)'
echo "✅ GET /api/acquisition/overview 验证通过"
```

## journey_type: autonomous
## journey_type_reason: 纯后端 API 端点，无 Dashboard UI，无 Windows App，为后端服务能力描述接口
## target_environment: local_api
## target_environment_reason: apps/api 本地运行，curl localhost 验证响应 schema，无需浏览器或 GitHub Actions runner
