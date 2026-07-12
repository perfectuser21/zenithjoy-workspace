# Sprint PRD — Line04 AI 思考浮窗（贴靠微信·回复动态流+推理展示）第一刀

task_id: a1bf1ba5-bf7c-4a87-842d-0dbe004698fb
journey_id: bfeed805-deed-46c3-8624-87f0028101d4
journey_notion_id: 35ac40c2-ba63-81af-af97-e3bc8e3b0fb4
journey_type: user_facing
target_environment: windows_cloud
thickness: thin
sprint_dir: sprints/07121132-line04-ai-thinking-overlay
date: 2026-07-12
review_required: true

## Journey 定位

**客户私域 AI 接管**（bfeed805）—— 客户授权后 AI 接管个人微信，自动处理私聊/朋友圈，飞书 Bitable 审核后真发。

本 Sprint 推进：**新增 Ability「AI 思考浮窗」thin**，在客户 Windows 桌面贴靠微信窗口展示 AI 客服工作动态流，让客户直观感知 AI 在干活。

路径声明：本 PR 把 Path 4 新增 AI 思考浮窗 Ability 从 ⬜ 推到 thin ✅。

---

## Invariant 约束

以下约束来自 GAN 三轮收敛决策（decisions e035dad8），Planner/Proposer 不得推翻：

1. **events.jsonl 唯一写者 = listen_chat**（O_APPEND 追加）；浮窗只读 tail，严禁浮窗写入
2. **reply_sent 挂点 = listen_chat.py:4787 DELIVERED 调用点**，禁挂 `_commit_reply_success` 本体（该函数被 skip 终态复用，:4789 注释实证）
3. **reasoning 单一来源 = LLM 合同 JSON 字段**（≤30字客户可读文案，非思维链）；openrouter.ts:126-132 reasoning_content 剥离纪律原封不动
4. **customer_stage 复用既有 tags.stage（A1-A4）**，禁另造取值域
5. **PII 双硬闸**：中台返回前截断+正则过滤；agent 写 events 前二次执行同一纯函数（auto_reply.py 层）
6. **浮窗软检测禁止进 manifest requiredChecks**（preflight 是激活门禁，进去会拉垮主链）
7. **崩溃熔断**：60min 内 8 次存活<60s → 熔断静默，agent 重启复位；WebView2 Evergreen 更新崩溃不计入熔断
8. **用户关闭 = 退出码 0 + user_closed=true**，守活只对非零退出码重拉
9. **events.jsonl 路径在 _STATE_DIR 下，严禁 C:\Users\Public**
10. **event_id 幂等去重按整串精确匹配**；epoch_ms 仅展示排序用，禁做跨重启顺序断言
11. **浮窗只观察微信窗口，绝不干预**（listen_chat 有窗口自愈，防两进程拉扯）
12. **异常态一律温和文案+变灰**，禁"错误/中断/!"字样（营销面产品，不制造焦虑）

---

## 累积 FR

### FR-1：事件管道（events.jsonl）

**F1.1 写者**：listen_chat（唯一写者）O_APPEND 追加写 `_STATE_DIR/events.jsonl`

**F1.2 事件类型**：
- `reply_sent`：挂 listen_chat.py:4787 DELIVERED 调用点
- `reply_skipped(reason=dup|replied|roster_gate)`：与 _skip_logged 同点同去重；rate_limited/sender_cooldown 高频瞬态不写事件
- `heartbeat`：60s 周期
- `agent_online`：进程启动时写

**F1.3 行 schema**：
```json
{"v":1,"event_id":"{epoch_ms}-{run_id 6位随机hex}-{seq进程内递增}","date":"YYYY-MM-DD","type":"reply_sent","contact":"...","stage":"A1","reasoning":"≤30字客户可读","ts":1234567890}
```

**F1.4 读者**：浮窗 tail 轮询（500ms，空闲退避 2s），坏行/半行跳过不崩

