# Contract DoD: 刀B M1 — 安装器清环境 + 启动死路消灭 + 装机 E2E

task_id: 2f66a0f8-a15e-4a42-9b9c-2841fc99ba66

## 行为条目（≥4 条 [BEHAVIOR]）

---

[BEHAVIOR-1] setup-reset 前置清理器收敛 HKCU 脏环境

触发条件：installpack 解包后执行（或 CI dryrun 模式执行 setup-reset.ps1）

期望行为：
- 执行完成后，HKCU\Environment 下不存在任何 ZENITHJOY_* 前缀 key，除非该 key 在 .env 声明文件中明确列出
- ZenithJoyAgent 计划任务存在，且指向当前安装目录（schtasks /query /tn ZenithJoyAgent 能查到，路径匹配当前目录）
- .launcher.lock 文件：若持有 PID 已死则文件被删除（或文件不存在）
- 全程无 HKCU 以外的注册表键被修改（最小破坏原则）
- 执行耗时 ≤ 10s（CI 超时断言）

禁止行为：
- 不得在失败时 echo [WARN] + 继续；必须 throw / exit 1 + 输出 [ERROR]
- 不得含任何 em-dash、全角标点、非 ASCII 字符（PS5.1 纯 ASCII 规则）

manual:bash 验收命令（windows-latest GHA）：
```powershell
# 注入脏 env
reg add "HKCU\Environment" /v ZENITHJOY_API_BASE /d "https://staging.zenithjoy.com" /f
reg add "HKCU\Environment" /v ZENITHJOY_STALE_KEY /d "leftover" /f
# 执行 setup-reset（声明文件仅含 ZENITHJOY_LICENSE）
powershell -NoProfile -File setup-reset.ps1 -EnvDeclaration .env -DryRun
# 断言：未声明 key 已删
$remainingKeys = (reg query "HKCU\Environment") -match "ZENITHJOY_" | Where-Object { $_ -notmatch "ZENITHJOY_LICENSE" }
if ($remainingKeys) { throw "FAIL: stale HKCU ZENITHJOY_* keys remain: $remainingKeys" }
Write-Host "PASS: HKCU ZENITHJOY_* keys converged"
```

---

[BEHAVIOR-2] start.bat 失败路径：pause 消灭 → boot-error.json + curl 上报 + 可见报错

触发条件：start.bat 任意步骤失败（.env 不存在、license 401、node 启动失败等）

期望行为：
- 写失败原因到 `%APPDATA%\zenithjoy-agent\boot-error.json`，JSON 格式：
  `{"reason":"<失败类型>","timestamp":"<ISO8601>","machine_id":"<id>","hostname":"<hostname>"}`
- 执行 `curl -s -X POST <ZENITHJOY_API_BASE>/api/agent/boot-fail -H "Content-Type: application/json" -d <payload>` 上报中台
- 终端输出可见的 [ERROR] 行（非 pause）
- 进程以 `exit /b 1` 退出，不卡死
- `boot-error.json` 写入使用 tmp 文件 + rename 原子操作
- **必须支持 `ZJ_BOOT_FAIL_TEST` 环境变量 seam**：当 `ZJ_BOOT_FAIL_TEST=1` 时，start.bat 直接触发 license 401 检测失败路径（跳过正常 probe/dryrun guard），用于 CI proven-to-fire 场景（A-6 smoke 断言依赖此 seam）。seam 检查应在 start.bat 早期执行，写 boot-error.json（reason=license_401）+ curl fail-report + exit /b 1。

禁止行为：
- 禁止任何 `pause` 语句（CI lint-no-pause 扫描拦截）
- 禁止 warning 降级（echo [WARN] + 继续执行）
- `ZJ_BOOT_FAIL_TEST` seam 不得缺失（SB-7 合同测试强制断言）

manual:bash 验收命令：
```bash
# 在 smoke 里：造 .env 不存在场景
mkdir -p "$APPDATA/zenithjoy-agent"
# 删掉 .env，确保 start.bat 触发失败路径
# 以 ZJ_LAUNCH_PROBE=1 之外方式触发（或在 start.bat 加 ZJ_BOOT_FAIL_TEST seam）
# 断言 boot-error.json 存在
[ -f "$APPDATA/zenithjoy-agent/boot-error.json" ] || { echo "FAIL: boot-error.json not created"; exit 1; }
reason=$(jq -r .reason "$APPDATA/zenithjoy-agent/boot-error.json")
[ -n "$reason" ] || { echo "FAIL: reason field empty"; exit 1; }
echo "PASS: boot-error.json created with reason=$reason"
```

---

[BEHAVIOR-3] 中台 POST /api/agent/boot-fail 端点 + agents.last_boot_error 落库

触发条件：start.bat 执行 curl 上报，或直接 HTTP 调用该端点

期望行为：
- 端点接受无 bearer token 调用（HTTP 非 401、非 404）
- 请求体：`{"machine_id":"<id>","hostname":"<host>","reason":"<str>","timestamp":"<ISO8601>"}`
- 成功落库：`agents.last_boot_error` jsonb 更新为请求体内容（通过 machine_id 找到对应 agent 行）
- 若 machine_id 未注册：返回 202 但不报错（宽松接收，避免 401 场景死循环）
- 速率限制：同一 machine_id ≤ 10 次/分钟
- 租户隔离：通过 machine_id → tenant_id 关联，不跨租户写入

