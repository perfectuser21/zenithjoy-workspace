# Bug PrepPRD：Line04 1.0.106 会议室 staging 重测 7 bug 修复（→1.0.107）

Brain Task: f4a22b71-c359-48b7-80e0-5b725f404afe（journey=客户私域 AI 接管 bfeed805）

## 症状 / 根因 / 修法（7 条，按严重排序）

### 🔴 1. INFLIGHT 泄漏（issue 9b323882）
- 症状：发送链路中途失败后 `_INFLIGHT` 不释放 → 该联系人被 scan 永久静默跳过（skip 不打日志不计数），重启监听即愈。复现 2 次。
- 修法：`listen_chat.py` emit→send 全路径 finally 释放 + TTL 超时自恢复；skip 时打日志计数。
- Test：模拟发送中途抛异常 → 断言 _INFLIGHT 被释放 / TTL 后自恢复。

### 🔴 2. 中台假账（issue d21ab35b）
- 症状：generateChatDraft/auto-send 时就写 wechat_messages out 行；UIA 实际未送达也显示"已回复"。
- 修法：**加 status 列 draft→delivered**（DELIVERED 回执时置位）。禁止改成"回执时才写行"——日报/统计聚合此表，且监听死时回执不来会反向假账。统计/日报口径同步只算 delivered。
- Test：与 bug1 共用失败场景——发送失败路径断言 out 行 status 停在 draft、统计不计入。

### 🟠 3. 同机双租户（issue 403f2d84）
- 真机制（0705 复查实锤）：会议室机器上**旧 license 的 agent 配置还在跑**（agent-env-mr68dvv2，租户 2ac0aa4a，staging last_seen 比新租户 59532559 更新）。"resolver 按 last_seen 最新优先"已是现状且恰好选错。
- 修法：①运维（不进 PR）：会议室机器侧删旧 agent 配置/计划任务 + staging revoke 旧 license ZJ-F-2338553A；⚠️ cs-35837be0 是 XIAN-PC 的活绑定，禁止清。②代码：resolver 加防护——同 machine_id 命中多租户时告警(wechat_cs_identity_alert)+拒绝而非静默选一个；顺修 max_machines 配额未生效（max=1 绑了 3 台）。
- Test：resolver 注入同机双租户假数据 → 断言告警+deny，不静默二选一。

### 🟠 4. 大群 KNOWN_GROUPS 缓存永不生效（issue 7d00f330）
- 症状：'DJI益田交流1️⃣群'(469人) 标题读出 `['(469)']` → 群名匹配永假 → 不缓存 → 每轮反复开群（闪屏+烧预算）。
- 修法：`_is_group_by_header`/`_chat_title_matches` 标题含 `(N)` 数字模式即判群并缓存；护栏：N 下限（如 ≥10）或叠加其他群信号，防备注含"(数字)"的私聊误判。
- Test：'(469)' → 判群缓存；'张三(13)' 单独出现 → 不误判。

### 🟠 5. 角标时有时无（issue 30c9ce74）
- 症状：普通联系人 ListItem name 有时缺 `[N条]`（探针实锤），重启后恢复；服务号/公众号正常。
- 本轮：把预览变化检测兜底做扎实（含与 bug1 的 skip 交互——INFLIGHT 卡死+无角标=双重不可见）；深查树重建/选中态时机，查到就修，查不到留 issue 开着。

### 🟠 6. 监听 watchdog 没拉起（issue c5cabdf5）
- 先排除混淆：QuickEdit 冻结（黑窗口被点→supervise 整体挂起）是会议室实锤，rog 正常与此吻合。
- 修法：①start.bat 启动时关自身 QuickEdit（顺手把次优先清单这条做了）；②复查 watchdog 在 module fork 下的生效条件，有 bug 修之。
- Test：watchdog 逻辑单测（监听进程死→N 秒内重拉）。

### 🟡 7. cs_memory 上下文污染（issue 59c4af7e）
- 修法：persona 强约束先行（系统 prompt 禁自述技术能力）；记忆写入过滤视效果二期。
- Test：注入含命令文本的客户消息 → 断言 AI 回复不自述技术身份。

## 关联上下文
- Journey：客户私域 AI 接管（Line04）
- 相关 Issue：上列 7 条 + 6fa90106（扫描机制脆，本次角标兜底与其相关）
- 相关决策：903f9357（账号双层模型——bug3 的 max_machines 修复与之对齐）

## 范围切分
- PR-1（python 模块 wechat-rpa，出 1.0.107）：bug 1/4/5兜底/6②
- PR-2（apps/api 中台）：bug 2（status 列+统计口径）/ bug 3② resolver 防护+配额生效
- PR-3（agent/start.bat）：bug 6① QuickEdit（如属 agent repo 则并入对应 repo PR）
- 运维（不进 PR）：bug 3① 会议室清旧配置+revoke 旧 license
- bug 7：persona 配置改动，并入 PR-2

## 验收标准
- [ ] 每个 bug failing test 先 commit（commit-1）→ 修复变绿（commit-2），regression test 永留 CI
- [ ] 守卫 proven-to-fire：INFLIGHT TTL 告警/双租户告警至少各亲眼报红一次
- [ ] 模块 9 面版本同步到 1.0.107 + build-modules rsync 一致性 gate 过
- [ ] CI 全绿；1.0.107 只上 staging；会议室复测（万木春/A00 多轮+连发5条+操作者自话）过后连中台一起 promote 生产（用户手点）
