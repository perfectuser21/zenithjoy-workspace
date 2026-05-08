# Contract Review Feedback — Round 1

**Reviewer 角色**：Skeptical staff engineer（按 rubric 打分，非自由判断）
**审查对象**：`contract-draft.md` + `contract-dod-ws{1-5}.md` + `tests/ws{1-5}/`

## RUBRIC SCORES

```json
{
  "dod_machineability": 8,
  "scope_match_prd": 9,
  "test_is_red": 9,
  "internal_consistency": 7,
  "risk_registered": 5
}
```

总分 38/50。

### 评分证据

- **DoD 机检性 = 8**：5 个 ws DoD 大部分用 `psql / node -e / supertest / spawnSync` 等真命令。但 ws2 有一条 `grep -E "[type-route]"` 文本检查容易被注释绕过；可接受作为 ARTIFACT 而非主验证。
- **Scope 匹配 PRD = 9**：PRD 9 个 Feature 1:1 映射到 5 个 workstream（Feature 1-2→ws1, 3-4-8→ws2, 5-6→ws3, 7→ws4, 9→ws5），无超范围无遗漏。Step 5 显式排除清晰。
- **Test 真红 = 9**：6 个测试文件都 import 不存在的 module / symbol（如 `apps/api/src/services/walking-skeleton.service.js` 的 `createPublishTask` 含 type 参数），跑必 fail with `cannot find` 或 `is not a function`。路径明确。
- **内部一致 = 7**：contract-draft 和 dod 文件各自定义无重复粘贴。但 ws3 dod `! grep -iE "(skip.*login|assume.*logged.*in|已登录)" services/agent/publishers/douyin-publisher/publish-douyin-image.cjs` 这条假设旧 image.cjs 必有这些字眼，若现状不含会永远 pass — 不能证实"删了旧实现"。建议改成校验 image.cjs 必须 require qr-login 模块（正向指标）。
- **风险登记 = 5**：合同末尾**完全没有 Risks 栏**。PRD ASSUMPTION 8 提到"image 真发昨天能成功"+ASSUMPTION 5 提到"抖音风控"，但 contract 没把这些转成显式 Risk + mitigation 表。Lead 自验是核心环节，cascade 失败（如 xian-pc 临时离线 / lead 手机扫码失败 / 抖音改 UI 选择器）没 mitigation。

## VERDICT: REVISION

Round 1，阈值 7/10。
维度 [风险登记 = 5] 低于阈值 → 必须 REVISION。
[内部一致 = 7] 边界过线但有 1 个具体问题，顺手修。

### 需要 Proposer Round 2 修的（block 项）

**问题 1**（维度：风险登记，当前 5 分，目标 ≥ 7）
**描述**：合同末尾缺 Risks 栏。Sprint 2.1a 涉及多个高风险点：抖音风控、xian-pc 可达性、lead 手机扫码失败、抖音 UI 改版导致 Playwright 选择器失效、video 文件路径在 Windows 上的反斜杠兼容性。这些都没 mitigation 写明。

**修复**：在 contract-draft.md 末尾加 `## Risks` 栏，至少列 4 条具名 risk + 每条 mitigation：
1. 抖音风控（账号被封 / 频控）→ mitigation: lead 自验只发 1 条，账号别频繁登录；evidence 标准降级条款已在 PRD ASSUMPTION 5
2. xian-pc 临时离线 → mitigation: ssh check 进 smoke 前置；不通则 sprint 暂停而不是 fake pass
3. 抖音 UI 改版 → mitigation: video/image 脚本用 robust 选择器（aria-label / data-testid 优先，class 名最后），失败时截屏让 lead 看
4. lead 扫码超时（手机不在身边）→ mitigation: qr-login waitForSelector 至少 60s timeout + 报错信息含"请在 60 秒内扫码"

**问题 2**（维度：内部一致，当前 7 分，建议加固）
**描述**：ws3 dod 用 `! grep -i "skip.*login"` 反向校验"删了旧实现"，但旧 image.cjs 可能根本没这些字眼，反向校验永远 pass = 假绿。
**修复**：改为正向校验 `grep -E "require.*lib/qr-login" services/agent/publishers/douyin-publisher/publish-douyin-image.cjs`（已存在的条目可保留作为辅助）。

## NON-BLOCKING（可选，不强制 round 2 处理）

无。其他维度均 > 7，不挑刺凑数。

## 期望 round 2 输出

`contract-draft.md` 末尾加 `## Risks` 栏（≥4 条 risk + mitigation），ws3 dod 加正向校验条。再 review 一轮。
