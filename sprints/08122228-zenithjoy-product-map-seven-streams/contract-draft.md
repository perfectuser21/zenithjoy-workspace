# Sprint Contract Draft (Round 1)

## Response Schema（推导来源: PRD字面 — N/A）

本 sprint 无 HTTP 响应面：纯 `product-map/product-map.yaml`（手写 SSOT）编辑 + `product-map:generate`（CLI 生成投影）+
`product-map:check`（CLI 漂移检测）+ Node 单元测试。无 Response Schema 段，Reviewer 第 6 维本段自动满分。

## 已知约束（来自回归测试 + 累积 FR）

- `scripts/product-map/__tests__/product-map.test.js` T1 → `customerApp.lines` 当前硬编码 `['line01','line02','line04']`、`staffApp.lines` 硬编码 `['line00']`——editing yaml 新增 line05/07/10 后此断言必然 FAIL，属预期内的"随本 sprint 一并更新"范围（PRD 预期受影响文件已列出本文件）。
- `scripts/product-map/__tests__/product-map.test.js` T3 → 当前硬编码 `line00Gps` 精确为 4 个（`ability_acceptance/gp_anchor_enforcement/line_health/skill_acceptance`）且断言 `ability_acceptance status=active`（2026-07-31 决策 fc7b5dc0）。本 sprint 收敛为 3 条非废弃，T3 需要同步更新为断言 `skill_acceptance status=deprecated`、`ability_acceptance` 保持 `active`（详见下方"判定点"）。
- `scripts/product-map/__tests__/product-map.test.js` T3 → customer 侧 GP 全景断言（line01/02/04 共 14 条含 deprecated）需追加 line05/line07 两条新 GP。
- `scripts/product-map/__tests__/product-map.test.js` T8 → grandfather 断言 `skill_acceptance` 无 `smoke_files` 字段——本 sprint 不改动 `skill_acceptance` 的 `smoke_files`（保持缺省），仅改 `status`，此断言不受影响，须保持通过。
- `product-map/product-map.schema.json` → `lines` 数组元素只需 `id`+`name`（无 `status` 字段），新增 line05/07/10 无需额外字段。
- context-manifest 端点（`localhost:5221/api/brain/line/.../context-manifest`）：`unavailable`（本任务无 `journey_id`，PRD 已声明 `journey_id: none`，不适用）。

## 铁律清单 → DoD Invariant 覆盖

- [并发] 单 slot 串行任务，并行只许跨 slot → N/A：本 sprint 单文件顺序编辑，无并行执行路径。
- [环境假设] 禁止写死环境假设值，接缝值须真验或从环境推导 → 适用：line05/07/10 三条新 GP 的 `smoke_files` 路径值必须真实存在于仓库（由 `validateSmokeFiles` 机检，见 DoD INV-2）。
- [完成判定] 真环境验证才算 done → 适用：`product-map:generate` + `product-map:check` 必须在本仓库真实文件系统上跑绿，不接受口头声明（见 DoD INV-1/INV-2/INV-3）。
- [多租户测试] → N/A：本 sprint 无租户数据场景（纯静态配置分类）。
- [凭据安全] → N/A：本 sprint 不涉及任何 secrets。
- [日志脱敏] → N/A：不涉及客户隐私/PII/聊天内容。
- [端点鉴权] → N/A：本 sprint 不新增 API 端点。
- [租户隔离] → N/A：不碰租户数据查询/写入。

## 禁 mock 边清单

本单改动为纯静态配置（YAML）+ 确定性 CLI 转换（`generate`：YAML→JSON/MD 投影；`check`：摘要比对）+ Node 单元测试，
**不触及**调度/dispatcher、状态机/终态判定、跨模块数据传递、生命周期钩子（startup/recovery/shutdown/callback）、
DB 写路径中的任何一类——全程无网络调用、无数据库、无跨进程状态传递。因此本单无"被改的边"需要保真调用。

