# Sprint PRD — Line04 AI 思考浮窗 第二刀

task_id: 8f93f2a1-fdc2-4d41-b97d-6a5ff984697c
journey_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
journey_type: user_facing
target_environment: windows_cloud
thickness: thin
sprint_dir: sprints/07121132-line04-ai-thinking-overlay
date: 2026-07-12

## Journey 定位

**客户私域 AI 接管**（Path 4）—— 第一刀（PR#1239）已交付地基；本刀交付浮窗窗口本体与全链路接线。

路径声明：本 PR 把 Path 4「AI 思考浮窗」从 thin-骨架 推到 thin-可用 ✅（窗口本体 + 贴靠循环 + 真实 reasoning + 中台接线 + CI）。

---

## 地基声明（禁止重做）

以下均已在第一刀（PR#1239）交付，本刀**直接复用，禁止重写**：

- `services/agent/wechat-rpa/overlay/pii_filter.py`（PII 过滤纯函数）
- `services/agent/wechat-rpa/overlay/preflight.py`（pywebview/WebView2 软检测）
- `services/agent/wechat-rpa/overlay/watchdog.py`（熔断守活）
- `sprints/07121132-line04-ai-thinking-overlay/tests/`（全套 pytest/vitest 骨架）
- `.github/workflows/scripts/smoke/line04-ai-overlay-smoke.sh`（smoke 接入 CI）
- events.jsonl 管道钩子（listen_chat O_APPEND 写者）

---

## Invariant 约束（继承第一刀 GAN 三轮收敛，全 12 条）

1. **events.jsonl 唯一写者 = listen_chat**（O_APPEND 追加）；浮窗只读 tail，严禁浮窗写入
2. **reply_sent 挂点 = listen_chat.py:4787 DELIVERED 调用点**，禁挂 `_commit_reply_success` 本体
3. **reasoning 单一来源 = LLM 合同 JSON 字段**（≤30字客户可读，非思维链）；openrouter.ts:126-132 剥离纪律原封不动
4. **customer_stage 复用既有 tags.stage（A1-A4）**，禁另造取值域
5. **PII 双硬闸**：中台返回前截断+正则过滤；agent 写 events 前二次执行同一纯函数
6. **浮窗软检测禁止进 manifest requiredChecks**（preflight 是激活门禁，进去会拉垮主链）
7. **崩溃熔断**：60min 内 8 次存活<60s → 熔断静默，agent 重启复位；WebView2 Evergreen 更新崩溃不计入熔断
8. **用户关闭 = 退出码 0 + user_closed=true**，守活只对非零退出码重拉
9. **events.jsonl 路径在 _STATE_DIR 下，严禁 C:\Users\Public**
10. **event_id 幂等去重按整串精确匹配**；epoch_ms 仅展示排序用，禁做跨重启顺序断言
11. **浮窗只观察微信窗口，绝不干预**（listen_chat 有窗口自愈，防两进程拉扯）
12. **异常态一律温和文案+变灰**，禁"错误/中断/!"字样

---

## 累积 FR（第二刀新增 FR-1～FR-6，对应六项必交付物）

### FR-1：浮窗窗口本体

**文件**：`services/agent/wechat-rpa/overlay/overlay_window.py`

**F1.1** pywebview/WebView2 无边框置顶窗，窗口样式 WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW，Per-Monitor V2 DPI，物理像素贴靠

**F1.2** 内嵌 HTML 动态流 UI，含以下五种卡片/状态：
- 欢迎卡（first_run_done 持久化，仅首次展示）
- 默认态（永不空白）：「AI 客服守护中 · 今日已回复 N · 最近动作 xx:xx」
- 动态条目：联系人昵称 + A1-A4 阶段色点 + reasoning≤30字 + 两态（发送中→已送达）
- 折叠徽标：有新回复时徽标数字弹跳一次（无声音、无闪烁、不抢焦点）
- 降级态（heartbeat >180s）：「AI 客服休息中，稍后自动恢复」（灰色）

**F1.3** DOM 30 节点硬顶 FIFO，20 条上限，同联系人相邻动态聚合卡片

**F1.4** skipped 类动态：低饱和灰条，不进未读计数

### FR-2：贴靠 + 显隐循环

**F2.1** 500ms 单循环（合并贴靠+显隐+tail），微信不动时退避 1s

**F2.2** 复用 `find_weixin.get_main_window` 获取微信窗口矩形

**F2.3** 四行判据表（严格按序执行）：

| 微信窗口状态 | 浮窗行为 |
|------------|--------|
| 不存在 ∨ IsIconic | 隐藏 |
| 存在 ∧ ¬IsIconic ∧ ¬IsWindowVisible | 隐藏（托盘静置） |
| 存在 ∧ IsWindowVisible ∧ DWMWA_CLOAKED≠0 | 冻结（位置不更新，防发送瞬态闪烁） |
| 其余 | 显示跟随 |

**F2.4** `overlay-state.json` 持久化位置/折叠/user_closed（损坏→弃用默认值+备份，不进崩溃循环）；恢复时 rect_visible 校验越界重置

### FR-3：events tail 消费端

**F3.1** tail 轮询读 `_STATE_DIR/events.jsonl`（含 .1 跨代回放），500ms 轮询，空闲退避 2s

