# Contract Draft：抓评论 lead 语义质量闸门

**Sprint 目录**: `sprints/07150917-lead-semantic-quality-gate`
**Task ID**: `7afd9ae2-4462-4725-9f89-5a1d0ae9f818`
**Feature ID**: `b8c6c47b-98d3-4f84-acfd-7707cc35778a`
**合同版本**: v1（首轮，2026-07-15）
**Journey**: Path 2（客户智能获客）dev_pipeline hardening
**Path 推进声明**: 本 Sprint 把 Path 2 Seg3 smoke 断言从 ❌（纯计数 `lead_count_raw > 0`）推到 ✅（语义质量闸门，黑名单正则+零宽字符归一化+零容忍阈值）

---

## 问题定义

`line02-android-collect-realmachine-smoke.sh` Seg3 断言仅做 `lead_count_raw > 0` 计数检查，无语义质量校验。真机验证（`collect_task_id=98f83567-a136-4a1e-bf70-5129fc558f60`）实证：2 条 lead 中 1 条是购物车 UI 文案 + 零宽字符混淆日期，纯计数断言照样通过，无法拦截已知垃圾。

---

## 交付物清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs` | 新建 | 判定函数主体（纯函数，无外部依赖；.cjs 兼容根目录 ESM package.json） |
| `.github/workflows/scripts/smoke/lib/lead-quality-gate.test.cjs` | 新建（commit-1 先建，Red 状态） | 独立单测，覆盖 E1-E6；sprints/tests/ 目录有骨架 |
| `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` | 修改 | Seg3 断言段接入质量闸门（约第 152-163 行） |

---

## 判定函数规格

**位置**: `.github/workflows/scripts/smoke/lib/lead-quality-gate.js`

**文件**: `.github/workflows/scripts/smoke/lib/lead-quality-gate.cjs`（.cjs 扩展名以兼容根目录 `"type": "module"`）

**函数签名**:
```js
/**
 * @param {Array<{nickname: string, comment_text: string, sec_uid: string|null}>} leads
 * @returns {{passed: boolean, violations: Array<{nickname: string, comment_text: string, reason: string}>, sec_uid_coverage: number}}
 */
function checkLeadQuality(leads)
```

**归一化（必须先做，再做黑名单匹配）**:
- Strip 以下 6 种 Unicode 零宽字符后再做正则匹配：
  - U+2060 WORD JOINER
  - U+200B ZERO WIDTH SPACE
  - U+200C ZERO WIDTH NON-JOINER
  - U+200D ZERO WIDTH JOINER
  - U+FEFF BOM / ZERO WIDTH NO-BREAK SPACE
  - U+FFFE（反向 BOM）

**黑名单正则**（命中任一即标记为垃圾）:

| 类别 | 正则 | 匹配字段 | 示例命中 |
|------|------|---------|---------|
| 点赞数格式 | `/^\d+(\.\d+)?[万kK]?\+?$/` | nickname 或 comment_text | `1.2万`、`999+`、`1000` |
| 评论数标题 | `/^(共)?\d+条评论$/` | nickname 或 comment_text | `共123条评论` |
| 日期格式（含零宽混淆变体） | `/^\d{1,4}-\d{1,2}(-\d{1,2})?$/` | nickname 或 comment_text | `04-07`、`2026-07-14` |
| 排序 tab | `/^(最新|最热|置顶)$/` | nickname 或 comment_text | `最新` |
| IP 属地前缀 | `/^(IP属地[:：])?\S{2,6}省?$/` | nickname 或 comment_text | `广东`、`IP属地：北京` |
| 购物车/推广 UI 词表 | `/(详情\|橱窗\|同款\|更多好物\|在橱窗里\|立即购买\|点击购买)/` | comment_text | `视频同款及更多好物在橱窗里 详情` |

**sec_uid 辅助信号**（仅日志，不参与 PASS/FAIL）:
- 统计 `sec_uid` 非 NULL 且非空字符串的比例
- 输出到 `sec_uid_coverage` 字段（0.0～1.0），供日志打印参考

**阈值**: 零容忍——`violations.length >= 1` 即 `passed = false`

---

## E2E 验收

### E1：干净数据 → PASS

**验证方式**: 单测 + smoke fixture
**输入**:
```json
[{"nickname": "小叶子", "comment_text": "你这个地上铺的是复合地板吗", "sec_uid": "abc123"}]
```
**断言**: `passed === true`，`violations.length === 0`

### E2：购物车 UI 文案 → FAIL

**验证方式**: 单测
**输入**:
```json
[{"nickname": "用户A", "comment_text": "视频同款及更多好物在橱窗里 详情", "sec_uid": null}]
```
**断言**: `passed === false`，`violations[0].reason` 包含 `"购物车/推广UI"` 字样

### E3：零宽字符混淆日期 → FAIL

**验证方式**: 单测（验证归一化有效）
**输入**: `comment_text` 中包含被零宽字符分隔的 `04-07`（Unicode: `04⁠-​07`）
**断言**: `passed === false`，`violations[0].reason` 包含 `"日期格式"` 字样

### E4：零容忍阈值——混合批次（1 干净 + 1 垃圾）→ FAIL

**验证方式**: 单测
**输入**:
```json
[
  {"nickname": "小叶子", "comment_text": "你这个地上铺的是复合地板吗", "sec_uid": "abc123"},
  {"nickname": "用户B", "comment_text": "视频同款及更多好物在橱窗里 详情", "sec_uid": null}
]
```
**断言**: `passed === false`（1 条命中即 FAIL，零容忍）

