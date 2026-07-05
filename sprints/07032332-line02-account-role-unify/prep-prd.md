# PrepPRD：客户智能获客路径 — Sprint 1 号角色数据模型统一

## 本次对话涵盖的所有事项
- [x] 本 PrepPRD 包含：三张平行角色表（agents.machine_role / agent_platform_sessions.role / line02_account_sessions.role）合一 + Dashboard账号管理页加"绑定机器"列 + 删除重复的 DouyinBurnerBindPage 旧页面
- [ ] 另立 Sprint（本次不做）：任务派发调度算法（见 Sprint 2）、Lead人工分配闭环（见 Sprint 3）

## Journey 当前状态
- ✅ Step 1/2/3/5（注册/装Agent/绑飞书/绑抖音小号）— done
- 🔄 机器管理(客户机器+机器上抖音号绑定) — thin working，本次厚化 thin→medium

## 本次要做的
把"主号/小号"这个角色概念从三张互不同步的表（agents.machine_role、agent_platform_sessions.role、line02_account_sessions.role）统一成一套自洽模型；Dashboard账号管理页让管理员能看到"哪个小号绑在哪台机器"；删掉功能重复的旧版 DouyinBurnerBindPage。

## Golden Path
1. 管理员打开"账号管理"页 → 系统显示每个小号的绑定机器列（hostname/agent昵称）→ 管理员能一眼看清"3个小号分别在哪台机器"
2. 管理员访问旧地址 /dashboard/douyin-burner-bind → 系统 404 或重定向到新账号管理页（旧页面代码已删，不是仅从菜单摘除）
3. 系统迁移历史数据：以 agent_platform_sessions（当前唯一被路由代码实际使用的表）为准，把 line02_account_sessions 的 health 探测能力并入同一模型，agents.machine_role 语义与"号角色"解耦（机器角色≠号角色，各自独立字段但不再有第三张平行表）
4. 失败路径：迁移脚本发现某条历史记录在两张表里角色不一致 → 记录冲突到迁移日志 → 以 agent_platform_sessions 为准 → 不阻断迁移，不丢数据
5. 迁移策略：直接 cutover（本 PR 内一次性下线旧字段/表），不做过渡期双写

## 客户视角
管理员打开账号管理页，能同时看到"这个小号"+"绑在哪台机器"，不用再去起任务时才提示。

## 完成后用户能
- 在一个页面看到全部小号及其绑定机器
- 不会再看到两个功能重复的绑号页面

## 涉及的 Ability / Feature
- 机器管理(客户机器+机器上抖音号绑定)（厚化 thin→medium）

## 不包含
- 调度算法本身（Sprint 2）
- Lead人工分配（Sprint 3）

## 前置工作
无需新增凭据/账号，复用现有 DB 连接和 tenant 体系。

## 验收标准（Final E2E）
- [ ] 账号管理页 API/UI 返回每个小号的绑定机器信息
- [ ] /dashboard/douyin-burner-bind 旧路由已删除（404 或重定向）
- [ ] 迁移脚本对现有数据做过 dry-run 验证不丢绑定关系
- [ ] CI 全绿