**F1.5 文件轮转**：5MB 改名 .1 留一代；今日计数回放跨两代（先 .1 后当前）；浮窗读到 rename 按 inode 变化重开句柄，event_id 幂等重放

### FR-2：中台合同扩展（apps/api/src/services/wechat-draft.ts）

**F2.1** LLM 合同 JSON 扩展为 `{reply, tags, reasoning≤30字}`（向后兼容，新增字段）

**F2.2** :548 正则兜底路径 reasoning 缺省 → agent 渲染降级文案「已回复 {联系人}」

**F2.3 PII 中台侧过滤**：手机号/微信号/身份证命中 → 整句替换为降级文案，截断后正则过滤，返回前执行

### FR-3：PII 双硬闸（auto_reply.py 纯函数层）

**F3.1** agent 写 events 前二次执行与中台同一 PII 过滤纯函数

**F3.2** 单测须含"LLM 复述客户原话"用例（验证中台 reasoning 字段含原始消息文本时被过滤）

### FR-4：浮窗进程（services/line04/overlay/）

**F4.1 进程模型**：独立 Python 进程，pywebview + WebView2，line04 模块 node 侧 spawn（env 注入 ZJ_STATE_DIR + 模块版本，照抄 wechat-rpa.ts:19-27）

**F4.2 软检测**：spawn 前查 pywebview import + WebView2 注册表（HKLM+HKCU EdgeUpdate Clients pv 任一非空）；缺失 → 不 spawn，写 `_STATE_DIR/overlay-diag.json`（覆盖写，独立于 events.jsonl）

**F4.3 守活**：固定 30s 重拉 + 60min 内 8 次存活<60s → 熔断；WebView2 Evergreen 更新/渲染崩 → 独立错误码静默重建，不计入熔断

**F4.4 热更杀旧**：命名 mutex `Global\zenithjoy-line04-overlay` + overlay.pid（PID+版本，校验映像名再 taskkill）

**F4.5 用户关闭**：退出码 0 + overlay-state.json user_closed=true → 守活不重拉；托盘菜单「显示 AI 浮窗」重开

**F4.6 pywebview 安装**：走 install pack WHEEL_PKGS 通道（build-install-pack.sh:168 增补），不走模块 OTA

### FR-5：窗口行为

**F5.1 窗口样式**：WS_EX_NOACTIVATE + WS_EX_TOOLWINDOW，无键鼠钩子，Per-Monitor V2 DPI，物理像素贴靠

**F5.2 显隐判据表**（500ms 单循环合并贴靠+显隐+tail；微信不动时退避 1s）：

| 微信窗口状态 | 浮窗行为 |
|------------|--------|
| 不存在 ∨ IsIconic | 隐藏 |
| 存在 ∧ ¬IsIconic ∧ ¬IsWindowVisible | 隐藏（托盘静置） |
| 存在 ∧ IsWindowVisible ∧ DWMWA_CLOAKED≠0 | 冻结（显示但不更新位置，发送瞬态防闪烁） |
| 其余 | 显示跟随 |

**F5.3 位置持久化**：overlay-state.json（损坏→弃用默认值+备份，不进崩溃循环）；恢复时 rect_visible 校验越界重置；OFFSCREEN_REPLY 模式（共读 config.py）→ 改屏幕右下角独立悬浮

### FR-6：UI 动态流

**F6.1 动态流上限**：20 条（DOM 30 节点硬顶 FIFO）；同联系人相邻动态聚合卡片

**F6.2 两态**：发送中（灰）→ 已送达（绿，原地翻转不新增条目）

**F6.3 skipped 类**：低饱和灰条，不进未读计数

**F6.4 欢迎卡**：一次性（first_run_done 持久化）；内容「AI 客服已就位，正在守护你的微信会话」

**F6.5 默认态**（永不空白）：「AI 客服守护中 · 今日已回复 N · 最近动作 xx:xx」

