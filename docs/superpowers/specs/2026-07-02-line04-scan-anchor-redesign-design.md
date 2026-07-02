# Line04 扫描机制重构：锚点气泡扫描（根治客服漏消息）

- 日期：2026-07-02
- 分支：cp-07021502-line04-scan-anchor
- 关联：Issue 6fa90106（Brain）/ Task 34513d34 / PrepPRD `sprints/07021459-line04-scan-anchor-redesign/prep-prd.md`
- Journey：客户私域 AI 接管（Line04，bfeed805-deed-46c3-8624-87f0028101d4）

## 1. 问题与根因

客户连发 5 条消息只被回 1~3 条，漏读消息服务端零记录。根因是发现机制本身脆：

1. path-1 靠 `[N条]` 未读角标（`scan_unread`，listen_chat.py:465）。打开会话（回上一条）= 全部标已读、角标清零，同时段涌入的消息永不产生角标。
2. path-2 只读会话预览 = 最新一条，中间消息读不到；回复成功后 `last_content.pop(sender)`（listen_chat.py:3357，防自回复风暴）使下一条真消息落进"首次见到只记录"分支被吞。preview 分不清 incoming/outgoing 是死结。

结论（4 刀补丁后确认）：机制级缺陷，重构而非再打补丁。

## 2. 新机制总览

**判据换轴：从"角标/预览说有没有新消息"改为"聊天面板真实气泡里、最后一条 outgoing 之后有没有 trailing incoming"。**

```
发现层（每轮，便宜，不开会话）
  触发 = 有角标 OR item name != last_preview[sender]
    ↓ 对触发会话（角标优先，每轮开窗 cap=3）
读取层：_open_chat → 标题复核 → read_chat_bubbles() → [{text, direction}] 按 r.top 排序
    ↓ 剔除系统气泡（时间戳/撤回/拍一拍/分隔线）
锚点层：最后一条 outgoing 气泡 = 锚点；取其后全部 trailing incoming
    ↓ 合并成一条上下文
回复层：AI 草稿 → reply_in_chat（自己重开会话+复核）→ _confirm_delivery
    ↓ 仅 DELIVERED 后
事务提交：replied 标记 + last_preview 同步 + 锚点天然推进（我方气泡成最后 outgoing）
```

## 3. 组件设计

### 3.1 发现层
- `last_preview: dict[str, str]`（纯内存，替代 `last_content` 的触发职责）：比较**整个 ListItem name**（含时间行），防长消息截断假阴性。
  - 已知取舍（对抗审查 ISSUE-6，2026-07-02 拍板不修）：name 含时间字段 → 午夜/跨天时间文本变化会造成一波假触发开窗（每会话一次、cap=3/轮、开完即提交收敛，有界一次性成本）；不剥时间字段是因为"客户隔时重发相同文本"只有时间字段这一个变化信号，剥了会漏读——漏读比夜间一波白开严重。
- **永不 pop**。误触发代价 = 白开一次会话，读不到新 trailing incoming 就不回 → 无自回复风暴风险。
- 回复 DELIVERED 后立即把该会话 `last_preview` 同步为读回值（`_confirm_delivery` 反正在读，顺手存），消灭"每次回复后 100% 白开"。
- 重启语义（`last_content`/`last_preview` 均不持久化）：首轮只信角标路径 + 首见记录，第二轮起启用变化触发（防启动风暴、防陈年消息误回）。
- 已知群缓存：`_is_group_by_header` 判定过的群 sender 记入集合，发现层直接跳过不再开窗。

### 3.2 读取层：新函数 `read_chat_bubbles(mw) -> List[{"text": str, "direction": str}]`
- 单一口径读聊天面板 Text 控件，**显式按 r.top 排序**（不信 descendants 顺序）。
- 几何全部从窗口 rectangle 推导：`chat_left = wr.left + width//4`，`midline = (chat_left + wr.right)//2`（同 `_last_bubble_direction`，禁止写死绝对坐标；顺手把 `read_chat_panel_messages` 的 `x_min=460` 改为相对推导）。
- direction：气泡中心 x < midline → incoming，>= → outgoing（压线判我方，保守）。
- 离屏守卫：`wr.left` 绝对值 >20000 → 先归位再读（同 `_open_chat` 已有写法）；midline 不在窗口内 → 返回 []。
- 读空轮询 ≤3 次 × 0.6s（同 `_confirm_delivery` 模式）；仍空但列表侧有触发信号 → 回退用预览 content 走旧单条路径（保底不漏）。
- 读气泡前**强制** `_chat_title_matches(mw, sender)` 复核；`CurrentIsSelected` 只作切换成功信号，不作读取授权（防回错人）。

