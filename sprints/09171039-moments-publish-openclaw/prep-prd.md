# PrepPRD：智能客服(line04) — 朋友圈发布接入 OpenClaw 生产调度

## 本次对话涵盖的所有事项（防信息丢失）
- [x] 本 PrepPRD 包含：把「朋友圈制作+发布」从 EXPLORE（人工代驾）推进到能被 OpenClaw 无人值守调度执行
- [ ] 另立 Sprint（本次不做）：点赞（moments_interaction）、跟圈内容源账号、复盘日报自动化——今天已在 EXPLORE 验证但本次范围只做发布
- [ ] 待讨论：AI 自动配图（生成而非匹配素材库）留二期

## Journey 当前状态
- ✅ `android-moments-publish` skill（EXPLORE 验证通过，0917 真机首通）
- ✅ `generateMomentDraft()`（AI 生成文案，写审核台，仅文字）
- ✅ `/api/wechat/moment-drafts` 审核台 API（查询/approve/reject）
- 🔄 朋友圈制作(定时/手动→AI写文案草稿→审核台→真机发) — ability `f2913c7a`，planned/thin → 本次推进
- ⬜ 派单桥（approve → 设备执行）— 完全空白，本次新建

## 本次要做的
把"批准后的朋友圈草稿"从"人工在审核台点批准"到"真机上真正发出去"这一段打通，且不需要 AI 现场操作——照抄项目里已经跑在生产的 `douyin-phone-adb` + `outreach-tick.sh` 架构模式（openclaw-gateway 工单机制 + dump优先/视觉兜底坐标判定引擎），新建 `wechat-moments-adb` 执行脚本 + 派单桥 + 调度脚本。

## Golden Path

1. 主理人在审核台看到 AI 生成的朋友圈文案草稿 → 点击"批准" → 系统按行业/主题标签从素材库自动匹配一张配图（匹配不到则降级为纯文字动态）→ 状态变为 `approved`
2. xian-m1 上的调度脚本（新建，仿 `outreach-tick.sh`）按"审批触发+15-30分钟轮询兜底"节奏，向 openclaw-gateway 领取"下一条已批准待发布的朋友圈"工单，领取动作原子加锁（状态机 pending→claimed→executing→confirmed，claimed 超时10分钟自动回收）
3. 调度脚本调用新建的 `wechat-moments-adb`（架构照抄 douyin-phone-adb：每一步坐标判定先 uiautomator dump 重试3次，失败转视觉模型截图判定，视觉再重试3次仍失败则整条任务标记 failed）→ 在真机（xian-m1/ANGYVB4311010223）上执行"打开微信→朋友圈→选图（素材库配图或纯文字）→填文案→点发表"
4. 脚本截图反查"我"页最新动态是否与本次文案/配图匹配（纯视觉读图，与坐标判定无关，几乎不会失败）→ 确认成功后回报 openclaw-gateway，工单标记 `sent`
5. 主理人在审核台/日报里看到这条朋友圈的最终发布状态（sent / failed）

**失败恢复**：Step3 坐标判定 dump×3+视觉×3 均失败 → 任务标记 `failed`，不重试、不硬点、不发布；不额外触发人工提醒，等日常复盘/审核台自然发现即可。

## 客户视角
主理人在审核台点一下"批准"，之后不用管，朋友圈会在合适的时间自动真机发出去；发布失败会在审核台里看到状态，不会误发/漏发到自己不知道。

## 完成后用户能
1. 批准一条朋友圈草稿后，不用打开 Claude Code、不用喊 AI 帮忙，它会自动被真机发出去
2. 在审核台随时看到每条朋友圈的当前状态（待发布/已发布/失败）
3. 发布失败不会导致误发或卡死，安全降级为"这条没发出去"

## 涉及的 Ability / Feature
- 朋友圈制作(定时/手动→AI写文案草稿→审核台→真机发)（ability `f2913c7a`，thin，本次推进"审核→真机发"这一段）

## GP-Anchor 声明
`line04/moments_publish#step3`（推进"发布上圈"这一步；对应 product-map.json 里 `moments_publish` 的 step2「发布上圈」）

## 不包含
- 点赞（moments_interaction）、跟圈内容源、复盘日报——留后续 sprint
- AI 生成配图（本次用素材库匹配，纯图生图留二期）
- 多设备/多租户扩展（本次只对接 xian-m1 单设备单账号）

## 判定点登记表

| 判定点 | 候选方法 | 所选方法 | 依据 | 误判后果 |
|--------|----------|----------|------|----------|
| 坐标定位失败处置 | 转人工审核台 / 账号级熔断降级 / 直接判失败 | dump重试3次→视觉重试3次→仍失败直接标记failed，不转人工、不熔断 | 发布确认(截图读内容)与坐标定位是两回事，前者几乎不失败；坐标定位两条路都不行时failed是安全默认，靠日常复盘自然发现 | 无（failed=不采取任何动作，最坏结果是今天没发出去）|
| 跨调度实例并发领单 | 无锁/乐观锁/悲观行锁状态机 | 数据库状态机(pending→claimed→executing→confirmed)+领取动作用行锁原子操作，claimed超时10分钟自动回收 | 现有wechat_publish_task表无中间状态，需新增；防止两个调度周期领到同一条工单重复发布 | ⚠️ 重复广播同一条朋友圈，不可逆 |
| 发布成功判定 | dump反查计数 / 视觉截图读内容比对 | 视觉截图读"我"页最新一条内容是否匹配本次文案+配图，纯视觉判断，不依赖dump | 与坐标判定解耦，几乎不会出现"判断不清"的情况 | 低（判断路径本身很少失败）|

## 前置工作（已逐项确认，无 TBD）

### 账号与登录
- [x] 微信业务号 — 已登录，xian-m1 / ANGYVB4311010223（小龙虾）

### API 与凭据
- [x] toapis.com 视觉模型 API — douyin-phone-adb 已有可用配置（LOCATE_ENDPOINT/LOCATE_KEY_FILE/LOCATE_MODEL），本次复用同一凭据
- [x] openclaw-gateway — us-vps 上已运行的 docker 容器，已有 outreach 工单模式可参照

### 测试 Fixture
- [x] 素材库图片 — 蹚路阶段用 ffmpeg 生成暖色调渐变图代替（见 android-moments-publish skill），生产素材库需主理人后续补充真实分类图片，本次先用同一套生成图占位跑通链路

### 基础设施
- [x] xian-m1 机器 — 已在 OPC worker 池中，SSH 可达，ADB 已连接目标设备
- [x] `wechat_publish_task` 表 — 已存在，type='moments' 已是合法值，本次需新增 migration 补 `claimed`/`executing` 状态到 status 枚举

## 验收标准（Final E2E）
- [ ] 在审核台批准一条朋友圈草稿后，不需要任何 AI 交互会话介入，工单在 ≤30 分钟内被 xian-m1 调度脚本领取
- [ ] `wechat-moments-adb` 在真机上完成发布，且坐标判定全程走 dump/视觉判定协议（不硬编码坐标）
- [ ] 发布成功后，审核台/wechat_publish_task 状态更新为对应终态（sent/failed），且能通过截图证据核实真实发布结果
- [ ] 故意断开设备/让视觉判定失败，验证任务能正确落到 failed 状态而不误发/卡死（proven-to-fire）
- [ ] CI 全绿