### E5：点赞数格式 → FAIL

**验证方式**: 单测
**输入**: `nickname = "1.2万"`，comment_text 任意正常文字
**断言**: `passed === false`，reason 含 `"点赞数格式"`

### E6：评论数标题 → FAIL

**验证方式**: 单测
**输入**: `nickname = "共123条评论"`，comment_text 任意正常文字
**断言**: `passed === false`，reason 含 `"评论数标题"`

### E7：smoke 脚本 Seg3 接入质量闸门

**验证方式**: CI 运行 `line02-android-collect-realmachine-smoke.sh`
**断言**:
- 垃圾 lead 导致 `[FAIL] Seg3 语义质量闸门` 输出并 `exit 1`
- 干净数据输出 `[PASS] Seg3 语义质量闸门: N 条 lead 全部通过质量检查`

### E8：单测独立运行全绿

**验证方式**: `node .github/workflows/scripts/smoke/lib/lead-quality-gate.test.js`
**断言**: 所有 assert 通过，`exit 0`

### E9：smoke 脚本语法合规

**验证方式**: `bash -n .github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`
**断言**: 无语法错误，exit 0

---

## 判定函数 CLI 接口（供 smoke 脚本调用）

```bash
node .github/workflows/scripts/smoke/lib/lead-quality-gate.cjs "$LEADS_JSON"
# LEADS_JSON = psql 查询返回的 JSON 数组字符串（从 argv[2] 读取，或从 stdin 读取）
# stdout = {"passed":true/false,"violations":[...],"sec_uid_coverage":0.5}
# exit code = 0（不管 passed 与否，exit 0；由 shell 读 passed 字段决定是否 exit 1）
```

---

## Smoke 脚本 Seg3 改动规格

**改动位置**: `line02-android-collect-realmachine-smoke.sh` 第 152-163 行（`LEADS` 变量赋值与断言处）

**改动后逻辑**:
```bash
# Step 1: 计数断言保留（不变）
[ "${LEADS:-0}" -gt 0 ] || fail "..."

# Step 2: 语义质量断言（新增）
LEADS_JSON=$(curl -fsSk -m 10 "$API_BASE/api/acquisition/leads" \
  -H "X-Tenant-Id: $TENANT" \
  -G --data-urlencode "collect_task_id=$TASK" 2>/dev/null \
  | jq '[.data.leads[] | {nickname: .nickname, comment_text: .comment_text, sec_uid: .sec_uid}]' 2>/dev/null)

QUALITY_RESULT=$(node .github/workflows/scripts/smoke/lib/lead-quality-gate.cjs "$LEADS_JSON")
QUALITY_PASSED=$(echo "$QUALITY_RESULT" | node -e \
  "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.parse(d).passed.toString()))")

if [ "$QUALITY_PASSED" != "true" ]; then
  echo "[FAIL] Seg3 语义质量闸门：发现疑似垃圾 lead"
  echo "$QUALITY_RESULT" | node -e \
    "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{JSON.parse(d).violations.forEach(v=>console.log('  命中: nickname=\"'+v.nickname+'\" comment_text=\"'+v.comment_text+'\" → '+v.reason))})"
  fail "Seg3 语义质量闸门：lead 质量校验失败"
fi
ok "Seg3 语义质量闸门：$LEADS 条 lead 全部通过质量检查"
```

---

## NFR 约束

| # | 约束 | 验证方式 |
|---|------|---------|
| N1 | `lead-quality-gate.cjs` 不依赖 npm 包或 DB 连接，纯函数 | `node --check` 不报 require 错误 |
| N2 | 单测无外部依赖，`node lead-quality-gate.test.cjs` 直接运行 | CI 直接 node 运行 |
| N3 | FAIL 时日志格式：`[FAIL] nickname="..." comment_text="..." 命中判据："..."` | 单测验证输出包含规定格式 |
| N4 | smoke 所有 DB 查询携带 `tenant_id=$TENANT` | 代码审查 |
| N5 | 归一化覆盖 6 种零宽字符（U+2060/200B/200C/200D/FEFF/FFFE） | 单测 E3 |
| N6 | `bash -n line02-android-collect-realmachine-smoke.sh` 无错 | CI 自动 |
| N7 | 改动范围仅限 Seg3 断言段和新增 lib 文件，不改 Seg1/2/4 | 代码审查 |

---

## Out of Scope

- 将语义闸门升级为 PR 硬闸（nightly smoke only）
- 重新设计 NodeExtractor.kt 抽取架构
- 多租户 smoke 并发测试
- harness-generator 真机 UIA 证据前置检查

---

## TDD 开发顺序（强制）

```
commit-1: 写失败的单测 lead-quality-gate.test.cjs（E1-E6 全部用例，此时无实现 → Red）
          骨架已在 sprints/07150917-lead-semantic-quality-gate/tests/lead-quality-gate.test.cjs
          需复制到 .github/workflows/scripts/smoke/lib/lead-quality-gate.test.cjs
commit-2: 实现 lead-quality-gate.cjs，让单测全绿 → Green
commit-3: 改写 line02-android-collect-realmachine-smoke.sh Seg3 断言段接入质量闸门
commit-4: CI 验证（bash -n 语法检查 + 单测运行）
```
