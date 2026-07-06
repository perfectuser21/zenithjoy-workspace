# Bug PrepPRD：CI 真机闸失效 + 两个坏 YAML workflow（每 push 秒红）

## 症状
1. `WeChat CS Hardening — E2E` job3（rog 真机气泡闸）自 2026-07-04 19:08 后 40+ 次全红，且非 required check → 所有 PR（含 #1105/#1107）顶红合并，真机闸形同虚设。
2. job3 失败原因恒为 `no wechat window (mmui)`，但同时段 rog 微信实际登录正常（listener 日志 login=True sessions=15）。
3. `agent-preflight-hardening-e2e.yml` 与 `cleanup-merged-artifacts.yml` 两个 workflow 每次 push 秒红（21/21），run 无 job、run name=文件路径。

## 根因（已实证）
1. **job3 假红**：`services/agent/tools/selfcheck_bubbles.py` 用 `Desktop(uia).windows()` 枚举可见窗口找 mmui，不处理「微信藏托盘/UIA 暂不可达」态（rog 无人值守常态）。0706 08:54 CI 失败同刻 listener 也报「UIA 找不到主窗口」，09:45 自愈；10 点 asus/SYSTEM 探针都能找到窗口 → 时点性假红。
2. **闸不 required**：branch protection 只有 5 个 gate（L2/L3/L4×2/Integration），wechat 真机闸从未加入；且 workflow 带 pull_request paths 过滤，直接加 required 会让不相关 PR 卡 "expected"。
3. **坏 YAML**：两文件中文段落被写成乱码字节破坏 YAML 结构（yaml.safe_load 分别报 line 176/51），GitHub 无法解析 → 每 push 生成一个无 job 的 failure run。cleanup 的 run 块内多行 commit message 顶格行也破坏 block scalar。

## 修法
1. `selfcheck_bubbles.py`：找窗口改为状态机——微信进程不在→真红「微信没跑」；进程在+窗口隐藏→托盘唤出（复用 listen_chat `_ensure_tray_visible` 同款逻辑）+有界重试；UIA 未就绪→设 SPI 标志+重试；重试尽仍找不到→真红「UIA 找不到主窗口」（此时值得报警，不掩盖真问题）。纯函数部分（状态分类→动作）TDD。
2. `wechat-cs-e2e.yml`：去掉 pull_request paths 过滤 → 加 changes 检测 job（ubuntu）；job2/job3 仅在 wechat 相关路径变更时跑；新增聚合 job `WeChat CS Gate Passed`（ubuntu, needs+if:always()，skipped/success=绿，failure=红）；把该 context PATCH 进 main branch protection required contexts（403 则给用户手动步骤）。
3. 修两个坏 YAML 的乱码段（恢复中文原意；cleanup 的 commit message 改单行），本地 yaml.safe_load 全过。
4. L1 Process Gate 加机械闸：`.github/workflows/*.yml` 全部必须可 YAML 解析（python yaml.safe_load），纳入 L1 聚合 needs。

## Regression Test 计划
- pytest：窗口状态分类纯函数（先写 failing test 定义"隐藏态→唤出重试、进程不在→FAIL_NO_PROCESS"等行为）。
- L1 YAML lint 即 ③ 的 regression guard：**proven-to-fire = 修文件之前先跑 lint 亲眼看它对两个坏文件报红**，然后修复变绿。
- ① 的环境守卫 = job3 本身（已见过 40 次红）；修复后在 rog 上人为把微信窗口藏托盘再跑 gate，看到 PASS = 唤出逻辑 proven；再断言微信进程杀掉时 gate 仍红（不掩盖真问题）。

## 关联上下文
- Brain Task：1a45c0e9-b6b8-4fa0-b9cc-f6d925bb3133；Issue：f194490f（CI 闸失效）
- Journey：Line04 客户私域 AI 接管（bfeed805）
- 相关 memory：wechat_selfcheck_proven_to_fire_method（PsExec session1 方法）

## 验收标准
- [ ] failing test 先 commit（commit-1），修复代码 commit-2
- [ ] 本地 yaml.safe_load 59 个 workflow 全过；push 后两个原坏 workflow 出正常 job 级 run
- [ ] rog 上藏窗口→gate PASS；杀微信进程→gate 红（两个方向都亲眼见）
- [ ] `WeChat CS Gate Passed` 进 required contexts（或给出用户手动配置步骤）
- [ ] 不相关路径 PR 的 gate 秒绿不占 rog
- [ ] CI 全绿