**F6.6 降级态**（heartbeat >180s）：「AI 客服休息中，稍后自动恢复」（灰色，无"错误/中断/!"）

**F6.7 条目展示**：联系人昵称 + 阶段色点(A1-A4) + 一句话推理(≤30字) + 相对时间；点开展开回复原文

**F6.8 折叠态**：有新回复 → 徽标数字弹跳一次（无声音、无闪烁、不抢焦点）

### FR-7：顺带收敛 listen_chat 明文日志

**F7.1** listen_chat.py 4687/4691/4696 三处 `content[:20]` 明文日志改调统一脱敏函数（与 PII 闸同一纯函数）

**F7.2** 加 grep 型回归测试：`content[:20]` 字样在 listen_chat.py 中清零断言

### FR-8：diag 上报

**F8.1** overlay-diag.json 字段：agent_id, ts, overlay_pid, rss_mb, cpu_pct, attach_state, wechat_hwnd_found, render_lag_ms_p95, events_tail_offset, restart_count_60min, circuit_open, last_error

**F8.2** line04 自检循环随心跳上报中台（覆盖写 overlay-diag.json）

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

## 验收标准（E2E）

### CI 层（windows_cloud，GHA windows-latest）

- [ ] **smoke**：`line04-ai-overlay-smoke.sh` 进 `.github/workflows/scripts/smoke/` 并接入 CI
- [ ] **pywebview 探针**：2s 建窗即退；探针过 → notepad 替身 hwnd 跑贴靠/显隐/NOACTIVATE（GetForegroundWindow 不变断言）；探针败 → GUI 层降级纯函数 pytest
- [ ] **pytest events**：坏行容错 / 双线程并发写读 1 万行无丢无重 / 跨午夜计数 / 跨两代回放 / event_id 幂等 / reasoning PII 过滤器（含"复述客户原话"用例）/ 降级文案
- [ ] **中台 vitest**：draft-generate 返回体 {reply,tags,reasoning} 三路断言（正常/兜底缺省/PII 命中降级）
- [ ] **grep 回归**：listen_chat 明文 `content[:20]` 日志字样清零
- [ ] CI 全绿

### 真机层（xian-rog）

- [ ] 真发一条消息 → events.jsonl 新增 reply_sent 行（含 reasoning，无客户原文）→ 浮窗截图含该动态 → 今日计数 +1
- [ ] 微信托盘化发送瞬态：浮窗冻结不闪烁；记事本置前触发回复 → GetForegroundWindow 不变
- [ ] 关闭浮窗 → 不被拉回；托盘菜单重开成功
- [ ] WebView2 preflight 双查真机通过

---

## 不包含（本次范围外）

- 当前会话跟随（点开哪个客户浮窗切哪个）——第二刀
- 完整客户画像卡片——第二刀
- 中台浮窗监控看板页——另立 sprint（本次只落 diag 数据上报）
- listen_chat 守活退避阶梯补充（超范围，浮窗自带熔断即可）

---

## 判定点登记（decisions e035dad8）

| 判定点 | 所选方法 | 依据 |
|--------|----------|------|
| 微信窗口显隐 | 四行判据表（存在/IsIconic/IsWindowVisible/CLOAKED，CLOAKED=冻结非隐藏） | listen_chat.py:500-510 托盘态 cloak 不 IsIconic 实证 |
| WebView2 存在 | 注册表 HKLM+HKCU EdgeUpdate Clients pv 任一非空 | per-user runtime 是应用带装常见形态 |
| listen_chat 存活 | 最新 heartbeat 距今 >180s（3 周期）判离线 | 进程死了写不出 offline 事件 |
| 真送达挂点 | listen_chat.py:4787 DELIVERED 点 | _commit_reply_success 被 skip 终态复用会误记（:4789 注释实证） |
| 崩溃循环防护 | 60min 内 8 次存活<60s → 熔断，agent 重启复位 | listener 固定 30s 无限重启缺陷不复制 |
