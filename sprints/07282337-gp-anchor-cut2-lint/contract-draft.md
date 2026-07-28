# Sprint Contract Draft (Round 1)

## 已知约束（来自回归测试）

- `golden-path-f1-anchor-smoke.sh`（刀1产物）文件头注释：「刀2/刀4落地时应往本文件追加断言，而非另起新文件」——本刀必须遵守，不新建平行smoke文件
- `product-map/generated/product-map.json` 已 tracked，字段名为 `smoke_files`（复数数组），非设计文档笔误的单数 `smoke_file`
- `ci-l1-process.yml` 现有 15 个 lint job 均为纯 bash 秒级完成（对照组 `Test — Deploy Lib` 走 npm ci 实测 ~101s，且未被拉进 `l1-passed.needs`，说明"需要装依赖的慢job"在本仓库惯例里不进硬阻塞聚合）
- context-manifest: unavailable（GP锚定校验ability首次推进，累积FR摘要为空）

## Response Schema
N/A — 任务无 HTTP 响应（纯 CI shell 脚本 + workflow yaml 改动）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|--------------------------|
| **FR（做什么）** | PR body 必须含合法GP-Anchor声明才能通过CI，否则红 | 见Golden Path |
| **NFR（做得多好）** | 维持L1"秒级"设计，不引入npm ci/node运行时 | jq读已生成JSON，无额外依赖安装 |
| **Invariant（永不违反）** | 不真调Brain API（GHA runner够不到localhost:5221）；一律硬闸，无hotfix/label旁路 | 脚本层面锁死 |
| **判定点（怎么知道）** | 无（本任务无接缝判定点） | N/A |
| **保质期（何时过期）** | 本闸门本身不过期；`gp_anchor_enforcement`状态仍为proposed，待刀3-5落地 | 见验收标准 |
| **死亡告警（停了谁知道）** | job失败即PR无法合并，天然强制 | N/A |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见下表 |
| **效果确认（已发≠已生效）** | 无对外动作 | N/A |

### 判定点登记表
（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| PR body 无/多行 GP-Anchor 声明 | `::error::GP-ANCHOR-MISSING` 或 `GP-ANCHOR-MULTIPLE`，非0退出 | 是（纯读操作） | 无降级，必须改PR body |
| 推进类 id 不存在 | `::error::GP-ANCHOR-ID-NOTFOUND` + line级简表，非0退出 | 是 | 无降级，改正id或换用keep-green/none |
| 推进类未触碰smoke_files | `::error::GP-ANCHOR-NOT-TOUCHED` + 期望路径列表，非0退出 | 是 | 无降级，需真实改动对应文件或改用keep-green |
| product-map.json解析失败(环境异常) | `::error::GP-ANCHOR-ENV-FAIL`，与业务判定失败区分 | 是 | 无降级，需先修复product-map本身 |

### 输入对抗面
N/A（PR body来自仓库贡献者，非外部匿名用户；不涉及prompt injection场景，仅做格式解析）

## 禁 mock 边清单
（本单纯CI shell脚本+workflow yaml改动，无调度/状态机/跨模块数据传递/生命周期钩子/DB写路径接缝，N/A）

## 未覆盖真实链路清单
（本合同无mock豁免，N/A——全部验证均为真实文件读取+真实git diff执行，无第三方API/无外部调用方）

## Risks

| 风险 | 说明 | Mitigation |
|---|---|---|
| 无path-scope,正则写错误伤全仓库PR | 不同于lint-feature-has-smoke.sh有"非feat/未改apps/*/src→skip"的前置豁免,本闸对**每一个**PR生效,格式判定逻辑写错会拖累所有无关PR | 上线前用近40个历史真实PR body样本(见handoff记录)跑一遍脚本验证格式判定正确率,而非只测手造样例 |
| product-map/generated/product-map.json与PR分支实际product-map.yaml不同步 | 若PR只改yaml未跑generate,读到的JSON可能未反映最新GP | 由已存在的ci-l2-consistency.yml的product-map-contract job的drift check兜底(该job与本闸独立并行,若不同步会在该job报错,PR仍会被拦，只是拦在L2而非L1，效果等价) |
| PR_BODY含特殊字符导致shell解析异常 | 反引号/`$()`/超长文本直接inline拼进run:是已知GHA注入风险点 | 通过env:注入+写临时文件用grep -F/jq读取,不在run:里字符串插值 |
| jq对product-map.json结构变化敏感 | 未来若刀3-5调整JSON schema(如golden_paths字段改名),本脚本的jq查询路径会失效 | jq查询路径与刀1lib.mjs的字段名保持完全一致引用,后续刀改字段名时需同步改本脚本(不在本刀范围内新增独立测试防护,留意即可) |

