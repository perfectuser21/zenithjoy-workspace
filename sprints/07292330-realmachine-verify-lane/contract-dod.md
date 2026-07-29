---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 真机验证车道 + 防假绿三层守卫

**范围**: 新建 `account-scan-realmachine-smoke.sh`（真机车道）+ `nightly-real-machine-staging.yml` 刀D job 接线 + 新建 `lint-smoke-mock-honesty.sh`（第1层诚实标注守卫，接入 L1 Process Gate）+ 给 `golden-path-*-smoke.sh` 假 payload 步骤加 `[CI-MOCK]` 标记 + 新建 `realmachine-unverified-ratchet.mjs`（第3层 ci-patrol 棘轮数据源，report-only）
**大小**: M

## Invariant 覆盖

- [ ] [BEHAVIOR] INV-1 [环境接缝守卫未强制] 本 sprint 交付第一个机械化闸——lint-smoke-mock-honesty.sh 对当前仓库 golden-path-*-smoke.sh 实际生效（非摆设）
  Test: manual:bash -c 'bash .github/workflows/scripts/lint-smoke-mock-honesty.sh .github/workflows/scripts/smoke; [ $? -eq 0 ] || exit 1; echo OK'
  期望: OK
- [ ] [BEHAVIOR] INV-2 [禁止写死环境假设值] 设备 agent_id 定位不依赖硬编码默认值兜底优先于动态查询（脚本源码里动态查询逻辑必须先于任何硬编码 fallback 执行）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\".github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh\",\"utf8\"); const dynIdx=c.indexOf(\"last_heartbeat_at\"); const hardIdx=c.search(/SMOKE_AGENT_ID_FALLBACK|AGENT_ID=.[0-9a-f]{8}-/); if(dynIdx===-1) process.exit(1); if(hardIdx!==-1 && hardIdx<dynIdx) process.exit(1);" && echo OK'
  期望: OK
- [ ] [BEHAVIOR] INV-3 [真环境验证才算done] account-scan-realmachine-smoke.sh 必须区分 envfail(exit 3,环境未就绪)/fail(exit 1,真机验证失败)/ok(exit 0)三态，不能把环境未就绪静默当通过
  Test: manual:bash -c 'grep -q "envfail()" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh && grep -q "exit 3" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh && grep -q "exit 1" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh && echo OK || exit 1'
  期望: OK
- [ ] [BEHAVIOR] INV-4 [失败不抛异常需显式处理] account-scan-realmachine-smoke.sh 对 curl/adb/psql 调用失败必须显式判断退出码，不能吞掉继续往下跑（`set -uo pipefail` + 每个关键调用后显式 `|| fail`/`|| envfail`）
  Test: manual:bash -c 'grep -q "set -uo pipefail" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh || exit 1; echo OK'
  期望: OK
- [ ] [BEHAVIOR] INV-5 [后台job失败计数] nightly 刀D job 失败必须计入现有 `[nightly-red]` issue 机制（needs 列表 + 汇总表 + 失败条件三处都接线，不能只加 job 不接汇总）
  Test: manual:bash -c 'grep -q "account-scan" .github/workflows/nightly-real-machine-staging.yml && grep -A3 "needs:" .github/workflows/nightly-real-machine-staging.yml | grep -q "account-scan" && echo OK || exit 1'
  期望: OK
- [ ] [BEHAVIOR] INV-6 [部署失败禁降级] envfail/fail 分支禁止 warning 降级为 exit 0——脚本内不得出现无条件 `exit 0` 兜底吞掉失败判定
  Test: manual:bash -c 'if grep -qE "^\s*exit 0\s*$" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh; then LAST=$(tail -1 .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh); echo "$LAST" | grep -qE "^(ok |echo .✅)" || exit 1; fi; echo OK'
  期望: OK
- [ ] [BEHAVIOR] INV-7 [日志脱敏] 真机失败时打印 response 供排查，但不得把 screenshot_b64（可能是大段 base64 图像数据）整段输出到 CI 公开日志，只输出长度/存在性提示
  Test: manual:bash -c 'grep -q "screenshot_b64" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh && ! grep -qE "echo.*\\\$RESP\\b.*screenshot_b64.*base64|cat.*screenshot_b64" .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh && echo OK || exit 1'
  期望: OK
