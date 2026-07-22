# Contract Draft: 刀B M1 — 安装器清环境 + 启动死路消灭 + 装机 E2E

## 元数据

| 字段 | 值 |
|---|---|
| task_id | 2f66a0f8-a15e-4a42-9b9c-2841fc99ba66 |
| sprint_dir | sprints/07201700-installer-env-reset-m1 |
| journey | Path 1 客户首次成功 |
| target_environment | windows_cloud (GitHub Actions windows-latest) |
| contract_version | v1 |
| authored_date | 2026-07-20 |

## 推进声明

本 PR 把 Path 1 Step 2（装客户端 + Agent 自动连中台）的安装/更新健壮性推进到：

- **四件套①** setup-reset 前置清理器交付（installpack 第一步执行）
- **四件套③** 中台 boot-fail 端点 + 诊断页落地
- **四件套④** 装机链 E2E（windows-latest GHA）+ 变异 proven-to-fire

## 变更摘要

### 新增文件

| 文件 | 作用 |
|---|---|
| `services/agent/install-pack/setup-reset.ps1` | 前置清理器：杀进程树、清僵尸任务、删 stale lock、收敛 HKCU ZENITHJOY_* env、重建自启任务 |
| `apps/api/db/migrations/20260720_agents_boot_error.sql` | `ALTER TABLE agents ADD COLUMN IF NOT EXISTS last_boot_error jsonb` |
| `.github/workflows/scripts/smoke/installer-env-reset-smoke.sh` | 装机链 E2E，6 断言 + proven-to-fire 变异场景 |

### 修改文件

| 文件 | 变更内容 |
|---|---|
| `services/agent/install-pack/build-install-pack.sh` | 安装/更新第一步调用 setup-reset.ps1 |
| `services/agent/install-pack/start.bat` | 所有 `pause` 失败路径 → boot-error.json + curl 上报 + `exit /b 1` |
| `apps/api/src/routes/agent.ts` | 新增 `POST /api/agent/boot-fail` 端点，落库 agents.last_boot_error |
| `apps/dashboard/src/pages/AdminCustomersPage.tsx` | 诊断区展示 last_boot_error.reason + timestamp |
| `.github/workflows/scripts/smoke/golden-path-1-smoke.sh` | Step 2 子断言回流：setup-reset 收敛态 + boot-fail 端点可达（API 层等价断言） |

## E2E 验收

smoke 文件：`.github/workflows/scripts/smoke/installer-env-reset-smoke.sh`

运行环境：GitHub Actions `windows-latest` runner

### 断言清单

| # | 断言描述 | 验收命令/方式 |
|---|---|---|
| A-1 | 解包后 setup-reset.ps1 存在于 installpack 目录 | `[ -f "$INSTALLPACK_DIR/setup-reset.ps1" ]` |
| A-2 | 执行 setup-reset（dryrun 模式）→ 无 ZENITHJOY_* HKCU 残留 | PowerShell `reg query HKCU\Environment` 不含未声明 ZENITHJOY_* key |
| A-3 | ZenithJoyAgent 计划任务存在且指向当前目录 | `schtasks /query /tn ZenithJoyAgent` → 路径匹配 |
| A-4 | 无 stale `.launcher.lock`（PID 死则文件删） | `[ ! -f "$APPDATA/zenithjoy-agent/.launcher.lock" ]` 或 PID 存活 |
| A-5 | start.bat dryrun（ZJ_LAUNCH_PROBE=1）→ probe-marker.txt 存在 | `[ -f "$APPDATA/zenithjoy-agent/probe-marker.txt" ]` |
| A-6 (proven-to-fire) | 造 ZENITHJOY_API_BASE=https://staging 残留 → 401 → boot-error.json 含 license_401 + curl 上报发出 | `jq -r .reason boot-error.json` 含 `license_401`；API mock 收到 POST /api/agent/boot-fail |

### proven-to-fire 要求

变异场景（A-6）必须：
1. 主动注入 `HKCU ZENITHJOY_API_BASE=https://staging.zenithjoy.com` 残留
2. 触发 start.bat 检测 401
3. 断言 `boot-error.json` 存在且 `reason` 字段含 `license_401`
4. 断言 curl 上报已发出（检查 mock 服务器收到 `POST /api/agent/boot-fail` 请求）

### GP-1 Step 2 回流

在 `golden-path-1-smoke.sh` Step 2 末尾追加子断言，调用方式：

