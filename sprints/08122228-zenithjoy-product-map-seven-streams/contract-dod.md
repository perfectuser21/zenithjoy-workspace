---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: ZenithJoy Product Map 7 Value Streams / 18 Capabilities 修复

**范围**: `product-map/product-map.yaml` 手写编辑（4 条 Line 改名 + 新增 line05/07/10 + 新增 3 条锚定既有 smoke 的 Golden Path + line00 收敛 `skill_acceptance` → deprecated）、`product-map:generate` 重建投影、`product-map:check` 校验、`scripts/product-map/__tests__/product-map.test.js` 同步更新、`sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js` 新增 failing-first 合同测试。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] `product-map.yaml` 4 条 Line 完成改名（line01→智能发布/line02→智能获客/line04→智能客服/line00→运营中枢）
  Test: node -e "const c=require('fs').readFileSync('product-map/product-map.yaml','utf8'); const need=['Line 01 智能发布','Line 02 智能获客','Line 04 智能客服','Line 00 运营中枢']; for(const n of need){ if(!c.includes(n)){ console.error('缺: '+n); process.exit(1);} }"

- [ ] [ARTIFACT] `product-map.yaml` 新增 line05/line07（customer_app 下）+ line10（staff_app 下）三条 Line
  Test: node -e "const c=require('fs').readFileSync('product-map/product-map.yaml','utf8'); const need=['id: line05','id: line07','id: line10']; for(const n of need){ if(!c.includes(n)){ console.error('缺: '+n); process.exit(1);} }"

- [ ] [ARTIFACT] `product-map.yaml` 中 `skill_acceptance` 条目 `status` 已改为 `deprecated`（条目保留未删除）
  Test: node -e "
    const { parse } = require('yaml');
    const fs = require('fs');
    const c = fs.readFileSync('product-map/product-map.yaml','utf8');
    const m = parse(c);
    const gp = m.golden_paths.find(g => g.id === 'skill_acceptance');
    if (!gp) { console.error('skill_acceptance 条目被误删'); process.exit(1); }
    if (gp.status !== 'deprecated') { console.error('skill_acceptance status 不是 deprecated: ' + gp.status); process.exit(1); }
  "

- [ ] [ARTIFACT] `scripts/product-map/__tests__/product-map.test.js` 已同步更新（不再断言旧的 3-Line / 4-GP 分布）
  Test: node -e "const c=require('fs').readFileSync('scripts/product-map/__tests__/product-map.test.js','utf8'); if(c.includes(\"['line01', 'line02', 'line04']\")) { console.error('T1 仍是旧断言，未同步更新'); process.exit(1); }"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] `product-map.yaml` 通过 schema + 关系校验（validate PASS）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && node scripts/product-map/cli.mjs validate | grep -q "PASS: product-map.yaml is valid"'
  期望: exit 0

- [ ] [BEHAVIOR] `generate` 重建投影后 `check` 报告零漂移
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run product-map:generate >/tmp/gen.log 2>&1 && npm run product-map:check 2>&1 | grep -q "PASS: no drift"'
  期望: exit 0