为防止测试脱靶（即使不属于五类边），仍显式约束：合同测试与 `scripts/product-map/__tests__/product-map.test.js`
一律通过 `loadAndValidateProductMap()` / `validateRelations()` / `validateSmokeFiles()` 等函数**真实读取磁盘上的
`product-map/product-map.yaml` 与 `product-map/generated/*`**，禁止 `vi.mock('node:fs', ...)` 或对 `lib.mjs` 导出函数打桩替代真实文件读取。

（本单纯配置/CLI生成校验改动，无五类接缝边，N/A；上段为额外自律约束，非豁免借口）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|----------|
| **FR（做什么）** | 系统对外承诺做什么 | 编辑 `product-map.yaml` 使其精确产出 7 条 Value Stream（line01/02/04/05/07/00/10）、18 条非废弃 Golden Path（按 line 精确分布 line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1），`generate`/`check` 均返回 PASS/exit 0，Cecelia 仓库零改动 |
| **NFR（做得多好）** | 性能/可靠性/并发阈值 | PRD 已声明"待定，本 sprint 为静态配置校验，无运行时延迟要求" |
| **Invariant（永不违反）** | 安全/数据一致性/幂等 | `product-map:generate` 必须幂等（同一 yaml 两次 generate 产出相同 digest）；`gp_anchor_enforcement` 条目内容不可变动（受 `gp_anchor: line00/gp_anchor_enforcement keep-green` 保护） |
| **判定点（怎么知道）** | 见下方登记表 | 见判定点登记表 |
| **保质期（何时过期）** | 该能力/数据/token 何时失效 | N/A：静态分类配置无过期概念；`smoke_files` 锚定的三个 smoke 脚本若未来被删除/改名，由既有 `validateSmokeFiles` GP-SMOKE-MISSING 机检兜底（既有基础设施，非本 sprint 新增） |
| **死亡告警（停了谁知道）** | 谁在多久内知道 | CI job `product-map-contract`（`.github/workflows/ci-l2-consistency.yml`）每次 push/PR 跑 `npm run test:product-map` + `generate` + `check`，任一非零 exit 即挡 PR 合并（既有闸门，本 sprint 不新增） |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见下方 |
| **效果确认（已发≠已生效）** | 每个对外动作如何确认生效 | `product-map:check` 返回 PASS 字符串 + exit 0 即视为生效；DoD [BEHAVIOR] 全部用真实 CLI/文件断言，不接受人工目测 |

### 判定点登记表

