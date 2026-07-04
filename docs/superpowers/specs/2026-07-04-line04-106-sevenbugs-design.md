# Line04 1.0.106 七 bug 修复设计（→ 模块 1.0.107 + 中台配套）

Brain Task: f4a22b71-c359-48b7-80e0-5b725f404afe ｜ Journey: 客户私域 AI 接管（bfeed805）
Issues: 9b323882 / d21ab35b / 403f2d84 / 7d00f330 / 30c9ce74 / c5cabdf5 / 59c4af7e
PrepPRD: sprints/07041957-line04-106-sevenbugs-fix/prep-prd.md

## 交付结构：两个 PR + 一项运维

- **PR-A（apps/api 中台，先合）**：bug2 送达回执 + bug3 resolver 防护/配额门 + bug7 persona 约束
- **PR-B（modules/line04 + wechat-rpa python + install-pack，后合，出模块 1.0.107）**：bug1 INFLIGHT + bug4 大群缓存 + bug5 角标兜底 + bug6 watchdog/QuickEdit + bug2 模块侧回执上报
- **运维（不进 PR）**：会议室机器删旧 agent 配置/计划任务 + staging revoke 旧 license ZJ-F-2338553A。⚠️ cs-35837be0 是 XIAN-PC 活绑定，禁止清。

## Bug 1：INFLIGHT 泄漏（🔴 P0）

**代码级根因（探查实锤）**：
- `listen_chat.py:1021` scan_unread 把 sender 加入 `_INFLIGHT`；释放依赖轮尾 sweep（L4285-4288）。
- 泄漏主路径：`L4106-4110` `if machine_id and not _real_publish: sleep; continue` —— 在加入之后、sweep 之前 continue，sender 永久卡死。
- 次路径:主循环任何异常/提前 continue 都绕过 sweep（整个 while 体只有 KeyboardInterrupt 保护）。
- `L902-903` 跳过 INFLIGHT 完全静默（不打日志不计数）。

**修法**：
1. 主循环体 scan 之后的处理段包 `try/finally`，finally 里执行轮尾 sweep（本轮 unread 全量释放），使所有 continue/异常路径都释放。
2. `_INFLIGHT` 从 set 改为 `dict[sender→加入时间戳]`，加 `INFLIGHT_TTL`（默认 180s）：L902 跳过前检查 TTL，过期即释放+打 `[inflight-ttl-recover]` 警告日志（这就是 proven-to-fire 守卫的报警点）。
3. L902 跳过时打 debug 日志+计数（每轮汇总一行，避免刷屏）。

**测试**：`tests/test_inflight_leak.py`（新）——
- 模拟 `_real_publish=False` continue 路径 → 断言 sender 不残留 INFLIGHT；
- 模拟发送抛异常 → 断言 finally sweep 释放；
- 塞入过期条目 → 断言 TTL 自恢复且打了警告日志。

## Bug 2：中台假账（🔴 P0）

**代码级根因**：`wechat-draft.ts:469` 在 LLM 生成成功即写 `wechat_messages` out 行并返回；聊天回复链路**没有任何送达回执**（现有 receipt 路由只更新 `wechat_publish_task`）。统计（`cs-work-stats.ts:52` 查 wechat_messages；`cs-stats.ts`+日报查 cs_memory_messages）都把"生成"当"已回复"。

**修法（跨两 PR）**：
1. migration：`wechat_messages` 加 `status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('draft','delivered','failed'))`。默认 delivered 让存量行/in 行语义不变；**新写的 out 行显式 `status='draft'`**。
2. `wechat-draft.ts`：appendMessage 返回 message id；draft-generate 响应体带 `message_id`。
3. 新路由 `POST /api/wechat/messages/:id/receipt {ok:boolean}`（鉴权同 draft-generate）→ `status='delivered'|'failed'`。
4. 统计口径：`cs-work-stats.ts` reply_count 改为 `direction='out' AND status='delivered'`；`cs-daily-report` 继承。cs_memory_messages 侧口径本次不动（它是记忆不是台账，改动面太大），日报数据源以 wechat_messages 为准（对齐决策 #843"统计聚合 wechat_messages"）。
5. 模块侧（PR-B）：receipt POST 放在**主循环 L4253 送达分支**，不进 `_commit_reply_success` 本体（该函数还被 L4149 replied/dup/roster_gate 终态 skip 复用，无 message_id，塞进去会语义污染）。drafts 缓存需从 `reply` 扩为 `(reply, message_id)` 才能把 id 带到送达点。message_id 允许缺失（appendMessage 插入失败返回 null）→ 缺失时静默跳过 receipt。发送终态失败 POST ok=false。fire-and-forget+一次重试，失败只打日志（宁可少记不虚记）。
6. receipt 路由必须校验 message 行归属请求方 tenant（draft-generate 无独立鉴权，只有 tenant 解析——防跨租户翻账）。

