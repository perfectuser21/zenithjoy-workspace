# Sprint Contract Draft — Product Map SSOT (Claude Code)

**Sprint ID:** 9130f0be-8e8d-4cc5-96f5-7a5313804496
**Sprint Dir:** `sprints/07280933-product-map-ssot-claude`
**合同轮次:** Round 1（无上轮 reviewer feedback）
**起草日期:** 2026-07-28
**类型:** infrastructure
**目标环境:** github_actions + local_node

---

## 合同范围声明

本 Sprint 为 `sprints/07280817-staff-ability-acceptance` Phase 0A，**唯一目标**是在 ZenithJoy 仓库中建立版本化、机器可验证的 Product Map SSOT。本合同不包含：Brain 投影、Staff Hub UI/API、Harness 自动验收生成、Line 01/02/04 客户侧 Golden Path。

---

## [BEHAVIOR-01] 产品分类结构解析

**前提条件:** `product-map/product-map.yaml` 存在且符合 `product-map/product-map.schema.json`

**行为:** 调用 `loadAndValidateProductMap()` 时，

**断言:**
- 返回对象含 `{ map, errors }` 结构
- `map.apps` 精确包含 `customer_app` 和 `staff_app` 两个条目（不多不少）
- `customer_app.lines` 精确包含 `line01`、`line02`、`line04`（不含 `line00`）
- `staff_app.lines` 精确包含 `line00`（不含 line01/02/04）
- `errors` 为空数组
- **负向：** 传入缺少 `apps` 字段的 YAML → `errors` 非空，`map` 为 null

---

## [BEHAVIOR-02] 种子分类精确性

**前提条件:** `product-map.yaml` 按 PRD §3 种子分类手写

**行为:** 解析 `staff_app/line00` 的 Golden Path 列表

**断言:**
- `golden_paths` 数组精确包含且仅包含：`skill_acceptance`（status: active）、`ability_acceptance`（status: proposed）、`line_health`（status: active）
- `customer_app` 下三条 Line（01/02/04）的 `golden_paths` 均为空数组（不含任何虚构条目）
- `ability_acceptance` 的 `status` 精确为 `"proposed"`（不得升为 `"active"`）

---

## [BEHAVIOR-03] Surface 与 Edition 类型隔离

**前提条件:** `product-map.yaml` 包含 surfaces 与 editions 字段

**行为:** 解析顶层分类元数据

**断言:**
- `map.surfaces` 精确为 `["web", "api", "android", "windows"]`（顺序规范化后一致）
- `map.editions` 精确为 `["personal_wechat", "wecom"]`（顺序规范化后一致）
- `web`、`android`、`windows`、`api` 不出现在 `map.editions` 中
- `personal_wechat`、`wecom` 不出现在 `map.surfaces` 中

---

## [BEHAVIOR-04] 交叉引用关系校验 — 有效引用通过

**前提条件:** `product-map.yaml` 中所有 GP 引用均存在于顶层注册表

**行为:** 调用 `validateRelations(map)`

**断言:**
- 返回空数组（零错误）
- 所有 GP 的 `app_id` 均在 `map.apps` 中存在
- 所有 GP 的 `line_id` 均在对应 app 的 `lines` 中存在
- 所有 GP 的 `required_surfaces`（如有）均在 `map.surfaces` 中存在
- 所有 GP 的 `edition`（如有）均在 `map.editions` 中存在

---

## [BEHAVIOR-05] 交叉引用关系校验 — 无效引用报错

**前提条件:** 临时构造含无效引用的 map 对象（不修改文件）

**行为:** 调用 `validateRelations(invalidMap)`

**断言（3 个负向用例）:**
- GP 的 `app_id` 为 `"missing_app"` → 错误消息包含 `"references unknown app"` 字样
- GP 的 `required_surfaces` 包含 `"mobile"` → 错误消息包含 `"references unknown surface"` 字样
- 两个 GP 拥有相同 `id` → 错误消息包含 `"duplicate"` 字样（大小写不敏感）
- 每条错误均为可操作字符串（含具体 ID，非通用占位符）
- **schema 校验失败时 `validateRelations` 不被调用**（关系校验在 schema 验证通过后执行）

---

## [BEHAVIOR-06] 确定性投影生成

**前提条件:** `product-map.yaml` 通过 schema 和关系校验

**行为:** 运行 `npm run product-map:generate`

**断言:**
- `product-map/generated/product-map.json` 存在且为合法 JSON
- `product-map/generated/product-map.md` 存在
- 两个文件均包含相同的 SHA-256 摘要（`digest` 字段/注释）
- 连续运行两次 `npm run product-map:generate` 后 `git diff` 无变化（字节级幂等）
- JSON 键按规范化顺序排列（`apps` 内 `lines` 内 `golden_paths` 层序一致）

---

## [BEHAVIOR-07] 漂移检测

**前提条件:** 生成文件与 YAML 当前状态一致