> 本任务是静态 YAML 分类编辑 + 确定性 CLI 转换，无"系统自行推断外部真实状态"的接缝——不涉及 RPA/API 返回解读/真机反馈。
> 但存在一个**业务拍板类**判定点（非运行时状态推断，而是"选哪个 GP 标 deprecated"的业务归属判断），一并登记以保持透明：

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| line00 skill_acceptance 与 ability_acceptance 二选一 deprecated（PRD `[ASSUMPTION]`，本合同阶段拍板） | A. 深 deprecated `skill_acceptance`，保留 `ability_acceptance` active；B. 反之深 deprecated `ability_acceptance` | **A. deprecated `skill_acceptance`，`ability_acceptance` 保持 active** | 三重证据交叉核实：①`product-map.yaml` 现有注释（`ability_acceptance` 条目正上方）原文"2026-07-31 用户拍板（决策 fc7b5dc0，覆盖 07-29 走 Notion 的决策）：验收+展示全部收回，自家前端，Staff Hub 直连 Brain 零同步层重新实现（cecelia PR #4516 后端 + 本仓库前端）"——decision fc7b5dc0 的主体正是"验收"（Ability 验收）流程被**重新实现**，而非废弃；②`scripts/product-map/__tests__/product-map.test.js` T3 现有断言已明确写 `ability_acceptance status=active`（2026-07-31 决策 fc7b5dc0 覆盖 07-29），且测试描述文字直接点名"ability_acceptance ... 须为 active"；③`docs/superpowers/plans/2026-07-31-staff-hub-acceptance-frontend-plan.md`（"Staff Hub 验收模块（前端）Implementation Plan"）+ `.github/workflows/e2e-staff-acceptance-windows.yml`（注释"决策 fc7b5dc0：Staff Hub 直连 Brain"）均实证该重写已交付并有专属 CI 覆盖；三处独立来源一致指向"验收"（ability_acceptance 所指代的功能域）是被**留下并强化**的一方，`skill_acceptance`（Skill 验收流程）未见任何后续重写/CI 覆盖证据，判定为被该重写取代的旧概念 | 若误选 B（deprecated 掉 `ability_acceptance`），会与仓库既有回归测试 T3、已交付的 Staff Hub 验收前端及其专属 E2E workflow 直接矛盾，导致下游误判"验收功能已废弃"，且需要同时改动已交付功能的既有测试断言语义（从"active"改判"deprecated"），这在 GAN 边界之外、无对应决策支持——判定过程见本行"所选方法"论证，未在 Notion decisions 表新开决策记录（沿用已有 fc7b5dc0，非升级新判断，不触发 `judgment-pending-user`） |

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| `product-map:generate` 失败（schema/relation 错误）| 非零 exit，打印具体错误行，不写 `generated/` 产物（保留旧产物不被脏写覆盖）| 是（重跑幂等，无副作用累积）| 无降级；CI 直接挡 PR |
| `product-map:check` 检出漂移（digest 不一致 / smoke_files 缺失）| 非零 exit，打印 `FAIL: drift detected` 或 `GP-SMOKE-MISSING/EMPTY` 明细 | 是（重新 generate 后重跑幂等）| 无降级；CI 直接挡 PR，不允许 skip |
| `npm run test:product-map` 任一 `node:test` 断言失败 | 进程非零 exit，测试 reporter 打印具体失败用例 | 是（纯函数测试，无外部状态）| 无降级；CI 直接挡 PR |

### 输入对抗面

N/A — 本任务不对外暴露 agent，无客服 agent / 爬虫内容入 pipeline / 外部用户可写入接口。

---

## Golden Path

[开发者编辑 `product-map.yaml`] → [schema/relations 静态校验通过] → [`generate` 重建投影] → [`check` 零漂移]
→ [7 Lines / 18 非废弃 Golden Path 精确匹配] → [边界：Cecelia 仓库零改动 + 无新建 registry/扫描脚本] → [既有回归测试全绿]

### Step 1: 编辑 `product-map.yaml`（改名 + 新增 3 Line + 3 GP + line00 收敛）

**来源**: `[FROM_PRD]` — Golden Path 第 1 步 a/b/c/d/e 五个子项（sprint-prd.md 第 18-26 行）逐字对应：
a) 4 条 Line 改名；b) line05/07 新增；c) line10 新增；d) 三条新 GP 锚定既有 smoke；e) line00 收敛为 3 条非废弃。

**可观测行为**: `product-map.yaml` 编辑后仍是合法 YAML，且通过 schema + 关系校验（不含语法错误、不引用未定义 app/line/surface/edition）。

**验证命令**:
```bash
node scripts/product-map/cli.mjs validate
```
**硬阈值**: 输出含 `PASS: product-map.yaml is valid`，exit 0。

---

### Step 2: 重建投影（`product-map:generate`）

**来源**: `[FROM_PRD]` — sprint-prd.md 第 27 行"跑 `npm run product-map:generate` 重建 `product-map/generated/{product-map.json,product-map.md}`"。

**可观测行为**: `product-map/generated/product-map.json` 与 `product-map/generated/product-map.md` 被重写，二者 digest 一致且与当前 YAML 的 digest 相等。

**验证命令**:
```bash
npm run product-map:generate
DIGEST_JSON=$(node -e "console.log(JSON.parse(require('node:fs').readFileSync('product-map/generated/product-map.json','utf8')).digest)")
grep -q "$DIGEST_JSON" product-map/generated/product-map.md
```
**硬阈值**: `npm run product-map:generate` exit 0 且输出含 `PASS: generated`；`product-map.md` 必须包含 `product-map.json` 里的 digest 字符串。

