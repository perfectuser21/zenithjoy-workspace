# Sprint PRD：抓评论 lead 语义质量闸门（golden-path-2 真机 smoke 加固）

**Sprint 目录**: `sprints/07150917-lead-semantic-quality-gate`
**Task ID**: `7afd9ae2-4462-4725-9f89-5a1d0ae9f818`
**Feature ID**: `b8c6c47b-98d3-4f84-acfd-7707cc35778a`
**Journey ID**: `57df0a2e-a37f-47a6-bf14-cf231a480eed`（Agent 系统 hardening，dev_pipeline，skeleton）
**优先级**: P1
**生成日期**: 2026-07-15

---

## 背景与问题陈述

Path 2（客户智能获客）golden path 4 段：采集→判定→抓评论→私信。PR #1303 修复了抓评论 UIA 节点误判（黑名单正则+DFS遍历）后，本 session 真机验证发现：

`line02-android-collect-realmachine-smoke.sh` 对 Seg3 的断言只写了 `lead_count_raw > 0`，纯机械计数，完全没有对 lead 数据语义质量做校验——即便抓到的全是垃圾（购物车UI文案、被抖音用零宽字符混淆过的日期），该断言照样通过。

真机测试实证：`collect_task_id=98f83567-a136-4a1e-bf70-5129fc558f60` 产生的 2 条 lead 中，1 条是真实评论（"小叶子"/"你这个地上铺的是复合地板吗"），1 条依然是垃圾（"视频同款及更多好物在橱窗里 详情"/被零宽字符混淆的"04-07"）。

---

## Sprint 目标

将 `line02-android-collect-realmachine-smoke.sh` 的 Seg3 断言从「计数大于零」升级为「无语义垃圾」，让 golden path 真机验证阶段能自动拦截已知垃圾 lead，而非依赖人工事后查库发现。

**Path 推进声明**: 本 Sprint 把 Path 2 Seg3 smoke 断言从 ❌（纯计数）推到 ✅（语义质量闸门）

---

## Invariant 约束

以下是来自 Brain DB 的活跃 invariant，本 sprint 必须遵守：

| # | Invariant | 对本 Sprint 的影响 |
|---|-----------|------------------|
| 1 | **无闸不成文**：pipeline 生命周期/记账/验收判据一律下沉代码 | 判定函数必须作为可测试代码存在（不能只是 smoke 脚本里的 inline shell），且必须有独立单测 |
| 2 | **harness 人工救场禁用**：CI 绿不能顶替 evaluator 验收；合同必须 1:1 映射 PrepPRD Golden Path | smoke 脚本必须真实调用判定逻辑，不能用 `exit 0` 占位或假绿 |
| 3 | **harness judge 须按 target_environment 校准证据要求** | target_environment=linux_server；smoke 脚本在 CI Linux 上运行，判定函数需兼容 bash/node 环境 |
| 4 | **harness pipeline 假阳性 smoke 缺口**（wechat-cs-reply 实证） | 本 sprint 的 smoke 断言必须能真正区分垃圾/非垃圾，不能假绿 |
| 5 | **[系统]真环境验证才算 done** | 判定函数必须用 `collect_task_id=98f83567-a136-4a1e-bf70-5129fc558f60` 的真实 fixture 数据验证 |
| 6 | **[系统]禁止写死环境假设值** | smoke 脚本不能硬编码 `collect_task_id`；必须动态从本轮任务获取 |
| 7 | **部署配置漂移铁律** | 若判定函数作为独立 node 脚本部署，必须同步更新 CI workflow 依赖声明 |
| 8 | **[系统]租户隔离** | DB 查询必须带 `tenant_id` 过滤，不得跨租户查询 lead 数据 |
| 9 | **prod 数据库切换**：zenithjoy 独立库（07-14 已生效） | smoke 脚本连接目标为 `zenithjoy_staging`，不得再写 `cecelia.zenithjoy` schema |