### 3.3 系统气泡剔除（防锚点劫持）
纯函数 `strip_system_bubbles(bubbles)`：时间戳（正则匹配时间格式）、`撤回了一条消息`、`拍了拍`、`以下是新消息` 等**从序列剔除**，不参与方向判定与 trailing 切分。（居中系统 Text 会被判 outgoing 并劫持锚点，把之前的 incoming 全切掉——Challenger 确认的头号窟窿。）

### 3.4 锚点层：纯函数 `split_trailing_incoming(bubbles, unread_count, has_replied_recent) -> List[str]`
- 锚点 = 剔除后**最后一条 outgoing**（我方/人工回复都算：人工回过则 trailing 为空 → AI 不回，天然正确；人工 outgoing 同时推进锚点）。
- 无需持久化、重启免疫、自回复风暴天然免疫（只取 incoming）。
- 双校验：最后 outgoing 文本与最近已发 replied 文本做 `_delivery_confirmed` 同款前缀匹配 → 对上 = 高置信；对不上（人工回复）仍可用，记日志（脱敏）。
- **无 outgoing 分支（防陈年消息）**：仅当**角标 N>0** 才回，取 min(N, 可见 trailing incoming)；无角标+无 outgoing → 只记录不触发。
- 非文本气泡（`[图片]`/`[语音]`/`[视频]`/`[转账]`/`[文件]`/`[动画表情]`/name 空）：占位符计入 incoming，纯占位符批也触发回复，绝不透明化。
- 第一刀不做聊天面板滚动：锚点滚出可见区 → 读到多少 trailing 算多少（合并回复本来就一条）。

### 3.5 回复层与事务性
- trailing 合并（`aggregate_messages`，扩展占位符保留）→ 走现有 classify_unread 门（roster/冷却/频控/replied）→ draft → `reply_in_chat`（自己重开会话，现有防串台三闸不动）→ `_confirm_delivery`。
- **提交点 = DELIVERED**：replied 标记、`last_preview` 同步只在成功后做；草稿失败/no_reply/rate_limited/发送失败 → 一律不动触发态，下轮重读气泡重试（消息在气泡里，不依赖已被微信消费的角标——这是对"触发信号被消费"的根治）。
- 重发前自愈：读最后 outgoing 气泡与本次 reply 前缀匹配 → 命中补记 DELIVERED 不重发（治读回假阴性重复回）。
- 熔断（修正 2026-07-02：只告警不降级）：同一会话连续 3 轮"emit 了消息但未走到 DELIVERED 提交" → 心跳 diag `anchor_stall` 计数 + 醒目日志，**不停止重试**——降级 badge-only 会静默丢消息，违反铁律「客户消息绝不静默丢弃」；重复回风暴已由锚点结构（只回最后 outgoing 之后的 incoming）+ reply_failed cooldown 限频结构性防住。
- **删除**：`last_content.pop`（:3357）、path-2 旧逻辑（scan_unread :515-529）。`replied` 去重 key 维持 (sender, 合并content)，兜底靠"回复前查我方上条回复是否已在锚点后气泡里"+熔断。
- `REPLY_DIRECTION_CHECK`（config.py:127，默认 False）**不动**：它管 Phase-2 发送前的单点方向检查，与新机制的 scan 侧气泡方向判定互相独立；新机制不受它控制（锚点切分本身就实现了"不回自己"铁律，且更强）。