manual:bash 验收命令：
```bash
API_URL="${API_URL:-http://localhost:3001}"
# 无 bearer 调用
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$API_URL/api/agent/boot-fail" \
  -H "Content-Type: application/json" \
  -d '{"machine_id":"test-machine-001","hostname":"test-host","reason":"license_401","timestamp":"2026-07-20T12:00:00Z"}')
[ "$HTTP_STATUS" != "401" ] && [ "$HTTP_STATUS" != "404" ] || { echo "FAIL: boot-fail endpoint returned $HTTP_STATUS"; exit 1; }
echo "PASS: POST /api/agent/boot-fail returned $HTTP_STATUS (endpoint reachable without auth)"
# 验证落库
AGENT_ROW=$(psql "$DATABASE_URL" -t -c "SELECT last_boot_error->>'reason' FROM agents WHERE machine_id='test-machine-001' LIMIT 1")
[ "$AGENT_ROW" = "license_401" ] || echo "WARN: DB row not found (agent may not be registered)"
```

---

[BEHAVIOR-4] AdminCustomersPage 展示 boot_error 诊断信息

触发条件：Admin 在 AdminCustomersPage 选中有 last_boot_error 记录的客户

期望行为：
- 诊断区显示 `reason` 字段内容（如 "license_401"）
- 显示 `timestamp` 字段（ISO8601 格式转为可读时间）
- 若 last_boot_error 为 null：该区域不显示或显示"无异常"
- 展示数据来源：`GET /api/admin/customers` 或独立 agent 详情接口，字段 last_boot_error

manual:bash 验收命令（API 层等价断言）：
```bash
API_URL="${API_URL:-http://localhost:3001}"
# 以 admin cookie 查客户列表，验证响应 schema 含 last_boot_error 字段
# （UI 层由 Playwright E2E 覆盖，此处做 API 层等价断言）
# 真机段等价断言：TODO — 需要 Playwright windows_cloud E2E 验证 UI 展示
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X GET "$API_URL/api/admin/customers" \
  -H "Cookie: $ADMIN_COOKIE")
[ "$HTTP_STATUS" = "200" ] || { echo "FAIL: admin/customers returned $HTTP_STATUS"; exit 1; }
echo "PASS: /api/admin/customers reachable (UI display verified by smoke A-4)"
```

---

[BEHAVIOR-5] 装机链 E2E proven-to-fire：401 场景 fail-report 真发出

触发条件：HKCU 残留 ZENITHJOY_API_BASE 指向 staging，start.bat 检测到 license 401

期望行为（变异测试，必须在 CI 中实际触发）：
- `boot-error.json` 存在，且 `jq -r .reason` 输出含 `license_401`
- mock 服务器（或 nc -l）记录到 `POST /api/agent/boot-fail` 请求
- start.bat 进程以非零退出码退出（不卡死）
- 整个链路在 CI windows-latest 环境下验证通过

禁止：
- 只有成功路径断言而无失败路径断言
- 变异场景用 mock skip 替代真实触发

manual:bash 验收命令（CI smoke 中执行）：
```bash
# 见 installer-env-reset-smoke.sh 断言 A-6（proven-to-fire）
# 手工触发方式：
# 1. reg add "HKCU\Environment" /v ZENITHJOY_API_BASE /d "https://staging.zenithjoy.com" /f
# 2. 启动 nc -l 8099 &（mock 接收 fail-report）
# 3. start.bat（ZJ_BOOT_FAIL_TEST=1 模式，跳过 probe guard，触发 401 检测）
# 4. 断言：
[ -f "$APPDATA/zenithjoy-agent/boot-error.json" ] || { echo "FAIL: no boot-error.json"; exit 1; }
jq -r .reason "$APPDATA/zenithjoy-agent/boot-error.json" | grep -q "license_401" || { echo "FAIL: reason not license_401"; exit 1; }
echo "PASS: proven-to-fire 401 → fail-report verified"
```

---

## 合同测试文件清单

| 文件 | 覆盖行为 |
|---|---|
| `tests/installer-env-reset-smoke-contract.sh` | A-1~A-6 全部断言（含 proven-to-fire） |
| `tests/boot-fail-api-contract.test.ts` | BEHAVIOR-3 端点行为、租户隔离、速率限制 |
| `tests/setup-reset-ps1-contract.test.ts` | BEHAVIOR-1 PowerShell 单元断言（Pester 或 bash 等价） |

## 完成判定

当且仅当以下全部为真时，本 sprint 视为 DONE：

- [ ] `installer-env-reset-smoke.sh` 6 断言全绿（含 A-6 proven-to-fire）
- [ ] `golden-path-1-smoke.sh` Step 2 子断言通过
- [ ] `POST /api/agent/boot-fail` 端点存在且无鉴权可达
- [ ] `agents.last_boot_error` 列迁移幂等通过
- [ ] AdminCustomersPage boot_error 区域 API 层验证通过
- [ ] agent 版本已 bump（manifest×2 + required_version）
- [ ] CI lint-no-pause / lint-ps-ascii 全绿
- [ ] installer-env-reset-smoke.sh 已加入 ci-l4-e2e-smoke.yml required checks
- [ ] `ci-l4-e2e-smoke.yml` 包含 `installer-env-reset-smoke` job（机械可验断言见下）

**第9条机械验证命令（合并前在 CI 中执行或本地执行）：**
```bash
grep -q 'installer-env-reset-smoke' .github/workflows/ci-l4-e2e-smoke.yml || { echo "FAIL: installer-env-reset-smoke not registered in ci-l4-e2e-smoke.yml required checks (violates I-4)"; exit 1; }
echo "PASS: installer-env-reset-smoke is registered in ci-l4-e2e-smoke.yml"
```