---

## 累积 FR（本 sprint 相关）

从 Brain DB decisions 表过滤与本 feature 直接相关的记录：

| # | 类别 | FR 内容摘要 |
|---|------|------------|
| 1 | feature | Agent系统hardening：抓评论lead语义质量闸门——给 Seg3 断言加语义质量检查（黑名单正则+sec_uid辅助，零容忍阈值），只加固 nightly smoke 不做 PR 硬闸 |
| 2 | bug-fix | Bug: 抓评论抓到 UIA 元数据（点赞数/日期/评论数标签）当 lead（PR #1303 修复，但 smoke 未升级断言） |
| 3 | small-change | 安卓挖客守卫从 Seg1 扩成 Seg1-4 端到端（本 sprint 继续推进 Seg3 质量门） |
| 4 | small-change | 真机采集 smoke 硬编码固定测试租户被 DB 重置冲掉致 500（动态获取 collect_task_id 的重要性） |
| 5 | learning | 扩展 CI 守卫类改动用 [CONFIG] 前缀绕 lint-feature-has-smoke（本 sprint 属 smoke 加固，不需要绕，正常走 smoke 路径） |

---

## Feature 规格

### Feature: 抓评论 lead 语义质量闸门（thin）

**Feature ID**: `b8c6c47b-98d3-4f84-acfd-7707cc35778a`
**Thickness**: thin（纯逻辑判定 + smoke 接入，不改 API/DB schema）

#### 判定函数规格

位置：`.github/workflows/scripts/smoke/lib/lead-quality-gate.js`（新建，Node.js）

**输入**：
```js
{
  nickname: string,
  comment_text: string,
  sec_uid: string | null
}[]
```

**输出**：
```js
{
  passed: boolean,
  violations: {
    nickname: string,
    comment_text: string,
    reason: string
  }[]
}
```

**判定逻辑**（两路组合）：

1. **归一化**：先 strip 零宽字符（U+2060 WORD JOINER、U+200B ZERO WIDTH SPACE、U+FEFF BOM 等全部 Unicode 零宽族），再执行黑名单正则匹配

2. **黑名单正则**（命中任一即判定为垃圾）：

   | 类别 | 正则 | 示例命中 |
   |------|------|---------|
   | 点赞数格式 | `/^\d+(\.\d+)?[万kK]?\+?$/` | `1.2万`、`999+` |
   | 评论数标题 | `/^(共)?\d+条评论$/` | `共123条评论` |
   | 日期格式（含零宽混淆变体） | `/^\d{1,4}-\d{1,2}(-\d{1,2})?$/` | `04-07`、`2026-07-14` |
   | 排序 tab | `/^(最新|最热|置顶)$/` | `最新` |
   | IP 属地前缀 | `/^(IP属地[:：])?\S{2,6}省?$/` | `广东`、`IP属地：北京` |
   | 购物车/推广 UI 词表 | `/(详情|橱窗|同款|更多好物|在橱窗里|立即购买|点击购买)/` | `视频同款及更多好物在橱窗里 详情` |

3. **sec_uid 覆盖率辅助信号**（仅日志，不参与 PASS/FAIL 判定）：
   - 统计本批 lead 中 `sec_uid` 非 NULL 的比例
   - 在日志输出中打印，作为 UIA 抽取质量的参考指标

4. **阈值**：零容忍——≥1 条命中黑名单即 `passed = false`

#### Smoke 脚本改动规格

文件：`.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh`

**改动位置**：Seg3 断言段（`lead_count_raw` 判断处，约第 152-163 行附近）

**改动前**（示意）：
```bash
lead_count_raw=$(psql_query "SELECT COUNT(*) FROM acquisition_leads WHERE collect_task_id='$COLLECT_TASK_ID'")
assert_gt "$lead_count_raw" 0 "Seg3: lead count should be > 0"
```

