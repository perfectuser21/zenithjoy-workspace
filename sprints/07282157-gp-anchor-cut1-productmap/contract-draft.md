# Sprint Contract Draft (Round 1)

## 已知约束（来自回归测试）

- `scripts/product-map/__tests__/product-map.test.js` T3 → `assert.equal(customerGps.length, 0, 'Line 01/02/04 须无 GP')`（本次必须同步改写，否则本PR自证CI红）
- `sprints/07280933-product-map-ssot-claude/tests/contract.test.js` → BEHAVIOR-02 精确断言 `gps` 数组仅含3条 line00 GP（同步改写）
- `apps/api/src/services/__tests__/dockerfile-product-map.test.ts` → 已有回归测试确保 `product-map/generated/` 被拷进生产镜像（本次不触碰 Dockerfile，无需改动，仅确认覆盖仍成立）
- context-manifest: unavailable（journey e6f803f2 首次登记 Ability，尚无累积FR摘要）

## Response Schema
N/A — 任务无 HTTP 响应（纯 CLI 工具 + 数据文件 + CI job 改动）

## 八要素需求规范

| 要素 | 说明 | 本次答案 |
|------|------|--------------------------|
| **FR（做什么）** | product-map SSOT 承载客户线GP的业务步骤+smoke路径，CI校验其真实存在 | 见Golden Path |
| **NFR（做得多好）** | 新增校验对 product-map-contract job 增加的耗时可忽略（<100ms，逐条 test -f） | 无需专项埋点 |
| **Invariant（永不违反）** | 新校验不得让现存3条line00 GP（尤其无smoke_files的skill_acceptance）被追溯性判红 | smoke_files为可选字段，仅"声明了才校验"实现grandfather |
| **判定点（怎么知道）** | 无（本任务无接缝判定点） | N/A |
| **保质期（何时过期）** | `line00/gp_anchor_enforcement` 的 status=proposed，待刀2-5全部落地+设计文档§8验收标准全过后由后续PR翻转为active | 见验收标准 |
| **死亡告警（停了谁知道）** | CI job失败即PR无法合并，属天然强制；无需额外告警通道 | N/A |
| **失败语义（挂了怎么办）** | 见下方失败语义声明 | 见下表 |
| **效果确认（已发≠已生效）** | 无对外动作（无发布/无通知），本次改动效果即CI job本身通过与否 | N/A |

### 判定点登记表
（本任务无接缝判定点，N/A）

### 失败语义声明

| 场景 | 失败行为 | 重试幂等？ | 降级策略 |
|------|----------|-----------|----------|
| YAML 语法错误 | `product-map:validate` 报 `FAIL: YAML syntax error at line X`，非0退出 | 是（纯静态文件重跑幂等） | 无降级，开发者必须修复语法 |
| smoke_files 路径不存在/为空 | `product-map:check` 报错列出缺失路径+范例，非0退出 | 是 | 无降级，必须创建/修复对应脚本 |
| ajv 版本升级导致 compile 异常 | `test:product-map` 新增 compile 冒烟断言先行报错，而非在真实校验处崩溃 | 是 | 无降级，锁定/回退 ajv 版本 |

### 输入对抗面
N/A（不对外暴露agent，无外部用户可写入接口）

## 禁 mock 边清单

（本单纯CLI工具+数据文件+CI job改动，无调度/状态机/跨模块数据传递/生命周期钩子/DB写路径接缝，N/A）

## 未覆盖真实链路清单
（本合同无 mock 豁免，N/A——全部验证均为真实文件系统操作+真实CI命令执行，无第三方API/无真实设备调用方）

## Risks

| 风险 | 说明 | Mitigation |
|---|---|---|
| schema扩展导致现有3条line00 GP意外判红 | additionalProperties:false下新增字段若schema定义有误，会连带影响skill_acceptance/ability_acceptance/line_health三条既有条目 | Step 3验证命令里同时跑既有3条GP的validate，作为回归防线（已含在`product-map:validate`全量校验里，非新增条目专属） |
| smoke_files质量判据（≥5行+真实命令）误伤既有合法smoke脚本 | 复用lint-feature-has-smoke.sh同款判据时，判据本身若过严可能把某些短小但合法的smoke脚本误判为"空占位" | 判据只应用于**新增**的smoke_files声明（line01/02/04+gp_anchor_enforcement四条），不回溯校验已存在多年的line00三条 |
| ajv版本升级（dependabot类PR）导致product-map-contract job在无关PR上突然报错 | package.json ajv为`^8.20.0`浮动range，非本次改动触发但可能在未来任意PR上炸 | 见Step 4-失败对应的ajv compile冒烟断言，本刀1一并补齐 |

## Golden Path
[开发者/AI编辑product-map.yaml] → [validate] → [generate] → [check] → [CI job] → [GP自身注册] → [变异测试smoke] → [出口：CI全绿]