**行为:** 运行 `npm run product-map:check`

**断言（正向）:**
- 当 generated 文件与当前 YAML 一致时，`check` 退出码为 0

**断言（负向）:**
- 在不重新生成的情况下修改 `product-map.yaml`（如改一个 GP status）→ `check` 退出码为 1
- `check` 的 stderr/stdout 输出包含 `"drift"` 或 `"mismatch"` 字样（可操作提示）

---

## [BEHAVIOR-08] Provider Bootstrap 无手写分类

**前提条件:** `AGENTS.md`、`.claude/CLAUDE.md`、`DEFINITION.md` 均已按 FR-04 替换

**行为:** 调用 `assertBootstrapParity(map, documents)`

**断言:**
- 三个文件均不包含 App/Line/GP 的 ID 或名称（如 `customer_app`、`line01`、`skill_acceptance`）的字面量拷贝
- 三个文件均包含 `product-map/generated/product-map.md` 的相对路径引用
- 三个文件均包含 `npm run product-map:check` 的指令字面量
- **负向：** 向 `AGENTS.md` 注入 `customer_app` → `assertBootstrapParity` 抛错，错误消息包含 `"duplicates Product Map fact"` 字样

---

## [BEHAVIOR-09] 贡献者文档断言

**前提条件:** `product-map/README.md` 已创建

**行为:** 解析 README 内容

**断言（7 个 assert.match）:**
1. 文档包含 `"所有权"` 或 `"ownership"` 字样（大小写不敏感）
2. 文档包含变更工作流的 7 个步骤编号（如 `1.`...`7.`）
3. 文档包含 GP 准入规则的 3 个必要条件
4. 文档明确区分 Surface vs Line（包含两个词且在同一段落）
5. 文档明确区分 Edition vs Line（包含两个词且在同一段落）
6. 文档包含 `product-map/generated/product-map.md` 引用
7. 文档包含 `npm run product-map:check` 或 `product-map:validate` 命令

---

## [BEHAVIOR-10] CI L2 Job 无 paths 过滤器

**前提条件:** `.github/workflows/ci-l2-consistency.yml` 已追加 `product-map-contract` Job

**行为:** 检查 Job 配置结构

**断言:**
- Job `product-map-contract` 存在于 workflow 文件中
- 该 Job **不含** `paths:` 过滤器（任何 push/PR/merge_group 均触发）
- 该 Job 的步骤包含 `npm ci`、`npm run test:product-map`、`npm run product-map:check` 三条命令
- `timeout-minutes: 5`（精确值）
- `l2-passed` 的 `needs` 数组包含 `product-map-contract`

---

## [BEHAVIOR-11] test-registry.yaml 注册

**前提条件:** `test-registry.yaml` 已修改

**行为:** 解析注册表文件

**断言:**
- 存在 id 为 `product-map-contract` 的条目
- `type: unit`（精确匹配）
- `ci: L2`（精确匹配）
- `status: active`（精确匹配）
- 根字段 `updated` 更新为 `"2026-07-28"`
- 新条目的 `path` 指向 `scripts/product-map/__tests__/product-map.test.js`

---

## [BEHAVIOR-12] 范围外交付物不存在

**前提条件:** PR 提交后

**行为:** 检查 PR diff

**断言（负向守卫）:**
- PR 不含 Brain API 相关路由或服务文件变更
- PR 不含 Staff Hub UI 页面（`apps/dashboard/src/pages/` 下无新增与 ability_acceptance UI 相关文件）
- PR 不含数据库迁移文件（`apps/api/src/db/migrations/`）
- PR 不含 Harness 自动生成相关代码
- `product-map.yaml` 不包含 Line 01/02/04 的任何 Golden Path 条目（这些 Line 在本 Sprint 不应有正式 GP）

---

## E2E 验收段（Bash 可执行）

