# 小改动 PrepPRD：agent 启动归零 startup-reset——启动前置幂等复位 checklist

> Brain task: `0f0368cf-6659-4a28-b6cf-0ce862ce753b`（P0, dev, claimed by session:941a55e7）
> 用户拍板原话（2026-07-17 rog 深度审计后）：**agent 一启动必须瞬间把机子归零到零状态再启动所有东西，要有 checklist。**
> 用户确认信号：handoff 呈现后新 session 用户明示"你开始做"。

## 改什么

**扩展现有 `services/agent/src/bootstrap-convergence.ts`（启动第零阶段，decision 72740815），不另起炉灶。**
现有骨架已做：杀重复 agent 实例 / 杀僵尸启动循环 / 修自启计划任务 / 报 license 缺口，
纯函数 `planConvergence(EnvState) → ConvergenceAction[]` 是 CI 单测锚点，接线在 `index.ts` main() 第零步。

本刀新增 5 项（对应审计病灶 C10/C11/A2/B4/B5）：

1. **进程归零**（扩 EnvState + Action）：杀孤儿 RPA python 进程（命令行匹配 `listen_chat.py`/`overlay_window.py` 等
   wechat-rpa 脚本、且非本进程树后代）。agent 实例部分已有（single-instance-lock + kill_duplicate_agent），不重做。
2. **微信归一**（扩 Action）：顶层 Weixin.exe 树 > 1（父进程非 Weixin.exe 的顶层数）→ 收敛（杀全部顶层树，
   由后续任务按需经 `launch_weixin()`（#1358 已带跨进程锁+幂等）重新拉起）。判定方法沿用 #1358 真机验证过的顶层树口径。
3. **环境自检**（根治 A2 MS Store Python 弹窗）：
   - core fork 模块子进程时**始终注入 `ZENITHJOY_CORE_DIR`** 到 child env（module-manager fork 处）；
   - 自检 python-embedded 存在性（core 目录下 `python-embedded/python.exe`）；
   - 自检 `.env` 与 `config.json` 的 apiUrl/env 指向一致性（沿用 56cacd23 案例口径）。
   缺项 → checklist 报红，不阻断启动。
4. **残骸清理**：`C:\Users\Public` 下 `zj-*`/`test_*`/`send_*` 且 mtime>7 天 → 删；
   一次性 `ZJ*` 诊断计划任务（ZJDbg*/ZJDiag*/ZJClick* 等前缀，排除正式自启任务名）→ 删；
   陈旧锁文件（持有 PID 已死）→ 删。
5. **checklist 上报**：5 项各自 pass/fail/skipped + 明细，随心跳 diag 上报中台；缺项报红。
   守卫必须 proven-to-fire（故意制造缺项亲眼看它报红一次）。

## 为什么改

审计实锤 C10：agent 启动无归零步骤，带病启动病越积越多（228 残骸文件、53 僵尸计划任务、
裸 python 弹窗（A2）、4 个 Weixin.exe 同秒诞生（#1358 已治启动侧，堆积存量无人清）、多余 agent 实例）。
干净不靠自律，靠每次启动洗回零态（与 reset_stage.py 复位台同哲学，作用域=agent 自身启动路径）。

## 错误路径（混沌清单，全部 best-effort 不阻断启动——沿用现有收敛纪律）

- 杀进程失败（权限/僵死）→ 记 fail 进 checklist 上报，继续启动
- 微信收敛失败 → 记 fail 上报，不重试死循环
- 删残骸/计划任务失败（占用/权限）→ 记 fail 上报，下次启动再试（幂等）
- 心跳上报失败（网络断）→ 本地日志兜底，不丢 checklist 结果
- startup-reset 整体超时预算 ≤30s，超时跳过剩余项并报红（启动不能被复位卡死）
- **CI 并发护栏**：CI 起的 agent（GHA self-hosted job）跑归零会杀常驻 staging agent（A3 互搅反向危险）
  → CI 环境（`CI=true` 或显式 env）下 kill/delete 类动作降级为 plan-only 上报，不执行。A3 根治另立，验后再定。

## 关联上下文

- 相关 Journey：Path 2 智能获客 / Path 4 私域 AI（agent 基础设施横切，Journey=636a918c ZenithJoy 运营中枢 dev_pipeline）
- 相关决策：72740815（启动第零阶段收敛）、d12e8529（launch_weixin 锁）、56cacd23（config.json apiUrl 卡死）
- 审计病灶：C10/C11/A2/B4/B5（handoff_0717_rog_audit_startup_reset_cloak_denied）

## 不包含

- cloak E_ACCESSDENIED 路线修复（另立 sprint，候选①提权②挪坐标待拍板）
- A3 CI-vs-常驻 agent 互搅根治（本刀仅 CI plan-only 护栏缓解，验后再定）
- B6 .env.prod-backup / B7 注册表 Run 键 Chrome 弹窗（审计遗留，另立）

## 判定点登记表（decisions e035dad8）

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 孤儿 RPA python 判定 | a) 父进程死才算孤儿 b) 启动时刻命令行匹配 RPA 脚本且非本树后代即杀 | b | 用户语义"启动瞬间归零"；启动时点本 agent 尚未 spawn 任何 listener | 错杀 CI 并发 listener（由 CI plan-only 护栏兜住） |
| 顶层 Weixin 堆积判定 | 顶层树计数（父进程非 Weixin.exe） | 同左 | #1358 真机验证过该口径（wxocr 等子进程不算） | 误判堆积→无谓重启微信 |
| 陈旧锁判定 | mtime 阈值 / PID 判活 | 持有 PID 死即陈旧（复用 single-instance-lock PID\|imageName 判活） | 72740815 PID 复用免疫经验 | 误删活锁→并发启动（有 #1358 锁兜底） |
| 残骸文件判定 | 前缀匹配 + mtime>7 天 | 同左 | 7 天保护正在用的诊断文件 | 误删在用文件（7 天阈值兜底） |
| 一次性计划任务判定 | ZJ 诊断前缀白名单 + 排除正式自启任务名 | 同左 | 审计实测 53 个全是 ZJDbg*/ZJDiag* 一次性 | 误删正式自启任务（排除表兜底，proven-to-fire 验证） |

## 影响范围

- agent core（`services/agent/src/`）：bootstrap-convergence 扩展 + module-manager fork env 注入 + 心跳 diag 字段
- 不改 line04 模块行为逻辑；若触碰模块文件需同步 build-modules 镜像 + 模块版本 bump（1.0.133→1.0.134，9 处口径）
- core 版本按现行规则 bump（改 Agent 必 bump，feedback_agent_version_bump）

## 验收标准

- [ ] commit-1：failing test 先行（TDD，planConvergence 新分支全覆盖 + 变异测试红过）
- [ ] commit-2：实现绿 + 单测/集成测试
- [ ] checklist 上报守卫 proven-to-fire：故意制造缺项（如藏起 python-embedded）亲眼看心跳 diag 报红
- [ ] smoke 回流：判据进对应 golden-path smoke（真机不可及步骤用 API 层等价断言+注明）
- [ ] CI 全绿（commit 前缀用 fix:，不触发 lint-feature-has-smoke）
- [ ] PR merge 后部署 rog 真机复测：重启 agent 后 checklist 上报可见、残骸数下降、单 Weixin 顶层树