---

### Step 3: 漂移检测（`product-map:check`）

**来源**: `[FROM_PRD]` — sprint-prd.md 第 28 行"跑 `npm run product-map:check`，输出 7 Value Stream / 18 Capability 精确匹配、无漂移"。

**可观测行为**: `check` 命令输出 PASS，exit 0（对比当前 YAML digest 与生成产物 digest、smoke_files 存在性）。

**验证命令**:
```bash
npm run product-map:check
```
**硬阈值**: exit 0 且输出含 `PASS: no drift`。

---

### Step 4: 7 条 Line 精确匹配

**来源**: `[FROM_PRD]` — sprint-prd.md 第 87 行 E2E 期望点 3："`apps[].lines` 精确等于 7 条：line01/02/04/05/07（customer_app）+ line00/10（staff_app）"。

**可观测行为**: `product-map/generated/product-map.json` 的 `apps[].lines[].id` 全集（排序去重后）恰好是 7 个指定 id。

**验证命令**:
```bash
LINES=$(jq -r '[.apps[].lines[].id] | sort | join(",")' product-map/generated/product-map.json)
[ "$LINES" = "line00,line01,line02,line04,line05,line07,line10" ]
```
**硬阈值**: 字符串精确相等，多一个少一个都判 FAIL。

---

### Step 5: 18 条非废弃 Golden Path 按 line 精确分布

**来源**: `[FROM_PRD]` — sprint-prd.md 第 29 行 + 第 88 行"`golden_paths` 中 `status != deprecated` 精确等于 18 条，按 line 分布 line01=1/line02=4/line04=7/line05=1/line07=1/line00=3/line10=1"。

**可观测行为**: 按 line_id 分组统计非 deprecated GP 数量，逐条精确匹配目标值；总数精确为 18。

**验证命令**:
```bash
declare -A WANT=( [line01]=1 [line02]=4 [line04]=7 [line05]=1 [line07]=1 [line00]=3 [line10]=1 )
FAIL=0
for L in "${!WANT[@]}"; do
  ACTUAL=$(jq --arg l "$L" '[.golden_paths[] | select(.line_id==$l and .status!="deprecated")] | length' product-map/generated/product-map.json)
  [ "$ACTUAL" = "${WANT[$L]}" ] || { echo "FAIL: line=$L expect=${WANT[$L]} actual=$ACTUAL"; FAIL=1; }
done
TOTAL=$(jq '[.golden_paths[] | select(.status!="deprecated")] | length' product-map/generated/product-map.json)
[ "$TOTAL" = "18" ] || { echo "FAIL: total=$TOTAL expect=18"; FAIL=1; }
[ "$FAIL" = "0" ]
```
**硬阈值**: 7 个 line 分布全部精确匹配 + 总数精确为 18，任一不符判 FAIL。

---

### Step 6: deprecated 条目原样保留、不计入 18

**来源**: `[FROM_PRD]` — sprint-prd.md 边界情况段第 34 行"已 deprecated 的 `customer_smart_acquisition` / `customer_private_ai` 及 line00 收敛出的 1 条保留条目原样，不删除、不计数"；E2E 期望点 5（第 89 行）。

**可观测行为**: 历史 deprecated 条目集合精确等于三个指定 id（`customer_smart_acquisition`、`customer_private_ai`、`skill_acceptance`），Step 5 的计数已天然排除它们。

**验证命令**:
```bash
DEP=$(jq -r '[.golden_paths[] | select(.status=="deprecated") | .id] | sort | join(",")' product-map/generated/product-map.json)
[ "$DEP" = "customer_private_ai,customer_smart_acquisition,skill_acceptance" ]
```
**硬阈值**: 字符串精确相等（既不多也不少，防止误删或误增 deprecated 条目）。

---

### Step 7: 三条新 GP 精确锚定既有 smoke（不新写业务代码）

**来源**: `[FROM_PRD]` — sprint-prd.md 第 22-25 行三条具体 smoke 文件路径 + 范围限定段"不在范围内：...line05/07/10 之外新业务代码"。