```bash
#!/usr/bin/env bash
# contract-e2e.sh — Product Map SSOT Sprint E2E 验收
# 运行环境：Node.js 20，从 repo root 执行
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "=== Step 1: 安装依赖 ==="
npm ci --workspace=scripts/product-map 2>/dev/null || npm ci

echo "=== Step 2: Schema + 关系校验 ==="
npm run product-map:validate
echo "PASS: product-map:validate"

echo "=== Step 3: 合同测试（7 个）==="
npm run test:product-map
echo "PASS: test:product-map"

echo "=== Step 4: 冻结分类语义核查 ==="
node -e "
const m = require('./product-map/generated/product-map.json');
const result = {
  apps: m.apps.map(a => [a.id, a.lines.map(l => l.id)]),
  gps: m.golden_paths.map(g => [g.app_id, g.line_id, g.id, g.status]),
  surfaces: m.surfaces,
  editions: m.editions
};
const expected = JSON.stringify({
  apps: [['customer_app',['line01','line02','line04']],['staff_app',['line00']]],
  gps: [
    ['staff_app','line00','skill_acceptance','active'],
    ['staff_app','line00','ability_acceptance','proposed'],
    ['staff_app','line00','line_health','active']
  ],
  surfaces: ['web','api','android','windows'],
  editions: ['personal_wechat','wecom']
});
const actual = JSON.stringify(result);
if (actual !== expected) {
  console.error('FAIL: 分类语义不符');
  console.error('期望:', expected);
  console.error('实际:', actual);
  process.exit(1);
}
console.log('PASS: 分类语义核查');
"

echo "=== Step 5: 漂移检测（正向） ==="
npm run product-map:check
echo "PASS: product-map:check（无漂移）"

echo "=== Step 6: 幂等性验证 ==="
npm run product-map:generate
npm run product-map:generate
if ! git diff --quiet -- product-map/generated/; then
  echo "FAIL: generate 不幂等，存在 diff"
  git diff -- product-map/generated/
  exit 1
fi
echo "PASS: generate 幂等"

echo "=== Step 7: 负向用例 — GP app_id 引用不存在 app ==="
node -e "
import { loadAndValidateProductMap, validateRelations } from './scripts/product-map/lib.mjs';
const { map } = await loadAndValidateProductMap();
const badMap = { ...map, golden_paths: [
  ...map.golden_paths,
  { id: 'test_gp', app_id: 'missing_app', line_id: 'line00', status: 'active' }
]};
const errors = validateRelations(badMap);
const hasExpectedError = errors.some(e => e.toLowerCase().includes('references unknown app'));
if (!hasExpectedError) {
  console.error('FAIL: 期望报 references unknown app，实际:', errors);
  process.exit(1);
}
console.log('PASS: 负向 — missing_app 报错');
" --input-type=module

echo "=== Step 8: 负向用例 — required_surfaces 含 mobile ==="
node -e "
import { loadAndValidateProductMap, validateRelations } from './scripts/product-map/lib.mjs';
const { map } = await loadAndValidateProductMap();
const badMap = { ...map, golden_paths: [
  ...map.golden_paths,
  { id: 'test_gp2', app_id: 'staff_app', line_id: 'line00', status: 'active', required_surfaces: ['mobile'] }
]};
const errors = validateRelations(badMap);
const hasExpectedError = errors.some(e => e.toLowerCase().includes('references unknown surface'));
if (!hasExpectedError) {
  console.error('FAIL: 期望报 references unknown surface，实际:', errors);
  process.exit(1);
}
console.log('PASS: 负向 — mobile surface 报错');
" --input-type=module

echo "=== Step 9: 负向用例 — AGENTS.md 注入分类词汇 ==="
node -e "
import { loadAndValidateProductMap, assertBootstrapParity } from './scripts/product-map/lib.mjs';
import { readFileSync } from 'node:fs';
const { map } = await loadAndValidateProductMap();
const fakeAgentsMd = readFileSync('./AGENTS.md', 'utf8') + '\ncustomer_app';
const docs = { 'AGENTS.md': fakeAgentsMd };
try {
  assertBootstrapParity(map, docs);
  console.error('FAIL: 期望抛错但未抛');
  process.exit(1);
} catch (e) {
  if (!e.message.toLowerCase().includes('duplicates product map fact')) {
    console.error('FAIL: 错误消息不含 duplicates Product Map fact:', e.message);
    process.exit(1);
  }
  console.log('PASS: 负向 — bootstrap 分类注入报错');
}
" --input-type=module

echo ""
echo "=============================="
echo "  ALL E2E CHECKS PASSED"
echo "=============================="
```

---

## 合同测试文件映射

| 测试文件 | 覆盖 BEHAVIOR | 类型 |
|---------|--------------|------|
| `sprints/07280933-product-map-ssot-claude/tests/contract.test.js` | BEHAVIOR-01 ~ 12 | unit (node:test) |

> 注意：上述测试文件为合同阶段的验收测试。实现阶段正式测试文件位于 `scripts/product-map/__tests__/product-map.test.js`，两者验收逻辑一致，合同测试为 mock-free 可独立运行的断言集。

---

## 关键风险

1. **ESM 路径：** `lib.mjs` 使用 `import.meta.url` 构造路径，测试文件须以 `--input-type=module` 或 `.mjs` 扩展名运行；Node.js 内置 `node:test` 在 ESM 模式下的 `--experimental-vm-modules` 标志依赖需提前验证。
2. **Ajv strict 模式：** `{ strict: true }` 会拒绝 schema 中未被 JSON Schema 2020-12 认可的 keywords，迁移注意 `$schema` 声明需精确匹配。
3. **DEFINITION.md 替换：** 现有 `DEFINITION.md` 包含手写架构事实；替换时须保留文件存在（指针化），不得删除文件（其他工具可能引用路径）。
4. **test-registry.yaml 孤儿测试检测：** 新增测试文件 `scripts/product-map/__tests__/product-map.test.js` 须同步注册，否则 `orphan-test-check` Job 会阻断 CI。