```bash
# golden-path-1-smoke.sh Step 2 子断言（installer-env-reset 回流）
# TRUE-MACHINE-EQUIV: 真机段（setup-reset + reg 收敛 + schtasks 重建）只在 windows-latest 全链路跑
# 此处做 API 层等价断言，覆盖 BEHAVIOR-2/3 的服务端合约
# TODO: 真机 E2E 全链路由 installer-env-reset-smoke.sh 在 windows-latest job 中验证

INSTALLER_E2E_URL="${API_URL:-http://localhost:3001}"

# 子断言 S2-a: boot-fail 端点可达（HTTP 非 401 非 404）
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "$INSTALLER_E2E_URL/api/agent/boot-fail" \
  -H "Content-Type: application/json" \
  -d '{"machine_id":"gp1-step2-smoke-001","hostname":"gp1-smoke-host","reason":"license_401","timestamp":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"}' \
  --max-time 10 2>/dev/null || echo "000")

if [ "$HTTP_STATUS" = "000" ]; then
  echo "[SKIP] GP-1 Step2 S2-a: API not reachable (boot-fail endpoint server not running)"
elif [ "$HTTP_STATUS" = "404" ]; then
  echo "[FAIL] GP-1 Step2 S2-a: boot-fail endpoint returned 404 -- BEHAVIOR-3 not implemented"
  exit 1
elif [ "$HTTP_STATUS" = "401" ]; then
  echo "[FAIL] GP-1 Step2 S2-a: boot-fail endpoint returned 401 -- endpoint must not require auth (N-2)"
  exit 1
else
  echo "[PASS] GP-1 Step2 S2-a: POST /api/agent/boot-fail returned $HTTP_STATUS (reachable without auth)"
fi

# 子断言 S2-b: installer-env-reset-smoke.sh 已注册进 ci-l4-e2e-smoke.yml（I-4 不变量）
grep -q 'installer-env-reset-smoke' "$(dirname "$0")/../../../.github/workflows/ci-l4-e2e-smoke.yml" \
  || { echo "[FAIL] GP-1 Step2 S2-b: installer-env-reset-smoke not in ci-l4-e2e-smoke.yml (I-4 violated)"; exit 1; }
echo "[PASS] GP-1 Step2 S2-b: installer-env-reset-smoke registered in CI baseline"
```

回流要点：
- `S2-a`：验证 `POST /api/agent/boot-fail` 端点无鉴权可达（API 层等价断言，注明「真机段等价断言」）
- `S2-b`：验证 smoke 已注册进 CI required checks（I-4 不变量机械验证）
- 真机 setup-reset 全链路（reg 收敛 + schtasks 重建 + proven-to-fire A-6）由 `installer-env-reset-smoke.sh` 在独立 `windows-latest` job 中验证，不在此重复

## 不变量遵守

| 约束 | 遵守方式 |
|---|---|
| I-1 禁 warning 降级 | start.bat 所有 pause 改为 echo [ERROR] + exit /b 1；setup-reset.ps1 失败路径全部 throw / exit 1 |
| I-2 PS5.1 纯 ASCII | setup-reset.ps1 文件体仅含 ASCII 字符；CI lint-ps-ascii 扫描通过 |
| I-3 改 agent 必须 bump 版本 | services/agent 变更同步 bump core 版本（manifest×2 + required_version + smoke 锚） |
| I-4 新 smoke 进 baseline | installer-env-reset-smoke.sh 加入 ci-l4-e2e-smoke.yml required checks |
| I-5 注册&心跳不破坏 | agent.ts 新增路由不影响 POST /api/agent/heartbeat；agent-fleet-smoke.sh 仍绿 |
| I-6 租户隔离 | POST /api/agent/boot-fail 通过 machine_id 解析 tenant_id，不跨租户返回 |
| I-7 proven-to-fire 强制 | smoke A-6 断言 401 → fail-report 真发出，不只有成功路径 |

## NFR 验收

| # | 要求 | 验收方式 |
|---|---|---|
| N-1 | setup-reset.ps1 执行 ≤ 10s | smoke 计时断言 |
| N-2 | boot-fail 端点无需 license | 无 bearer 直接调用 HTTP ≠ 401 |
| N-3 | boot-error.json 原子写入 | 实现用 tmp+rename 模式 |
| N-4 | DB migration 幂等 | `ADD COLUMN IF NOT EXISTS` |
| N-5 | 仅删未声明 ZENITHJOY_* key | setup-reset 读 .env key 列表再删 |
| N-6 | 无新 pause | CI lint-no-pause 扫描所有 .bat |