- N/A：[target_environment从DB读] 本 sprint 不改动 harness 任务注册机制本身，target_environment 路由沿用 Brain 既有 tasks.payload 读取逻辑（未触及该代码路径），交付物是 CI 脚本/workflow/DoD 文档
- N/A：[harness judge需按环境校准证据] 本 sprint 不改动 harness evaluator/judge 代码，evaluator 沿用既有 windows_wechat 证据校准逻辑，本 sprint 只提供 target_environment 声明与 E2E 脚本
- N/A：[judge结果需顶层字段] 本 sprint 不产出 `.brain-result.json`（proposer 阶段产物，非 evaluator judge 产物），与本 sprint 交付边界无关
- N/A：[测试默认多租户] 真机 smoke 复用现有固定测试租户常量（`SMOKE_TENANT`），不新建 DB schema/多租户测试场景；无新增 DB 表/字段，沿用既有单租户测试常量约定（同 line02-android-collect-realmachine-smoke.sh）
- N/A：[端点鉴权]/[租户隔离]/[凭据安全] 本 sprint 不新增/修改任何服务端端点鉴权逻辑；复用已有 `/account-scan/trigger`（tenantContextOptional + 限流）与 `/account-scan-result`（agent_id 反查）鉴权模型，未改动

## ARTIFACT 条目

- [ ] [ARTIFACT] account-scan-realmachine-smoke.sh 文件存在，含真机验证车道核心步骤（安装/无障碍/定位/触发/轮询/断言）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh','utf8'); for (const kw of ['adb install -r','enabled_accessibility_services','account-scan/trigger','publish_tasks','account_ids']) { if(!c.includes(kw)) { console.error('missing: '+kw); process.exit(1); } }"

- [ ] [ARTIFACT] nightly-real-machine-staging.yml 新增"刀D"account-scan job，接入 nightly-report 汇总
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/nightly-real-machine-staging.yml','utf8'); if(!c.includes('account-scan-realmachine-smoke.sh')) process.exit(1); if(!/needs:\s*\[[^\]]*account-scan[^\]]*\]/.test(c)) process.exit(1);"

- [ ] [ARTIFACT] lint-smoke-mock-honesty.sh 文件存在且可执行
  Test: node -e "const fs=require('fs'); fs.accessSync('.github/workflows/scripts/lint-smoke-mock-honesty.sh', fs.constants.X_OK)"

- [ ] [ARTIFACT] lint-smoke-mock-honesty.sh 已接入 ci-l1-process.yml（新增 job + 汇总 needs 列表）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci-l1-process.yml','utf8'); if(!c.includes('lint-smoke-mock-honesty')) process.exit(1);"

- [ ] [ARTIFACT] account-scan-realmachine-smoke.sh 已加入 ci-smoke-glob-runner.yml 的 DENYLIST（真机 smoke 豁免 baseline，同 line02-android-collect-realmachine-smoke.sh 先例）
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/ci-smoke-glob-runner.yml','utf8'); const m=c.match(/DENYLIST=\"([\s\S]*?)\"/); if(!m || !m[1].includes('account-scan-realmachine-smoke.sh')) process.exit(1);"

- [ ] [ARTIFACT] golden-path-2-smoke.sh Step 30 假 payload 步骤已加 `[CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]` 标记
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/golden-path-2-smoke.sh','utf8'); if(!c.includes('[CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]')) process.exit(1);"

- [ ] [ARTIFACT] scripts/product-map/realmachine-unverified-ratchet.mjs 文件存在，导出/CLI 输出含 realmachine_unverified_count 字段
  Test: node -e "const fs=require('fs'); fs.accessSync('scripts/product-map/realmachine-unverified-ratchet.mjs', fs.constants.F_OK)"

- [ ] [ARTIFACT] computeRealmachineUnverifiedRatchet 纯函数已加入 scripts/product-map/lib.mjs 并导出
  Test: node -e "import('./scripts/product-map/lib.mjs').then(m => { if (typeof m.computeRealmachineUnverifiedRatchet !== 'function') process.exit(1); })"