**可观测行为**: line05/07/10 三条新 GP 的 `smoke_files` 字段精确等于 PRD 给出的三个既有路径；这三个文件本身**不出现**在本 sprint 的 git diff 里（证明未被新写/修改，纯锚定既有文件）。

**验证命令**:
```bash
SM05=$(jq -r '[.golden_paths[] | select(.line_id=="line05" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM05" = ".github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh" ]
SM07=$(jq -r '[.golden_paths[] | select(.line_id=="line07" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM07" = ".github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh" ]
SM10=$(jq -r '[.golden_paths[] | select(.line_id=="line10" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM10" = ".github/workflows/scripts/smoke/customer-admin-backend-smoke.sh" ]

CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null) || CHANGED=$(git diff --name-only HEAD)
for f in .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh \
         .github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh \
         .github/workflows/scripts/smoke/customer-admin-backend-smoke.sh; do
  echo "$CHANGED" | grep -qxF "$f" && { echo "FAIL: 不得新写/修改锚定 smoke 文件 $f"; exit 1; } || true
done
```
**硬阈值**: 三个 `smoke_files` 精确匹配 PRD 指定路径；三个文件路径不在本 sprint 变更文件列表中。
`CHANGED` 计算须与 `tests/contract.test.js` T7 一致：`origin/main...HEAD` 不可达（沙盒无网络场景）时不裸吞错误静默退化为空，而是显式 fallback 为 `git diff --name-only HEAD`，仍是同一条边界约束的弱化验证。

---

### Step 8: 边界校验 — Cecelia 仓库零改动 + 无新建 registry/扫描脚本

**来源**: `[FROM_PRD]` — sprint-prd.md 范围限定段第 40 行"不在范围内：Cecelia 仓库任何文件；新建手工 registry/扫描分类脚本"；E2E 期望点 6（第 90 行）。

**可观测行为**: `git diff --name-only` 相对 `origin/main` 的全部变更路径，都落在允许前缀集合（`product-map.yaml` / `product-map/generated/*` / `scripts/product-map/__tests__/*` / `sprints/**`）内；无任何路径含 `cecelia` 字样（大小写不敏感）。

**验证命令**:
```bash
CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null) || CHANGED=$(git diff --name-only HEAD)
echo "$CHANGED" | grep -vE '^(product-map/product-map\.yaml|product-map/generated/product-map\.(json|md)|scripts/product-map/__tests__/.*|sprints/.*)$' \
  && { echo "FAIL: 越界改动（超出允许路径前缀）"; exit 1; } || true
echo "$CHANGED" | grep -qi 'cecelia' \
  && { echo "FAIL: 触碰 Cecelia 仓库路径"; exit 1; } || true
```
**硬阈值**: 两条负向检查均不命中（无越界路径、无 Cecelia 路径）。`CHANGED` 计算与 Step 7 同一 fallback 规则：`origin/main...HEAD` 不可达时不裸吞错误，显式 fallback 为 `git diff --name-only HEAD`，与 `tests/contract.test.js` T7 一致，不得空判通过。

---

### Step 9: 既有回归测试套件全绿（防止假绿脱节）

**来源**: `[AI_ADDED]` — 编辑 yaml 会破坏 `scripts/product-map/__tests__/product-map.test.js` 现有硬编码断言（T1/T3，见"已知约束"段），若不同步更新该文件，`npm run test:product-map`（CI `product-map-contract` job 实跑此命令）会在 PR 上真实报红；本步骤防止 generator 只改 yaml、不同步修复已被打破的历史回归测试，导致本地 `check` 绿但 CI 套件红的"局部绿、整体红"假象。

**可观测行为**: `npm run test:product-map`（含 `product-map.test.js` + `gp-smoke-ratchet.test.js` + `realmachine-unverified-ratchet.test.js` 三个文件全部 `node:test` 用例）全部通过。

**验证命令**:
```bash
npm run test:product-map
```
**硬阈值**: exit 0，无 `not ok` 输出行。

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: autonomous
**target_environment**: local_api

