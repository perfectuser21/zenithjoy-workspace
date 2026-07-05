# GAN Round 1 Reviewer Feedback — REVISION

阈值 7/10。三维 < 7：scope_match_prd(6) / internal_consistency(5) / risk_registered(2)

## 问题 1（风险登记，当前 2 分，目标 ≥7）
合同全文无 Risk 栏。补 `## Risk` 段，至少含：
1. assignment_id 迁移对 Windows 既有触达记录的影响 + mitigation（`ADD COLUMN IF NOT EXISTS` 幂等、不改动已有行值，向后兼容）
2. outreach-history 从"永远空列表"变"有数据"后，前端/下游是否有未处理过的非空分支 + mitigation（核实 Dashboard `AcquisitionOutreachPage` 现有空态渲染分支是否会因数据突然出现而报错，若未验证需标注待人工核实）
3. `device_platform` 与既有 `agents.os_type` 语义重复的技术债 + mitigation（见问题 3）

## 问题 2（scope 匹配 PRD，当前 6 分，目标 ≥7）
assignment_id 断点修复是让 PRD Step 7 可验证的必要前置，可以留在本 sprint，但 PRD 原文完全没预告，且这是跨平台（含 Windows）既有生产 bug，不是 Android 专属工作。二选一解除阻塞：
- (a) 合同里明确标注"这是为了让 Step 7 可验证而做的必要前置修复，非新 feature"，并要求 Generator 在 PR 描述里显式声明"本 PR 额外修复既有断点 X，理由 Y"，与"Android 私信发送"主线功能区分清楚，方便未来单独 revert
- (b) 改为登记一个独立 Issue 跟踪该断点，本 sprint Step 7 验证条件降级为"该 bug 已有 Issue 跟踪，Android 侧 sent 状态在 dm_assignments.status 层面可验证即可，Dashboard 展示层验证不计入本 sprint 硬阈值"

任选其一即可。

## 问题 3（内部一致，当前 5 分，目标 ≥7）
1. 测试路径写错：合同"已知约束"段引用 `apps/api/src/handlers/__tests__/douyin-dm-outreach.test.ts`，真实路径是 `services/agent/src/handlers/__tests__/douyin-dm-outreach.test.ts`（apps/api vs services/agent 目录错误），改正
2. 新字段 `device_platform` 与仓库已有 `agents.os_type`（`20260529_100000_add_os_type_to_agents.sql`，Android agent 已在上报 `os_type: "android"`，见 `AgentRegistrar.kt:40`）语义重复。二选一解除阻塞：
   - 合同里加一句明确说明两者关系："`device_platform` 是 payload 里的执行通道标记，值来自 `agents.capabilities` 判定，与 `agents.os_type`（设备操作系统上报）是两条独立信号线，当前不保证一致（未来 Android 设备也可能跑非 Android capability），因此不能互相替代"
   - 或者：如果实际语义就是重复的，改为直接从 `agents.os_type` 派生 `device_platform` 值，避免维护两套信号

## 次要（非阻塞，顺手改）
- Verification Oracle：补一条"两次回传都成功但连续操作后 dm_assignments.status 是否被第二次调用重置"的 jq/psql 硬断言，替换掉目前模糊的文字表述