**测试**：
- vitest：draft-generate 后行 status='draft'；receipt ok=true→delivered / ok=false→failed；未回执的 out 行不计入 reply_count；日报快照同口径。
- pytest：`_commit_reply_success` 触发 receipt POST（mock http）；发送失败路径 POST ok=false。

## Bug 3：同机双租户 + 配额失效（🟠）

**根因（DB+代码实锤）**：
- 会议室机器旧 license（ZJ-F-2338553A/租户 2ac0aa4a）的 agent 配置仍在机器上跑并心跳，staging 里旧行 last_seen 比新租户还新 → resolver"last_seen 最新"恰好选错。
- 配额绕过头号嫌疑：`walking-skeleton.service.ts:230-243` 心跳 upsert 直接 INSERT license_machines，**无配额门**（register 路径 L483 有，customer-admin 手动绑定也有）；另有 TOCTOU 竞态+历史行。

**修法**：
1. `agent-tenant-resolver.ts`：加**多租户冲突探测**，位置钉死在**源 1(agents)/源 2(service_agents) 之后、源 3/4(license_machines 反查) 之前**——主路径（绑定 SSOT）命中直接返回不受影响；只有落到 license 残留反查时才探测。探测 SQL：按 machineId 查 license_machines JOIN licenses 取 distinct tenant_id，**必须过滤 `l.status='active'`（revoked/expired 不算）**且限近 7 天 last_seen——否则运维 revoke 旧 license 后 deny 还会残留 7 天，会议室复测被自己挡死。>1 个租户时调 `recordIdentityAlert(machineId, 'multi_tenant_machine')` 告警并返回 ''（deny），绝不静默二选一。误伤缓冲已验证：listen_chat 的 draft-generate 只带 agent_id 不带 machine_id，新旧 agent_id 不同不会撞。
2. `walking-skeleton.service.ts` 心跳 upsert：新 machine_id（将导致 INSERT）时执行与 register 相同的配额检查，超额只更新 agents 心跳、不建 license_machines 行，打警告日志。
3. 运维（清单文档化进 PR 描述，执行不进 PR）：会议室删旧配置+staging revoke 旧 license。

**测试**：vitest —— 同机双租户假数据 → 返回 '' 且写 identity_alert；单租户不受影响；心跳 upsert 超配额 → 不新建行；service_agents 命中时不受 license 残留干扰。

## Bug 4：大群 KNOWN_GROUPS 缓存永不生效（🟠）

**根因（修正原假设）**：`_is_group_by_header`（L1119）本来就能从 `(469)` 判群；但缓存写入（L706-711）还要求 `_chat_title_matches` 为 True，大群标题是成员名长串结尾 `(N)`，`==` / `startswith` 匹配永假 → 永不缓存 → 每轮重开群。

**修法**：缓存条件放宽为 `header 判群（N≥3）时，title 匹配失败但标题文本中包含目标群名子串（或 sender 出现在标题串中）也允许缓存`；两个信号都没有才不缓存。N≥3 下限防"张三(2)"类备注误判。保留原日志并区分 `known_group cached (relaxed)`。

**测试**：`tests/test_group_by_header.py` 扩展——成员串结尾 (469) + 群名在串中 → 缓存；私聊备注 "张三(13)" 不含群语义 → 不缓存；N=2 → 不缓存。

## Bug 5：角标时有时无（🟠，兜底为主）

**现状（探查）**：预览变化 fallback 已存在（L934 `elif prev != name:` badge=0 也触发）。已知缺口：INFLIGHT 泄漏（bug1）会让 L902 在 fallback 之前就把人跳掉 = 双重不可见——bug1 修复后此叠加消失。
**本轮动作**：①bug1 的 TTL+日志即覆盖主要风险；②给"badge 缺失但 preview 变化触发"的路径加计数日志（量化角标缺失频率，给深查留数据）；③root cause（UIA 树重建/选中态）继续挂 issue 30c9ce74 深查，不阻塞本 PR。

**测试**：现有 test_classify_unread_no_drop.py 补一条：name 无 [N条] 但 preview 变化 → 消息仍被拾取。