> 本 sprint 无 Brain API / DB / 前端依赖，E2E 脚本直接在仓库根目录跑 CLI + jq + git + npm test，无需起任何服务进程。

```bash
#!/bin/bash
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

echo "=== Step 1: validate ==="
node scripts/product-map/cli.mjs validate

echo "=== Step 2+3: generate + check（无漂移）==="
npm run product-map:generate
npm run product-map:check

echo "=== Step 4: 7 条 Line 精确匹配 ==="
LINES=$(jq -r '[.apps[].lines[].id] | sort | join(",")' product-map/generated/product-map.json)
[ "$LINES" = "line00,line01,line02,line04,line05,line07,line10" ] || { echo "FAIL: lines=$LINES"; exit 1; }
echo "OK lines=$LINES"

echo "=== Step 5: 18 条非废弃 GP 精确分布 ==="
declare -A WANT=( [line01]=1 [line02]=4 [line04]=7 [line05]=1 [line07]=1 [line00]=3 [line10]=1 )
FAIL=0
for L in "${!WANT[@]}"; do
  ACTUAL=$(jq --arg l "$L" '[.golden_paths[] | select(.line_id==$l and .status!="deprecated")] | length' product-map/generated/product-map.json)
  [ "$ACTUAL" = "${WANT[$L]}" ] || { echo "FAIL: line=$L expect=${WANT[$L]} actual=$ACTUAL"; FAIL=1; }
done
TOTAL=$(jq '[.golden_paths[] | select(.status!="deprecated")] | length' product-map/generated/product-map.json)
[ "$TOTAL" = "18" ] || { echo "FAIL: total=$TOTAL expect=18"; FAIL=1; }
[ "$FAIL" = "0" ] || exit 1
echo "OK 18/7 分布精确匹配"

echo "=== Step 6: deprecated 条目原样保留 + 不计数 ==="
DEP=$(jq -r '[.golden_paths[] | select(.status=="deprecated") | .id] | sort | join(",")' product-map/generated/product-map.json)
[ "$DEP" = "customer_private_ai,customer_smart_acquisition,skill_acceptance" ] || { echo "FAIL: dep=$DEP"; exit 1; }
echo "OK deprecated=$DEP"

echo "=== Step 7: 三条新 GP 精确锚定既有 smoke，未新写业务代码 ==="
SM05=$(jq -r '[.golden_paths[] | select(.line_id=="line05" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM05" = ".github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh" ] || { echo "FAIL: SM05=$SM05"; exit 1; }
SM07=$(jq -r '[.golden_paths[] | select(.line_id=="line07" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM07" = ".github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh" ] || { echo "FAIL: SM07=$SM07"; exit 1; }
SM10=$(jq -r '[.golden_paths[] | select(.line_id=="line10" and .status!="deprecated") | .smoke_files[]?] | join(",")' product-map/generated/product-map.json)
[ "$SM10" = ".github/workflows/scripts/smoke/customer-admin-backend-smoke.sh" ] || { echo "FAIL: SM10=$SM10"; exit 1; }
echo "OK smoke_files 精确锚定"

CHANGED=$(git diff --name-only origin/main...HEAD 2>/dev/null) || CHANGED=$(git diff --name-only HEAD)
for f in .github/workflows/scripts/smoke/ai-video-pipeline-local-smoke.sh \
         .github/workflows/scripts/smoke/golden-path-7-video-remake-smoke.sh \
         .github/workflows/scripts/smoke/customer-admin-backend-smoke.sh; do
  echo "$CHANGED" | grep -qxF "$f" && { echo "FAIL: 不得新写/修改锚定 smoke 文件 $f"; exit 1; } || true
done
echo "OK 三个锚定 smoke 文件未被本 sprint 改动"

echo "=== Step 8: 边界 — Cecelia 仓库零改动 + 无越界新文件 ==="
echo "$CHANGED" | grep -vE '^(product-map/product-map\.yaml|product-map/generated/product-map\.(json|md)|scripts/product-map/__tests__/.*|sprints/.*)$' \
  && { echo "FAIL: 越界改动"; exit 1; } || true
echo "$CHANGED" | grep -qi 'cecelia' \
  && { echo "FAIL: 触碰 Cecelia 仓库路径"; exit 1; } || true
echo "OK 边界校验通过"

echo "=== Step 9: 既有回归测试套件全绿 ==="
npm run test:product-map

echo ""
echo "✅ Golden Path 验证通过 — 7 Lines / 18 Capabilities 精确匹配，无漂移"
```