### Step 1: 补充 steps/smoke_files 字段并 schema 校验
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 1

**可观测行为**: `npm run product-map:validate` 对新增三条客户线GP + gp_anchor_enforcement条目返回 PASS；对格式错误的条目（如smoke_files非数组类型、id不匹配`^step[0-9]+$`）返回带具体字段名的FAIL

**验证命令**:
```bash
cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1
npm run product-map:validate 2>&1 | tee /tmp/pm-validate.log
grep -q "PASS" /tmp/pm-validate.log || { echo "FAIL: validate未通过"; exit 1; }
```

**硬阈值**: exit code 0 且输出含 PASS 标记

---

### Step 1-失败: YAML 语法错误诊断
**来源**: `[AI_ADDED]` — Challenger审查发现现有`loadAndValidateProductMap()`无try/catch，语法错误会裸堆栈崩溃，与其余`FAIL:`风格不一致，10秒定位门槛不达标

**可观测行为**: 故意在临时副本引入缩进错误 → `product-map:validate` 输出 `FAIL: YAML syntax error at line X`，非Node裸堆栈

**验证命令**:
```bash
cp product-map/product-map.yaml /tmp/pm-backup.yaml
python3 -c "
content = open('product-map/product-map.yaml').read()
content = content.replace('apps:', 'apps:\n   bad_indent:')
open('product-map/product-map.yaml', 'w').write(content)
"
OUTPUT=$(npm run product-map:validate 2>&1)
cp /tmp/pm-backup.yaml product-map/product-map.yaml
echo "$OUTPUT" | grep -qE "FAIL: YAML syntax error" || { echo "FAIL: 未按预期报YAML语法错误"; exit 1; }
```

**硬阈值**: 输出含 `FAIL: YAML syntax error`，非未捕获异常堆栈

---

### Step 2: 重新生成投影
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 2

**可观测行为**: `product-map/generated/product-map.json` 和 `.md` 重新生成，MD投影含steps/smoke_files两列内容

**验证命令**:
```bash
npm run product-map:generate
grep -q "gp_anchor_enforcement" product-map/generated/product-map.json || { echo "FAIL: JSON未含新GP"; exit 1; }
grep -qE "steps|smoke_files" product-map/generated/product-map.md || { echo "FAIL: MD投影未渲染新字段"; exit 1; }
```

**硬阈值**: 两个生成文件均含新增字段内容

---

### Step 3: 漂移检测 + smoke_files 存在性/非空校验
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 3

**可观测行为**: `product-map:check` PASS（无漂移）；对声明了`smoke_files`但路径不存在或文件为空占位（<5行或无真实命令）的条目，报错列出具体路径+一条现有合法条目作范例

**验证命令**:
```bash
npm run product-map:check 2>&1 | tee /tmp/pm-check.log
grep -q "PASS" /tmp/pm-check.log || { echo "FAIL: check未通过"; exit 1; }
```

**硬阈值**: exit code 0

---

### Step 3-失败: smoke_files 缺失/空文件报错定位
**来源**: `[AI_ADDED]` — Agent C（混沌工程师）发现"存在但是空文件"未被覆盖，`lint-feature-has-smoke.sh`的质量判据未被product-map自身复用

**可观测行为**: 临时给某条GP声明一个不存在的`smoke_files`路径 → `check`报错含该路径字符串；临时指向一个空文件 → 同样报错

**验证命令**:
```bash
node -e "
const { validateSmokeFiles } = require('./scripts/product-map/lib.mjs');
const fakeMap = { golden_paths: [{ id: 'test_gp', smoke_files: ['.github/workflows/scripts/smoke/nonexistent-fake.sh'] }] };
try {
  const result = validateSmokeFiles(fakeMap, process.cwd());
  if (result.ok) { console.error('FAIL: 应该检测到缺失文件'); process.exit(1); }
  if (!result.errors.some(e => e.includes('nonexistent-fake.sh'))) { console.error('FAIL: 错误信息未含具体路径'); process.exit(1); }
  console.log('PASS');
} catch(e) { console.error('FAIL:', e.message); process.exit(1); }
"
```

**硬阈值**: 返回非ok且错误信息包含具体缺失路径字符串

---

### Step 4: CI job 校验（结构化错误前缀）
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 4 + Agent D（运维专家）建议的可观测性前缀

**可观测行为**: `.github/workflows/ci-l2-consistency.yml` 的 `product-map-contract` job 新增smoke_files存在性校验步骤；失败时日志带结构化前缀（如`::error::GP-SMOKE-MISSING`）

**验证命令**:
```bash
grep -q "product-map:check" .github/workflows/ci-l2-consistency.yml || { echo "FAIL: job未调用check"; exit 1; }
node -e "const c=require('fs').readFileSync('scripts/product-map/lib.mjs','utf8'); if(!c.includes('GP-SMOKE-MISSING')) process.exit(1)" || { echo "FAIL: 缺结构化错误前缀"; exit 1; }
```