- [ ] [BEHAVIOR] `apps[].lines` 精确等于 7 条（line00/01/02/04/05/07/10）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run product-map:generate >/dev/null 2>&1; LINES=$(jq -r "[.apps[].lines[].id] | sort | join(\",\")" product-map/generated/product-map.json); [ "$LINES" = "line00,line01,line02,line04,line05,line07,line10" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 非 deprecated Golden Path 总数精确为 18，且按 line 分布 line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run product-map:generate >/dev/null 2>&1; F=0; declare -A WANT=( [line01]=1 [line02]=4 [line04]=7 [line05]=1 [line07]=1 [line00]=3 [line10]=1 ); for L in "${!WANT[@]}"; do A=$(jq --arg l "$L" "[.golden_paths[] | select(.line_id==\$l and .status!=\"deprecated\")] | length" product-map/generated/product-map.json); [ "$A" = "${WANT[$L]}" ] || { echo "FAIL line=$L want=${WANT[$L]} got=$A"; F=1; }; done; T=$(jq "[.golden_paths[] | select(.status!=\"deprecated\")] | length" product-map/generated/product-map.json); [ "$T" = "18" ] || { echo "FAIL total=$T"; F=1; }; [ "$F" = "0" ]'
  期望: exit 0

- [ ] [BEHAVIOR] deprecated 条目原样保留、精确为三个历史 id，不计入 18
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run product-map:generate >/dev/null 2>&1; DEP=$(jq -r "[.golden_paths[] | select(.status==\"deprecated\") | .id] | sort | join(\",\")" product-map/generated/product-map.json); [ "$DEP" = "customer_private_ai,customer_smart_acquisition,skill_acceptance" ]'
  期望: exit 0

- [ ] [BEHAVIOR] line05/07/10 三条新 GP 的 `smoke_files` 精确锚定 PRD 指定的三个既有文件
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run product-map:generate >/dev/null 2>&1; A=$(jq -r "[.golden_paths[] | select(.line_id==\"line05\" and .status!=\"deprecated\") | .smoke_files[]?] | join(\",\")" product-map/generated/product-map.json); B=$(jq -r "[.golden_paths[] | select(.line_id==\"line07\" and .status!=\"deprecated\") | .smoke_files[]?] | join(\",\")" product-map/generated/product-map.json); C=$(jq -r "[.golden_paths[] | select(.line_id==\"line10\" and .status!=\"deprecated\") | .smoke_files[]?] | join(\",\")" product-map/generated/product-map.json); [ "$A" = ".github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh" ] && [ "$B" = ".github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh" ] && [ "$C" = ".github/workflows/scripts/smoke/customer-admin-backend-smoke.sh" ]'
  期望: exit 0

- [ ] [BEHAVIOR] 三个被锚定的既有 smoke 文件本身未被本 sprint 新写/修改（git diff 不含这三个路径）
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null) || CHANGED=$(git diff --name-only HEAD); for f in .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh .github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh .github/workflows/scripts/smoke/customer-admin-backend-smoke.sh; do echo "$CHANGED" | grep -qxF "$f" && exit 1; done; exit 0'
  期望: exit 0

- [ ] [BEHAVIOR] 边界校验 — 变更文件全部落在允许前缀内，且不含 Cecelia 仓库路径
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null) || CHANGED=$(git diff --name-only HEAD); OUT=$(echo "$CHANGED" | grep -vE "^(product-map/product-map\.yaml|product-map/generated/product-map\.(json|md)|scripts/product-map/__tests__/.*|sprints/.*|\.harness/verdicts/.*|DoD\.md|test-registry\.yaml)$" || true); [ -z "$OUT" ] || { echo "越界: $OUT"; exit 1; }; echo "$CHANGED" | grep -qi "cecelia" && exit 1 || exit 0'
  期望: exit 0

- [ ] [BEHAVIOR] error path — schema 违规（未知 app_id 引用）被 `validateRelations` 正确拒绝，不产生假绿
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && node --input-type=module -e "
import { loadAndValidateProductMap, validateRelations } from \"./scripts/product-map/lib.mjs\";
const { map } = await loadAndValidateProductMap();
const bad = { ...map, golden_paths: [...map.golden_paths, { id: \"bad_probe\", app_id: \"missing_app\", line_id: \"line00\", status: \"active\" }] };
const errs = validateRelations(bad);
if (!errs.some(e => e.toLowerCase().includes(\"references unknown app\"))) { console.error(\"FAIL: 未正确拒绝未知 app_id\"); process.exit(1); }
"'
  期望: exit 0

- [ ] [BEHAVIOR] 既有回归测试套件（`npm run test:product-map`）全绿，未因本 sprint 改动而破窗
  Test: manual:bash -c 'cd "$(git rev-parse --show-toplevel)" && npm run test:product-map'
  期望: exit 0