**PASS 标准**: 脚本 exit 0，全部 9 步无 FAIL 输出。
**FAIL 标准**: 任一步骤非零 exit。

---

## Test Contract

（下表「BEHAVIOR 覆盖」列均为对应 `test()` 名的字面子串，已用 `grep -F` 逐条核对命中；已在本地 `node --test` 实跑验证 red 证据，见下方「实测红证据」。）

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| 7 条 Line 精确匹配 | `tests/contract.test.js` | `apps[].lines 精确等于 7 条` | FAIL（当前只有 4 条 line: line00/01/02/04） |
| line00 收敛为 3 条非废弃 | `tests/contract.test.js` | `line00 精确 3 条非废弃 GP` | FAIL（当前 4 条：skill_acceptance 尚未 deprecated） |
| 18 条非废弃 GP 精确分布 | `tests/contract.test.js` | `非 deprecated Golden Path 总数精确为 18` | FAIL（当前 16 条，未含 line05/07/10） |
| line05/07/10 精确锚定既有 smoke | `tests/contract.test.js` | `line05/07/10 三条新 GP 精确锚定` | FAIL（line05/07/10 尚未定义，0 条） |
| deprecated 集合精确为三个历史 id | `tests/contract.test.js` | `deprecated 集合精确为三个历史 id` | FAIL（当前只有 2 个，缺 skill_acceptance） |
| generate 后无漂移（digest 幂等）| `tests/contract.test.js` | `digest 与当前 YAML 一致（无漂移）` | PASS（generate 逻辑本身不依赖本轮编辑内容，非本轮红证据必需项，保留作为回归防护） |
| 边界隔离（Cecelia 零改动 + 无越界文件）| `tests/contract.test.js` | `git diff 变更路径全部落在允许前缀内` | PASS（当前分支尚无越界改动，非本轮红证据必需项，保留作为持续护栏） |

### 实测红证据（本地 `node --test sprints/08122228-zenithjoy-product-map-seven-streams/tests/contract.test.js` 跑在未编辑的 yaml 上）

```
ℹ tests 7
ℹ pass 2
ℹ fail 5
✖ T1: apps[].lines 精确等于 7 条（line00/01/02/04/05/07/10）
✖ T2: line00 精确 3 条非废弃 GP（skill_acceptance 已 deprecated，ability_acceptance 仍 active）
✖ T3: 非 deprecated Golden Path 总数精确为 18，按 line 分布精确匹配
✖ T4: line05/07/10 三条新 GP 精确锚定 PRD 指定的既有 smoke 文件
✖ T5: deprecated 集合精确为三个历史 id，原样保留不删除
✔ T6: product-map:generate 重建投影后 digest 与当前 YAML 一致（无漂移）
✔ T7: git diff 变更路径全部落在允许前缀内，且不含 Cecelia / 不新建注册脚本
```

---

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A — 全部验证命令直接读写真实文件系统 `product-map.yaml` / `product-map/generated/*`，无第三方 API / 无网络调用 / 无需 mock）

---

## 禁止事项自查确认

- 无 `echo "ok"` / `true` 假验证 — 全部验证命令基于 `jq` 精确值比对 + exit code
- autonomous BEHAVIOR 命令不测 playground 服务器 — 全部测真实 `product-map.yaml` / `scripts/product-map/cli.mjs` / `npm test`
- 无 windows_wechat 路由错误 — 本 sprint 不含任何微信/RPA 步骤，`target_environment=local_api` 正确
