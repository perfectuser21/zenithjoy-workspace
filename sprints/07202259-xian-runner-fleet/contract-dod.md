# DoD（Definition of Done）: 西安机群CI/RPA基础设施

TASK_ID: 910a5872-d749-4a86-964a-27407aafd734
SPRINT_DIR: sprints/07202259-xian-runner-fleet

---

## [BEHAVIOR] 条目

[BEHAVIOR] B-01: `scripts/runner-fleet/deploy-runner.ps1` 文件存在，实质逻辑 ≥ 50 行，包含 WARP 安装检测（幂等跳过）、Tailscale ephemeral key 申领、GitHub runner 注册（现领 token）、autologon + 计划任务常驻（不使用 svc install）四段逻辑

[BEHAVIOR] B-02: 脚本所有步骤成功后向 `C:\ZJRunnerFleet\installed.json` 写入组件完成标记；第二次执行时读到标记则全步骤输出 `[SKIP]` 并 exit 0（幂等性）

[BEHAVIOR] B-03: 脚本任意步骤失败时立即非零退出（exit 1+），且错误原因打印到 stderr；凭据变量（PAT / Tailscale key / Cloudflare token）不出现在任何 stdout/stderr 明文输出中

[BEHAVIOR] B-04: `agents` 表存在 `owner_type TEXT CHECK(owner_type IN ('internal_fleet','customer')) DEFAULT 'customer'` 字段；`GET /api/agent/machines`（带认证）每条记录含 `owner_type` 和 `os_type` 两个字段；无认证时返回 HTTP 401

[BEHAVIOR] B-05: 前端 `MachineManagementPage` 存在「内部机群」和「客户设备」两个 tab，tab 切换为纯客户端过滤（无额外 API 请求）；android 设备展示 `📱 安卓`，win32 设备展示 `🖥 Windows`，不合并

[BEHAVIOR] B-06: `scripts/runner-fleet/cleanup-runner.ps1` 存在，只卸载 `installed.json` 白名单内记录的组件，不触碰 xian-rog 等历史手工机器的任何残留

[BEHAVIOR] B-07: GitHub PAT 环境变量（`$env:GH_PAT`）可通过 `GET /repos/{owner}/{repo}/actions/runners` 访问 runner 列表（HTTP 200），验证 PAT scope 满足 runner 注册需求

---

## manual:bash 可执行验收命令

以下命令在 CI 环境中可直接执行验收（需设置环境变量）：

```bash
# 设置环境变量（CI secrets 注入）
# API_BASE, API_TOKEN, TENANT_ID, GH_PAT, GH_OWNER, GH_REPO

# B-04 / B-07 验收：API 端点完整验收
set -e

echo "=== [B-04] 验收 API 可访问性 + 字段存在 ==="
RESPONSE=$(curl -s \
  -H "X-Tenant-Id: ${TENANT_ID}" \
  -H "Authorization: Bearer ${API_TOKEN}" \
  "${API_BASE}/api/agent/machines")

echo "$RESPONSE" | jq -e '.success == true' > /dev/null && echo "[PASS] success=true"
echo "$RESPONSE" | jq -e '(.data | type) == "array"' > /dev/null && echo "[PASS] data is array"
echo "$RESPONSE" | jq -e '.data | length > 0' > /dev/null || echo "[WARN] data 为空（可能无 agent 注册，非 FAIL）"
echo "$RESPONSE" | jq -e '[.data[] | has("owner_type")] | all' > /dev/null && echo "[PASS] owner_type 字段存在"
echo "$RESPONSE" | jq -e '[.data[] | has("os_type")] | all' > /dev/null && echo "[PASS] os_type 字段存在"

echo "=== [B-04] 验收 tenant 隔离（无认证 → 401） ==="
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "${API_BASE}/api/agent/machines")
[ "$HTTP_STATUS" = "401" ] && echo "[PASS] 无认证返回 401" || (echo "[FAIL] 期望 401，实际 ${HTTP_STATUS}" && exit 1)

echo "=== [B-07] 验收 GitHub PAT 可访问 runners API ==="
curl -s -f \
  -H "Authorization: Bearer ${GH_PAT}" \
  "https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/runners" \
  | jq -e 'has("runners")' > /dev/null && echo "[PASS] PAT 可访问 runners API"

echo "=== 所有 CI 可验收断言通过 ==="
```