## Golden Path
[开发者/AI提交PR，body写GP-Anchor声明] → [lint解析恰好一行] → [按三形态分支校验] → [挂三处闸] → [出口：CI绿/红]

### Step 1: 解析 PR body 的 GP-Anchor 声明行
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 1

**可观测行为**: `lint-gp-anchor.sh` 从 `$PR_BODY`（env注入，非inline拼接，防shell注入）中提取以 `GP-Anchor:` 开头的行；恰好1行则继续；0行或≥2行直接报错退出

**验证命令**:
```bash
cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1
PR_BODY="GP-Anchor: line00/gp_anchor_enforcement#step2" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | tail -5
echo "exit: $?"
```

**硬阈值**: 恰好1行合法声明时不因"数量校验"这一步报错（后续步骤可能因id/diff原因报错，那是Step2/3的职责）

---

### Step 1-失败: 零行/多行声明
**来源**: `[FROM_PRD]` — PrepPRD 错误路径

**可观测行为**: 空PR body或无GP-Anchor行 → `::error::GP-ANCHOR-MISSING`；2行及以上 → `::error::GP-ANCHOR-MULTIPLE`，均非0退出

**验证命令**:
```bash
PR_BODY="" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | grep -q "GP-ANCHOR-MISSING" || { echo FAIL; exit 1; }
PR_BODY=$'GP-Anchor: line00/gp_anchor_enforcement#step2\nGP-Anchor: line01/customer_first_success#step1' bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | grep -q "GP-ANCHOR-MULTIPLE" || { echo FAIL; exit 1; }
echo PASS
```

**硬阈值**: 两个负向样例均以对应结构化错误码非0退出

---

### Step 2: 推进类 id 存在性校验
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 2

**可观测行为**: `line02/customer_smart_acquisition#step7` 形态 → 用 `jq` 查 `product-map/generated/product-map.json` 的 `golden_paths[]` 是否存在 `line_id=="line02" and id=="customer_smart_acquisition"`；不存在则报错，附 line 级简表

**验证命令**:
```bash
PR_BODY="GP-Anchor: line99/nonexistent_gp#step1" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | grep -q "GP-ANCHOR-ID-NOTFOUND" || { echo FAIL; exit 1; }
echo PASS
```

**硬阈值**: 不存在的id组合以GP-ANCHOR-ID-NOTFOUND非0退出，且输出含line级简表（可从其余合法id中任取一个验证输出含有）

---

### Step 3: 推进类 diff 触碰校验
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 3

**可观测行为**: 声明推进的GP，其`smoke_files`数组至少一条路径须出现在 `git diff --name-only origin/main...HEAD` 的结果里；本刀自身PR会真实修改`golden-path-f1-anchor-smoke.sh`（追加断言），天然满足`line00/gp_anchor_enforcement`的触碰要求

**验证命令**:
```bash
cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1
PR_BODY="GP-Anchor: line00/gp_anchor_enforcement#step2" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | tail -3
echo "exit: $?"
```

**硬阈值**: 本PR分支（已修改golden-path-f1-anchor-smoke.sh）对gp_anchor_enforcement的推进声明判定为PASS（自举验收）

---

### Step 4: keep-green 声明
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 4

**可观测行为**: `line01/customer_first_success keep-green` → 只校验id存在，不查diff

**验证命令**:
```bash
PR_BODY="GP-Anchor: line01/customer_first_success keep-green" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1
echo "exit: $?"
```

**硬阈值**: exit 0（不要求diff触碰customer_first_success的smoke_files）

---

### Step 5: none(类别) 豁免声明
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 5

**可观测行为**: `none(docs)`/`none(infra)`/`none(config)` 直接放行；`none(backlog)` 要求同一行或body内含类issue-id token（8位hex等格式，纯正则，不真调Brain API）；白名单外类别报错

**验证命令**:
```bash
PR_BODY="GP-Anchor: none(docs)" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1; echo "exit: $?"
PR_BODY="GP-Anchor: none(unknown_category)" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main 2>&1 | grep -q "GP-ANCHOR" || { echo FAIL; exit 1; }
echo PASS
```

**硬阈值**: 白名单内类别exit 0；白名单外类别非0退出

---

### Step 6: 三处挂载 ci-l1-process.yml
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 6

**可观测行为**: job定义存在 + `l1-passed.needs`数组含`lint-gp-anchor` + `l1-passed`内部`if`判断块含对该job结果的检查