**硬阈值**: 两条grep/node断言均PASS

---

### Step 4-补: ajv版本供应链冒烟断言
**来源**: `[AI_ADDED]` — Agent C（混沌工程师）发现ajv浮动版本升级可能在无关PR上突然让product-map-contract job报错，PrepPRD错误路径Step4-失败已明确要求此断言

**可观测行为**: `test:product-map` 新增一条断言，确认当前schema能被当前ajv版本成功`compile()`，不依赖真实数据校验路径

**验证命令**:
```bash
grep -q "ajv.*compile" scripts/product-map/__tests__/product-map.test.js || { echo "FAIL: 缺ajv compile冒烟断言"; exit 1; }
npm run test:product-map 2>&1 | grep -qiE "fail" && { echo "FAIL: compile冒烟断言未通过"; exit 1; }
echo PASS
```

**硬阈值**: 断言存在且test:product-map全绿

---

### Step 5: GP自身注册
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 5

**可观测行为**: `product-map.yaml` 的 `golden_paths` 含 `line00/gp_anchor_enforcement` 条目，`status=proposed`，`smoke_files`含`.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh`

**验证命令**:
```bash
node -e "
const yaml = require('yaml');
const fs = require('fs');
const doc = yaml.parse(fs.readFileSync('product-map/product-map.yaml', 'utf8'));
const gp = doc.golden_paths.find(g => g.id === 'gp_anchor_enforcement');
if (!gp) { console.error('FAIL: gp_anchor_enforcement未注册'); process.exit(1); }
if (gp.status !== 'proposed') { console.error('FAIL: status应为proposed，实际:', gp.status); process.exit(1); }
if (!gp.smoke_files || !gp.smoke_files.includes('.github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh')) { console.error('FAIL: smoke_files未正确指向'); process.exit(1); }
console.log('PASS');
"
```

**硬阈值**: 三项断言全PASS

---

### Step 6: 变异测试 smoke（零网络零DB）
**来源**: `[FROM_PRD]` — PrepPRD Golden Path Step 6，范围收窄仅测刀1自身交付物

**可观测行为**: `golden-path-f1-anchor-smoke.sh` 跑三段变异测试：① 格式错误样例被validate正确判红 ② smoke_files存在性/非空校验正确触发 ③ gp_anchor_enforcement自身注册数据正确；脚本本身不发起任何网络/DB调用

**验证命令**:
```bash
bash .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh
echo "exit code: $?"
[ $? -eq 0 ] || { echo "FAIL: smoke脚本未通过"; exit 1; }
grep -qE "curl|psql|nc |wget" .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh && { echo "FAIL: smoke脚本疑似含网络/DB调用"; exit 1; }
echo PASS
```

**硬阈值**: 脚本exit 0，且不含网络/DB调用命令

---

## E2E 验收（最终 final-e2e 跑）

**journey_type**: dev_pipeline
**target_environment**: local_api

```bash
#!/bin/bash
set -e
cd /Users/administrator/worktrees/zenithjoy/session-b08db3c1

echo "=== Step A: schema+数据校验 ==="
npm run product-map:validate
npm run product-map:generate
npm run product-map:check

echo "=== Step B: 既有回归测试同步改写后仍全绿 ==="
npm run test:product-map 2>&1 | tee /tmp/e2e-test-product-map.log
grep -qE "fail|FAIL" /tmp/e2e-test-product-map.log && { echo "FAIL: product-map单测有失败"; exit 1; }

echo "=== Step C: 变异测试smoke真跑 ==="
bash .github/workflows/scripts/smoke/golden-path-f1-anchor-smoke.sh

echo "=== Step D: GP自身注册数据正确性 ==="
node -e "
const yaml = require('yaml');
const fs = require('fs');
const doc = yaml.parse(fs.readFileSync('product-map/product-map.yaml', 'utf8'));
const required = ['customer_first_success', 'customer_smart_acquisition', 'customer_private_ai', 'gp_anchor_enforcement'];
for (const id of required) {
  if (!doc.golden_paths.find(g => g.id === id)) { console.error('FAIL: 缺少GP', id); process.exit(1); }
}
console.log('✅ 全部4条新GP已注册');
"

echo "✅ Golden Path 验证通过"
```

## Test Contract

| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| product-map schema扩展(steps/smoke_files) | `scripts/product-map/__tests__/product-map.test.js` | schema校验通过新增字段格式 | → schema字段不存在时 N failures |
| smoke_files存在性/非空校验 | `scripts/product-map/__tests__/product-map.test.js` | smoke_files存在性与非空占位校验正确触发 | → 校验函数不存在时 N failures |
| 三条客户线GP+gp_anchor_enforcement注册 | `sprints/07280933-product-map-ssot-claude/tests/contract.test.js` | 新增GP条目通过关系校验 | → GP未注册时 N failures |
