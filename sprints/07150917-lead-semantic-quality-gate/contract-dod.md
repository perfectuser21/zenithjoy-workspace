# DoD 清单：抓评论 lead 语义质量闸门

**Task ID**: `7afd9ae2-4462-4725-9f89-5a1d0ae9f818`
**Feature ID**: `b8c6c47b-98d3-4f84-acfd-7707cc35778a`
**版本**: v1（2026-07-15）

---

## [BEHAVIOR] B1：干净评论 → passed=true

**描述**: 真实用户评论（nickname="小叶子"，comment_text="你这个地上铺的是复合地板吗"）通过质量闸门，`passed` 为 `true`，`violations` 为空数组。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
const result = checkLeadQuality([{nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'abc123'}]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== true) { console.error('FAIL: expected passed=true'); process.exit(1); }
if (result.violations.length !== 0) { console.error('FAIL: expected violations=[]'); process.exit(1); }
console.log('PASS: B1 干净评论通过');
"
```

---

## [BEHAVIOR] B2：购物车 UI 文案 → passed=false，reason 含"购物车/推广UI"

**描述**: `comment_text="视频同款及更多好物在橱窗里 详情"` 命中购物车/推广 UI 词表黑名单，`passed` 为 `false`，`violations[0].reason` 包含 `"购物车/推广UI"` 字样。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
const result = checkLeadQuality([{nickname: '用户A', comment_text: '视频同款及更多好物在橱窗里 详情', sec_uid: null}]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== false) { console.error('FAIL: expected passed=false'); process.exit(1); }
if (!result.violations[0].reason.includes('购物车/推广UI')) { console.error('FAIL: reason 未含购物车/推广UI，actual=' + result.violations[0].reason); process.exit(1); }
console.log('PASS: B2 购物车UI文案被拦截');
"
```

---

## [BEHAVIOR] B3：零宽字符混淆日期 → passed=false，reason 含"日期格式"

**描述**: `comment_text` 中含零宽字符（U+2060/U+200B 等）分隔的"04-07"，归一化 strip 零宽字符后命中日期正则，`passed` 为 `false`，`violations[0].reason` 包含 `"日期格式"`。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
// 04[U+2060]-[U+200B]07 — 零宽字符混淆日期
const mixedDate = '04⁠-​07';
const result = checkLeadQuality([{nickname: '用户B', comment_text: mixedDate, sec_uid: null}]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== false) { console.error('FAIL: expected passed=false after normalization'); process.exit(1); }
if (!result.violations[0].reason.includes('日期格式')) { console.error('FAIL: reason 未含日期格式，actual=' + result.violations[0].reason); process.exit(1); }
console.log('PASS: B3 零宽字符混淆日期被归一化拦截');
"
```

---

## [BEHAVIOR] B4：零容忍阈值——混合批次（1干净+1垃圾）→ passed=false

**描述**: 批次中只要有 1 条命中黑名单，整批 `passed` 为 `false`（零容忍）。violations 数组仅含垃圾条目，干净条目不出现在 violations 中。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
const result = checkLeadQuality([
  {nickname: '小叶子', comment_text: '你这个地上铺的是复合地板吗', sec_uid: 'abc123'},
  {nickname: '用户C', comment_text: '视频同款及更多好物在橱窗里 详情', sec_uid: null}
]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== false) { console.error('FAIL: 混合批次应 passed=false（零容忍）'); process.exit(1); }
if (result.violations.length !== 1) { console.error('FAIL: violations 应有 1 条（仅垃圾），实际=' + result.violations.length); process.exit(1); }
console.log('PASS: B4 零容忍混合批次测试通过');
"
```

---

## [BEHAVIOR] B5：点赞数格式（nickname）→ passed=false

**描述**: `nickname="1.2万"` 命中点赞数格式正则，`passed` 为 `false`。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
const result = checkLeadQuality([{nickname: '1.2万', comment_text: '正常评论内容', sec_uid: 'xxx'}]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== false) { console.error('FAIL: expected passed=false'); process.exit(1); }
if (!result.violations[0].reason.includes('点赞数格式')) { console.error('FAIL: reason 未含点赞数格式，actual=' + result.violations[0].reason); process.exit(1); }
console.log('PASS: B5 点赞数格式被拦截');
"
```

---

## [BEHAVIOR] B6：评论数标题 → passed=false

**描述**: `nickname="共123条评论"` 命中评论数标题正则，`passed` 为 `false`。

**manual:bash 验收命令**:
```bash
cd /workspace
node -e "
const { checkLeadQuality } = require('.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs');
const result = checkLeadQuality([{nickname: '共123条评论', comment_text: '正常评论内容', sec_uid: null}]);
console.log(JSON.stringify(result, null, 2));
if (result.passed !== false) { console.error('FAIL: expected passed=false'); process.exit(1); }
if (!result.violations[0].reason.includes('评论数标题')) { console.error('FAIL: reason 未含评论数标题，actual=' + result.violations[0].reason); process.exit(1); }
console.log('PASS: B6 评论数标题被拦截');
"
```

---

## [BEHAVIOR] B7：单测全量运行 exit 0

**描述**: `node .github/workflows/scripts/smoke/lib/lead-quality-gate.test.js` 直接运行，无外部依赖，所有断言通过，exit 0。

**manual:bash 验收命令**:
```bash
cd /workspace
node .github/workflows/scripts/smoke/lib/lead-quality-gate.test.cjs && echo "PASS: 单测全绿" || echo "FAIL: 单测有失败"
```

---

## [BEHAVIOR] B8：smoke 脚本语法合规

**描述**: 改动后 smoke 脚本 `bash -n` 语法检查无错。

**manual:bash 验收命令**:
```bash
cd /workspace
bash -n .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh && echo "PASS: bash -n 语法检查通过" || echo "FAIL: 语法错误"
```

---

## CI 集成验收

| 检查项 | 命令 | 通过条件 |
|--------|------|---------|
| 单测 | `node .github/workflows/scripts/smoke/lib/lead-quality-gate.test.cjs` | exit 0 |
| bash 语法 | `bash -n .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` | exit 0 |
| node 语法检查 | `node --check .github/workflows/scripts/smoke/lib/lead-quality-gate.cjs` | exit 0 |

---

## 完成标志

- [ ] B1-B8 全部 manual:bash 验收通过
- [ ] 单测（`lead-quality-gate.test.js`）在 CI 中 exit 0
- [ ] `line02-android-collect-realmachine-smoke.sh` bash -n 无错
- [ ] PR 描述含：「本 PR 把 Path 2 Seg3 smoke 断言从 ❌（纯计数）推到 ✅（语义质量闸门）」