**验证命令**:
```bash
grep -q "^  lint-gp-anchor:" .github/workflows/ci-l1-process.yml || { echo "FAIL: 缺job定义"; exit 1; }
grep -q "lint-gp-anchor\]" .github/workflows/ci-l1-process.yml || { echo "FAIL: 缺needs挂载"; exit 1; }
grep -q 'needs.lint-gp-anchor.result' .github/workflows/ci-l1-process.yml || { echo "FAIL: 缺if判断块"; exit 1; }
echo PASS
```

**硬阈值**: 三条grep全PASS

---

### Step 7: 配套文件
**来源**: `[FROM_PRD]` — PrepPRD 配套要求

**可观测行为**: `.github/pull_request_template.md`新建且含`GP-Anchor:`提示；设计文档字段名bug修正为`smoke_files`

**验证命令**:
```bash
test -f .github/pull_request_template.md || { echo "FAIL: PR模板未建"; exit 1; }
grep -q "GP-Anchor" .github/pull_request_template.md || { echo "FAIL: 模板缺提示"; exit 1; }
grep -q "smoke_files" docs/superpowers/specs/2026-07-28-gp-anchor-enforcement-design.md || { echo "FAIL: 设计文档字段名未修正"; exit 1; }
echo PASS
```

**硬阈值**: 三条断言全PASS

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -e
cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1

echo "=== Step A: 负向样例（应全部判红）==="
FAIL_COUNT=0
PR_BODY="" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/e2e-a1.log 2>&1 && FAIL_COUNT=$((FAIL_COUNT+1)) || true
grep -q "GP-ANCHOR-MISSING" /tmp/e2e-a1.log || FAIL_COUNT=$((FAIL_COUNT+1))

PR_BODY=$'GP-Anchor: a\nGP-Anchor: b' bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/e2e-a2.log 2>&1 && FAIL_COUNT=$((FAIL_COUNT+1)) || true
grep -q "GP-ANCHOR-MULTIPLE" /tmp/e2e-a2.log || FAIL_COUNT=$((FAIL_COUNT+1))

PR_BODY="GP-Anchor: line99/nonexistent#step1" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main > /tmp/e2e-a3.log 2>&1 && FAIL_COUNT=$((FAIL_COUNT+1)) || true
grep -q "GP-ANCHOR-ID-NOTFOUND" /tmp/e2e-a3.log || FAIL_COUNT=$((FAIL_COUNT+1))

[ "$FAIL_COUNT" -eq 0 ] || { echo "FAIL: 负向样例未全部正确判红 ($FAIL_COUNT 处偏差)"; exit 1; }
echo "✅ 负向样例全部正确判红"

echo "=== Step B: 正向样例（应全部判绿）==="
PR_BODY="GP-Anchor: line00/gp_anchor_enforcement#step2" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main
PR_BODY="GP-Anchor: line01/customer_first_success keep-green" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main
PR_BODY="GP-Anchor: none(docs)" bash .github/workflows/scripts/lint-gp-anchor.sh origin/main
echo "✅ 正向样例全部通过"

echo "=== Step C: 三处挂载校验 ==="
grep -q "^  lint-gp-anchor:" .github/workflows/ci-l1-process.yml
grep -q "lint-gp-anchor\]" .github/workflows/ci-l1-process.yml
grep -q 'needs.lint-gp-anchor.result' .github/workflows/ci-l1-process.yml
echo "✅ 三处挂载到位"

echo "=== Step D: 配套文件 ==="
test -f .github/pull_request_template.md
grep -q "GP-Anchor" .github/pull_request_template.md
grep -q "smoke_files" docs/superpowers/specs/2026-07-28-gp-anchor-enforcement-design.md
echo "✅ 配套文件到位"

echo "=== Step E: 未新建平行smoke文件 ==="
[ "$(find .github/workflows/scripts/smoke -name '*anchor*' | wc -l | tr -d ' ')" -eq 1 ] || { echo "FAIL: 疑似新建了平行smoke文件"; exit 1; }
echo "✅ 未新建平行smoke文件"

echo "✅ Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| GP-Anchor行数校验(0/1/多) | `scripts/product-map/__tests__/lint-gp-anchor.test.js` | 0行/多行判红，恰好1行放行 | → 脚本不存在时 N failures |
| id存在性校验 | 同上 | 不存在id判红+line级简表 | → 脚本不存在时 N failures |
| diff触碰校验 | 同上 | 推进类diff未触碰判红 | → 脚本不存在时 N failures |
| 三处挂载 | `sprints/07282337-gp-anchor-cut2-lint/tests/mount.test.sh` | job定义/needs/if判断块 | → 三处均不存在时 N failures |