**F3.2** event_id 精确匹配幂等去重，坏行/半行跳过不崩

**F3.3** heartbeat >180s（3 周期）→ 渲染降级态文案「AI 客服休息中，稍后自动恢复」

**F3.4** 文件 rename 按 inode 变化重开句柄，先读 .1 再读当前，两代合并今日计数

### FR-4：中台 reasoning 真实现

**文件**：`apps/api/src/services/wechat-draft.ts`

**F4.1** LLM prompt JSON 合同扩展为 `{reply, tags, reasoning}`（reasoning≤30字，向后兼容新增字段）

**F4.2** 返回体透出 reasoning 字段（中台 HTTP 响应中包含 reasoning）

**F4.3** PII 硬闸接线：中台返回前对 reasoning 执行手机号/微信号/身份证正则过滤，命中→替换降级文案（openrouter.ts:126-132 剥离纪律不动）

**F4.4** :548 正则兜底路径 reasoning 缺省处理（降级文案「已回复 {联系人}」）

**F4.5** 把 `sprints/07121132-line04-ai-thinking-overlay/tests/wechat-draft-reasoning.test.ts` 的 mock 存根替换为真实 `generateChatDraft` 断言（不新增测试文件，覆写现有 .test.ts）

### FR-5：node 侧接线

**F5.1** line04 模块 handler spawn 浮窗进程，env 注入 `ZJ_STATE_DIR` + 模块版本（照抄 `wechat-rpa.ts:19-27` 写法）

**F5.2** spawn 前接 `preflight.py` 软检测：缺依赖→不 spawn，写 `overlay-diag.json`（覆盖写）

**F5.3** 接 `watchdog.py` 熔断：circuit_open=true 时不重拉

**F5.4** 用户关闭（退出码 0 + user_closed=true）→ 守活不重拉

**F5.5** 命名 mutex `Global\zenithjoy-line04-overlay` + `overlay.pid`（PID+版本，校验映像名再 taskkill）实现热更杀旧

### FR-6：CI 探针与兜底

**F6.1** GHA windows-latest 增加 pywebview 建窗探针 step（2s 建窗即退，超时=失败）

**F6.2** 探针过 → notepad 替身 hwnd 跑贴靠/显隐/NOACTIVATE（GetForegroundWindow 不变断言）

**F6.3** 探针败 → GUI 层降级：贴靠判据表四行逻辑 + tail 消费端 → 纯函数 pytest 兜底（不依赖 WebView2）

---

## NFR

| 指标 | 阈值 | 超限动作 |
|------|------|--------|
| 内存 RSS | 连续 2 心跳 >200MB | 只留 20 条 + 强制 GC |
| 内存 RSS | >300MB | 自杀重启 |
| CPU 60s 均值 | >5% | 轮询降频 1s + diag 上报 |
| events 落行→浮窗显示延迟 P95 | ≤1.2s | >2s 连续 3 次 → diag.render_lag |
| 崩溃熔断 | 60min 内 8 次存活<60s | 熔断静默，agent 重启复位 |
| 浮窗不获焦 | GetForegroundWindow 不变 | — |

---

## E2E 验收

### CI 层（windows_cloud，GHA windows-latest）

- [ ] **pywebview 探针**：2s 建窗即退；探针过→notepad 替身 hwnd 跑贴靠/NOACTIVATE 断言；探针败→判据表纯函数 pytest 兜底
- [ ] **贴靠循环 pytest**：四行判据表单元覆盖（各行各一 case）；500ms 循环不阻塞；CLOAKED 态冻结不更新位置
- [ ] **tail 消费端 pytest**：heartbeat >180s 降级文案；inode 变化重开句柄；两代合并计数
- [ ] **中台 vitest**：`generateChatDraft` 真实调用断言（正常/兜底缺省/PII 命中降级）—— 替换 mock 存根
- [ ] **overlay_window.py 纯函数 pytest**：欢迎卡 first_run_done 幂等；DOM 30 节点 FIFO；同联系人聚合；发送中→已送达原地翻转；skipped 灰条不进计数
- [ ] **smoke**：`line04-ai-overlay-smoke.sh` 补充第二刀验收项，CI 全绿
- [ ] **grep 回归**：listen_chat `content[:20]` 清零断言仍通过

### 真机层（xian-rog，手动验收）

- [ ] 真发一条消息 → events.jsonl 新增 reply_sent（含 reasoning，无 PII）→ 浮窗截图含该动态条目 → 今日计数 +1
- [ ] 微信托盘化发送瞬态：浮窗冻结不闪烁；记事本置前触发回复 → GetForegroundWindow 不变
- [ ] 关闭浮窗 → 不被拉回；托盘菜单「显示 AI 浮窗」重开成功
- [ ] WebView2 preflight 双查真机通过，overlay-diag.json 12 字段完整

---

## 不包含（范围外）

- 当前会话跟随（点开哪个客户浮窗切哪个）——第三刀
- 完整客户画像卡片——第三刀
- 中台浮窗监控看板页——另立 sprint
- listen_chat 守活退避阶梯补充——超范围

---

journey_type: user_facing
target_environment: windows_cloud