- [ ] [ARTIFACT] package.json test:product-map 脚本已把新测试文件加入显式列表
  Test: node -e "const p=require('./package.json'); if(!p.scripts['test:product-map'].includes('realmachine-unverified-ratchet.test.js')) process.exit(1);"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] account-scan-realmachine-smoke.sh 在无 Android 设备环境下正确走 envfail 分支（exit 3，非 1，区分"环境未就绪"与"真机验证失败"）
  Test: manual:bash -c 'bash .github/workflows/scripts/smoke/account-scan-realmachine-smoke.sh; CODE=$?; [ "$CODE" -eq 3 ] || { echo "FAIL: 无设备环境应 exit 3，实得 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] lint-smoke-mock-honesty.sh 对漏标记的假payload步骤报红（proven-to-fire）
  Test: manual:bash -c 'FIXDIR=$(mktemp -d); printf "%s\n" "#!/usr/bin/env bash" "echo Step1" "curl -fsSk -X POST \$API/account-scan-result -d \x27{\"agent_id\":\"x\",\"request_id\":\"y\",\"ok\":false,\"error_code\":\"OPEN_PANEL_FAILED\"}\x27" "ROW=\$(psql \$DB -tA -c \"SELECT error_code FROM zenithjoy.agent_scan_failures WHERE request_id=\x27y\x27\")" "[ \"\$ROW\" = \"OPEN_PANEL_FAILED\" ] || exit 1" > "$FIXDIR/golden-path-99-smoke.sh"; bash .github/workflows/scripts/lint-smoke-mock-honesty.sh "$FIXDIR"; CODE=$?; rm -rf "$FIXDIR"; [ "$CODE" -ne 0 ] || { echo "FAIL: 漏标记未被抓"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] lint-smoke-mock-honesty.sh 对带 [CI-MOCK] 标记的同一假payload步骤放行（反向 proven-to-fire）
  Test: manual:bash -c 'FIXDIR=$(mktemp -d); printf "%s\n" "#!/usr/bin/env bash" "# [CI-MOCK: real-device-only | nightly_ref: account-scan-realmachine-smoke.sh]" "echo Step1" "curl -fsSk -X POST \$API/account-scan-result -d \x27{\"agent_id\":\"x\",\"request_id\":\"y\",\"ok\":false,\"error_code\":\"OPEN_PANEL_FAILED\"}\x27" "ROW=\$(psql \$DB -tA -c \"SELECT error_code FROM zenithjoy.agent_scan_failures WHERE request_id=\x27y\x27\")" "[ \"\$ROW\" = \"OPEN_PANEL_FAILED\" ] || exit 1" > "$FIXDIR/golden-path-99-smoke.sh"; bash .github/workflows/scripts/lint-smoke-mock-honesty.sh "$FIXDIR"; CODE=$?; rm -rf "$FIXDIR"; [ "$CODE" -eq 0 ] || { echo "FAIL: 带标记应放行，实得 $CODE"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] lint-smoke-mock-honesty.sh 对当前仓库全部 golden-path-*-smoke.sh 跑通（回归：真实标记已加全）
  Test: manual:bash -c 'bash .github/workflows/scripts/lint-smoke-mock-honesty.sh .github/workflows/scripts/smoke; [ $? -eq 0 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] realmachine-unverified-ratchet 对"新增一个标记了[CI-MOCK]但 nightly_ref 指向的脚本未被 nightly-real-machine-staging.yml 引用"的步骤，计数正确增加（proven-to-fire）
  Test: manual:bash -c 'BASE=$(node scripts/product-map/realmachine-unverified-ratchet.mjs | jq -r ".realmachine_unverified_count"); TMPD=$(mktemp -d); cp .github/workflows/scripts/smoke/golden-path-2-smoke.sh "$TMPD/" 2>/dev/null || true; printf "%s\n" "# [CI-MOCK: real-device-only | nightly_ref: nonexistent-not-in-nightly.sh]" > "$TMPD/golden-path-98-smoke.sh"; AFTER=$(REALMACHINE_SMOKE_DIR="$TMPD" REALMACHINE_NIGHTLY_YML=.github/workflows/nightly-real-machine-staging.yml node scripts/product-map/realmachine-unverified-ratchet.mjs | jq -r ".realmachine_unverified_count"); rm -rf "$TMPD"; [ "$AFTER" -gt "$BASE" ] || { echo "FAIL: base=$BASE after=$AFTER 未上升"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] realmachine-unverified-ratchet 对当前仓库真实状态（Step5 标记齐全 + 刀D job 已接线）计数为 0
  Test: manual:bash -c 'C=$(node scripts/product-map/realmachine-unverified-ratchet.mjs | jq -r ".realmachine_unverified_count"); [ "$C" -eq 0 ] || { echo "FAIL: 期望0，实得$C"; exit 1; }; echo OK'
  期望: OK

- [ ] [BEHAVIOR] error path — realmachine-unverified-ratchet 对缺 nightly_ref 的 [CI-MOCK] 标记同样计入未覆盖（不因缺字段而漏判）
  Test: manual:bash -c 'TMPD=$(mktemp -d); printf "%s\n" "# [CI-MOCK: real-device-only]" > "$TMPD/golden-path-97-smoke.sh"; C=$(REALMACHINE_SMOKE_DIR="$TMPD" REALMACHINE_NIGHTLY_YML=.github/workflows/nightly-real-machine-staging.yml node scripts/product-map/realmachine-unverified-ratchet.mjs | jq -r ".realmachine_unverified_count"); rm -rf "$TMPD"; [ "$C" -ge 1 ] || { echo "FAIL: 缺nightly_ref应计入未覆盖，实得$C"; exit 1; }; echo OK'
  期望: OK