### 3.6 延迟预算（#984 教训机制化）
- 每轮开窗 cap=3，角标会话优先，其余顺延下轮。
- 已知群缓存跳过；回复成功同步 last_preview 消灭系统性白开。
- 注意：scan 侧读气泡开一次 + reply_in_chat 再开一次 = 每条回复 2 次开窗，预算按此算；rog 真机测轮延迟，DoD 要求不回到 60s 级。

### 3.7 日志脱敏
新代码日志不打消息明文：`len=N hash=xxxx` 或前 8 字掩码。存量明文日志另立 issue，不在本刀。

## 4. 测试策略

### 4.1 CI regression（unit，先 red 后 green，永久留 CI）
放 `services/agent/wechat-rpa/tests/`，照 `test_msg_direction.py` 的 `_Rect/_EI/_Text/_MW` Fake 注入模板：
1. **主 bug 复现**：气泡序列 `[in:在吗, in:什么价格, out:回复1, in:我想买好产品, in:发下资料, in:你们公司信息]`，角标清零、preview 只见最后一条 → 新机制返回 trailing 3 条合并（修前 fail）。
2. 系统气泡剔除：批内夹时间戳/撤回 → 不劫持锚点。
3. 无 outgoing 分支：无角标不回；有角标 N → min(N, trailing)。
4. 事务性：草稿/发送失败 → last_preview 与触发态不动，下轮可重试（状态机纯函数测）。
5. 非文本占位符：纯 [图片] 批触发回复、占位符进合并上下文。
6. 方向 fail-closed：全判不出 → 不回；离屏几何 → []。
7. 熔断：3 轮停滞 → 降级 badge-only + 计数。
8. 多租户/多联系人隔离断言（铁律：测试默认 ≥2 联系人互不串）。

执行注意（Research 钉死）：
- 新测试文件必须**逐个点名**加进 `.github/workflows/ci-l4-runtime.yml` L134 的 pytest 列表（否则只在 self-hosted job 跑）；改 .yml 的 commit 标题带 `[CONFIG]`。
- `diff -r` 校验含 tests/ → 新测试同步 rsync 进 `services/agent/build-modules/line04/wechat-rpa/`。
- pytest.ini 有 ASCII-only 约束的坑注释（self-hosted GBK），新文件注意编码声明。

### 4.2 环境哨兵（真机接缝，proven-to-fire）
- `bubble_read_empty` 计数进心跳 diag（列表可读但气泡区 0 条 = 树病信号）——rog 用 OFFSCREEN 制造读空，亲眼看报红。
- 锚点停滞熔断告警走心跳 diag——mock 停滞制造一次告警。
- 图片/语音/撤回/时间戳的真实 UIA name 先在 rog 采样建 fixture，解析逻辑随后 CI 可测。

### 4.3 真机 DoD（rog / staging）
- 默忆连发 5 条**一条不漏**：服务端 `zenithjoy_test` 库 `cs_memory_messages` 全有 in 记录 + 合并回复真送达（看默忆会话真收到，不信中台 DELIVERED 自报）。
- 轮延迟不回到 60s 级。
- 验证只读服务端 DB + 心跳，**不 curl draft-generate**（污染数据）。

## 5. 版本与发布

- 模块版本 1.0.90 → **1.0.91**，9 面同步（modules/build-modules manifest、walking-skeleton.service.ts L74、.test.ts L160-162、heartbeat-modules.test.ts L78、4 个 smoke 脚本 EXPECTED）。
- staging 部署后 OTA 到 rog；**生产 promote 用户手点**（AI 只 staging）。
- 与 cp-07012207-line04-phase1-observe 分支无冲突（它只在 L2600 附近加纯函数 `_classify_home_state`）。

## 6. 不包含（YAGNI）
- 聊天面板滚动补读（锚点滚出可见区场景，留证据驱动）。
- 锚点持久化文件（outgoing 天然锚点够用）。
- 存量明文日志脱敏改造（另立 issue）。
- 会话列表滚动补扫视口外会话（现状行为不变，微信新消息自动置顶）。

## 7. 已拍默认值（autonomous，可复议）
连发合并成一条回（用户上一 session 已接受）；开窗 cap=3/轮；熔断 K=3；读空轮询 3×0.6s。