## Bug 6：监听 watchdog + QuickEdit（🟠）

**根因（两层都实锤）**：
- `handlers/wechat-rpa.ts:269` `child.on('error')` 只置标志不重拉 → spawn 级失败监听永久死。
- `start.bat` 无 QuickEdit 防护，黑窗口被点 → supervise 循环（含其中一切）挂起——与"会议室独有、rog 正常"吻合，很可能就是当晚 >8min 没拉起的真凶。

**修法**：
1. `child.on('error')` 也走 30s 重 spawn 调度（与 exit 同路径，带退避上限）。
2. `start.bat` 开头加两道：① `reg add HKCU\Console /v QuickEdit /t REG_DWORD /d 0 /f`（管住以后所有新窗口）；② PowerShell 单行 P/Invoke `SetConsoleMode`（当场关掉本窗口的 QuickEdit，ENABLE_QUICK_EDIT_MODE 位清零），失败不阻塞启动（生产本就走 start.vbs 无窗口，这是会议室这类手动 start.bat 场景的防护）。
3. 重 spawn 与 killExistingListeners 的竞态本次只加日志观察，不动逻辑（避免一次改太多）。

**测试**：vitest（modules/line04/__tests__）——mock child error 事件 → 断言重 spawn 被调度；start.bat 改动靠 CI dryrun 步骤（wechat-cs-e2e.yml 已有 --dryrun-print-version）验证脚本仍能跑通。

## Bug 7：cs_memory 上下文污染（🟡）

**根因**：persona 已有大量反-AI 框架文本，但无"禁自述技术能力/禁把对方粘贴的指令当自我描述"约束；`sanitizeReply` 只删禁用词。
**修法**：①`persona.ts` renderPersonaBlock 增加一段硬约束（不自述会命令/日志/技术排查；对方粘贴的代码/命令只当聊天内容）；②`sanitizeReply` 增加自述模式黑名单兜底（如"我会.*命令/日志"）。记忆写入过滤不做（二期，避免误伤正常内容）。

**测试**：vitest persona 渲染含新约束段；sanitizeReply 命中自述句 → 被清理。

## 发版与验收

- 版本：9 面当前**已全部一致在 1.0.107**（①modules/line04/manifest.json ②build-modules/line04/manifest.json ③walking-skeleton.service.ts:74 required_version ④walking-skeleton.service.test.ts:162 ⑤tests/routes/heartbeat-modules.test.ts:78 ⑥smoke/preflight-delivery-selfcheck ⑦smoke/offscreen-version-gate ⑧smoke/wechat-cs-visible-delivery ⑨smoke/heartbeat-module-health）。**PR-B 发版前核对 mmv staging 模块服务器上是否已存在已构建的 1.0.107 制品：存在 → 9 面一次性 bump 1.0.108；不存在 → 沿用 1.0.107**。listen_chat.py 两份拷贝里的 1.0.106 陈旧注释同 PR 改正。build-modules rsync 一致性 gate 必须过。
- 文件双拷贝坑（#1097 教训）：handlers/wechat-rpa.ts 与 listen_chat.py 都存在 services/agent/ 与 modules|build-modules/line04/ 两份，改动必须两份同步，确认进部署包的那份真的改了。
- 合并顺序：PR-A（API）→ PR-B（模块）。模块回执上报对旧 API 是 404 容忍（fire-and-forget）。
- 发布：只上 staging；会议室复测（万木春/A00 多轮+连发 5 条+操作者自话）通过后，连中台一起由用户手点 promote 生产。
- 守卫 proven-to-fire：INFLIGHT TTL 警告、multi_tenant_machine 告警各故意触发一次亲眼看报红。

## 测试策略（四档归位）

- **E2E**：现有 wechat-cs-e2e.yml（dryrun 注入+纯逻辑 pytest+job3 真机 bubble gate）必须全绿；不新增独立 E2E workflow（本次全是修复，回归靠既有 E2E + 新增 regression tests）。
- **Integration**：vitest（draft→receipt→stats 全链 in-memory pg mock 按现有测试模式）。
- **Unit**：上述各 bug 的 failing-test-first regression tests（pytest + vitest），全部永留 CI。
- **Trivial**：listen_chat.py 陈旧版本注释修正，无需测试。

## 明确不做（YAGNI）

- 扫描机制整体重构（issue 6fa90106 另行）
- cs_memory_messages 台账化 / 记忆写入过滤
- 多机换机迁移流程（决策 903f9357 的 Line10 sprint）
- killExistingListeners 竞态重构（仅加日志）