**改动后**（示意）：
```bash
# Step 1: 计数断言保留
lead_count_raw=$(psql_query "SELECT COUNT(*) FROM acquisition_leads WHERE collect_task_id='$COLLECT_TASK_ID' AND tenant_id='$TENANT_ID'")
assert_gt "$lead_count_raw" 0 "Seg3: lead count should be > 0"

# Step 2: 语义质量断言（新增）
LEADS_JSON=$(psql_query_json "SELECT nickname, comment_text, sec_uid FROM acquisition_leads WHERE collect_task_id='$COLLECT_TASK_ID' AND tenant_id='$TENANT_ID'")
QUALITY_RESULT=$(node .github/workflows/scripts/smoke/lib/lead-quality-gate.js "$LEADS_JSON")
QUALITY_PASSED=$(echo "$QUALITY_RESULT" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); process.stdout.write(String(r.passed))")
if [ "$QUALITY_PASSED" != "true" ]; then
  echo "[FAIL] Seg3 语义质量闸门：发现疑似垃圾 lead"
  echo "$QUALITY_RESULT" | node -e "const r=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); r.violations.forEach(v=>console.log('  命中: '+v.nickname+' / '+v.comment_text+' → '+v.reason))"
  exit 1
fi
echo "[PASS] Seg3 语义质量闸门：$lead_count_raw 条 lead 全部通过质量检查"
```

#### 单测规格

文件：`.github/workflows/scripts/smoke/lib/lead-quality-gate.test.js`（新建，使用 Node.js 内置 `assert`，无需外部框架）

**必覆盖测试用例**：

| 用例 | nickname | comment_text | 预期结果 |
|------|----------|--------------|---------|
| 真实评论-1 | 小叶子 | 你这个地上铺的是复合地板吗 | passed=true |
| 垃圾-购物车UI | （任意） | 视频同款及更多好物在橱窗里 详情 | passed=false，reason含"购物车/推广UI" |
| 垃圾-零宽字符混淆日期 | （任意） | `04⁠-​07`（还原后为04-07） | passed=false，reason含"日期格式" |
| 垃圾-点赞数 | 1.2万 | （任意） | passed=false，reason含"点赞数格式" |
| 垃圾-评论数标题 | 共123条评论 | （任意） | passed=false，reason含"评论数标题" |
| 混合批次（1干净+1垃圾） | 小叶子 + 垃圾 | 正常评论 + 橱窗 | passed=false（零容忍，1条命中即FAIL） |

---

## Golden Path（dev_pipeline 视角）

```
Step 1: 真机跑完抓评论任务
   ↓
Step 2: smoke 脚本从 DB 查询本轮 collect_task_id 对应的 acquisition_leads（带 tenant_id 过滤）
   ↓
Step 3: 调用 lead-quality-gate.js，对每条记录的 nickname/comment_text 做归一化（strip零宽字符）后跑黑名单正则
   ↓
Step 4a: 命中垃圾特征（购物车UI/点赞数/日期/排序tab/IP属地等）
         → 标记"疑似垃圾"，打印 sec_uid 覆盖率作为辅助佐证
         → smoke FAIL，打印每条命中的 nickname/comment_text 原文 + 命中判据
   ↓
Step 4b: 0 条命中 → smoke pass，打印通过数量确认
```

---

## 验收标准（Final E2E）