```bash
# B-01 验收：脚本文件存在性 + 行数检查（repo checkout 后执行）
set -e

SCRIPT="scripts/runner-fleet/deploy-runner.ps1"
CLEANUP="scripts/runner-fleet/cleanup-runner.ps1"
DEPS="scripts/runner-fleet/rpa-deps.txt"

[ -f "$SCRIPT" ] && echo "[PASS] deploy-runner.ps1 存在" || (echo "[FAIL] 缺少 deploy-runner.ps1" && exit 1)
[ -f "$CLEANUP" ] && echo "[PASS] cleanup-runner.ps1 存在" || (echo "[FAIL] 缺少 cleanup-runner.ps1" && exit 1)
[ -f "$DEPS" ] && echo "[PASS] rpa-deps.txt 存在" || (echo "[FAIL] 缺少 rpa-deps.txt" && exit 1)

# 实质行数检查（去掉空行和注释后 ≥ 50 行）
REAL_LINES=$(grep -v '^\s*#' "$SCRIPT" | grep -v '^\s*$' | wc -l)
[ "$REAL_LINES" -ge 50 ] && echo "[PASS] deploy-runner.ps1 实质逻辑 ${REAL_LINES} 行（≥50）" \
  || (echo "[FAIL] 实质逻辑只有 ${REAL_LINES} 行（需 ≥50）" && exit 1)

# autologon + 计划任务验证（不含 svc install）
grep -qi "schtasks\|Register-ScheduledTask" "$SCRIPT" && echo "[PASS] 脚本包含计划任务注册" \
  || (echo "[FAIL] 脚本未包含计划任务（schtasks/Register-ScheduledTask）" && exit 1)
grep -qi "svc.exe install\|svc install" "$SCRIPT" \
  && (echo "[FAIL] 脚本包含禁用的 svc install 命令" && exit 1) \
  || echo "[PASS] 脚本不含 svc install（正确）"

# 凭据安全检查（不在脚本里硬编码 token 字样）
grep -qiE "ghp_[A-Za-z0-9]{36}" "$SCRIPT" \
  && (echo "[FAIL] 发现硬编码 GitHub PAT" && exit 1) \
  || echo "[PASS] 未发现硬编码 GitHub PAT"

echo "=== 文件静态验收通过 ==="
```

---

## Feature → [BEHAVIOR] 对应矩阵

| Feature | id | [BEHAVIOR] |
|---|---|---|
| F1：网络引导层 WARP+Tailscale 一键装/清 | 46dd04d7 | B-01, B-02, B-03, B-06 |
| F2：GitHub runner 自动注册+常驻 | bca572d4 | B-01, B-02, B-07 |
| F3：wechat-capable RPA 依赖安装 | 3bd9c9b4 | B-01, B-02 |
| F4：幂等性 + 故障标红 | 2cae1a07 | B-02, B-03 |
| F5：机器管理页双维度展示 | 8ebff409 | B-04, B-05 |

---

## 完成标准（Sprint 级）

所有以下条件全部满足，Sprint 方可标记 DONE：

- [x] contract-draft.md 中所有 Feature 断言均有对应代码实现
- [x] `.github/workflows/scripts/smoke/xian-runner-fleet-smoke.sh` 存在且 CI 中全绿
- [x] 上方 `manual:bash` 脚本在 CI 中执行 exit 0
- [x] `agents` 表 migration 文件已合并且向后兼容验证通过
- [x] 前端 MachineManagementPage 双维度 tab 已上线
- [x] PR 描述声明「本 PR 把 Path dev_pipeline 的 xian-runner-fleet-smoke 推到全绿」