| # | 验收项 | 验证方式 | 通过条件 |
|---|--------|---------|---------|
| E1 | 判定函数对真实 fixture 分类正确（干净数据） | 单测：nickname="小叶子", comment_text="你这个地上铺的是复合地板吗" | `passed=true` |
| E2 | 判定函数对购物车 UI 文案分类正确 | 单测：comment_text="视频同款及更多好物在橱窗里 详情" | `passed=false`，violations 含命中原因 |
| E3 | 零宽字符归一化有效 | 单测：comment_text 含零宽字符混淆后的"04-07" | `passed=false`，reason 含"日期格式" |
| E4 | 零容忍阈值：1 条垃圾即 FAIL | 单测：混合批次（干净+垃圾各1条） | `passed=false` |
| E5 | smoke 脚本 Seg3 接入质量闸门 | CI 运行 `line02-android-collect-realmachine-smoke.sh` | 垃圾 lead 导致 FAIL 并打印命中原因；干净数据通过 |
| E6 | 独立单测全绿 | `node lead-quality-gate.test.js` | 所有 assert 通过，exit 0 |
| E7 | CI 全绿 | GitHub Actions workflow | lint / smoke syntax check 全部通过 |

---

## NFR（Non-Functional Requirements）

| # | NFR | 具体要求 |
|---|-----|---------|
| N1 | **可独立运行** | `lead-quality-gate.js` 不依赖 npm 包或 DB 连接，纯函数输入输出，任意 Node.js 14+ 环境可运行 |
| N2 | **单测无外部依赖** | `lead-quality-gate.test.js` 使用 Node.js 内置 `assert`，无 jest/mocha 依赖，`node lead-quality-gate.test.js` 直接运行 |
| N3 | **Fail-fast 日志可读** | FAIL 时每条命中的输出格式：`[FAIL] nickname="..." comment_text="..." 命中判据："..."` |
| N4 | **租户隔离** | smoke 脚本所有 DB 查询必须携带 `tenant_id=$TENANT_ID`，禁止跨租户查询 |
| N5 | **零宽字符覆盖完整** | 归一化必须 strip U+2060、U+200B、U+200C、U+200D、U+FEFF、U+FFFE 共 6 种常见零宽字符 |
| N6 | **Smoke 脚本语法兼容** | 改动后 `bash -n line02-android-collect-realmachine-smoke.sh` 必须无错 |
| N7 | **不影响现有 Seg1/Seg2/Seg4** | 改动范围仅限 Seg3 断言段和新增 lib 文件，不改其他 Seg 逻辑 |

---

## 不包含（Out of Scope）

- harness-generator/harness-contract 的真机 UIA 证据前置检查（另立 sprint，不同 repo）
- 将语义闸门升级为 PR 硬闸（真机资源接入 PR pipeline 成本较大，另开 sprint 讨论）
- 重新设计 NodeExtractor.kt 的抽取架构（如改用 resourceId/bounds 结构判定）
- 多租户 smoke 并发测试

---

## 开发顺序（TDD 强制）

```
commit-1: 写失败的单测 lead-quality-gate.test.js（含所有 E1-E4 用例，此时无实现）
commit-2: 实现 lead-quality-gate.js，让单测全绿
commit-3: 改写 line02-android-collect-realmachine-smoke.sh Seg3 断言段接入质量闸门
commit-4: CI 验证全绿
```

**第一个 commit 必须是单测，不是实现。**

---

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `.github/workflows/scripts/smoke/lib/lead-quality-gate.js` | 新建 | 判定函数主体 |
| `.github/workflows/scripts/smoke/lib/lead-quality-gate.test.js` | 新建 | 独立单测（commit-1 先建） |
| `.github/workflows/scripts/smoke/line02-android-collect-realmachine-smoke.sh` | 修改 | Seg3 断言段接入质量闸门 |

---

## 前置条件（已确认）

- [x] hk-vps zenithjoy_staging DB 访问：`ssh hk-vps "docker exec zenithjoy-db-postgres psql ..."` 已验证可用
- [x] staging API `X-Tenant-Id`/`X-Smoke-Token` 已在 smoke 脚本中存在并验证可用
- [x] 真实 fixture 数据：`collect_task_id=98f83567-a136-4a1e-bf70-5129fc558f60` 含真实垃圾+干净各 1 条
- [x] Node.js 在 CI runner (linux_server) 上可用

---

## journey_type: dev_pipeline
## target_environment: linux_server
