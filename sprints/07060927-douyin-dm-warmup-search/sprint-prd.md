# Sprint PRD — 抖音私信触达：抖音号搜索定位 + 关注点赞热身互动

## OKR 对齐

- **对应 KR**：ZenithJoy 产品全线上线 — AI双线创作 + 小程序 + 网站 + Dashboard 可交付（当前 77%）
- **当前进度**：Line02 客户智能获客路径 —— 抖音私信主动触达 Android 执行路径已 medium（PR #1124/#1126/#1127 真机验证过真实发送）
- **本次推进预期**：在已验证的私信发送链路前插入"精确搜索定位主页"+"关注点赞热身互动"两段真实动作，降低小号被判定营销机器人的风险

## 背景

`DouyinDmOutreachService` 当前私信前用 `openProfile()` 拉起 App 停在原页面，不做精确定位，也没有热身动作，冷启动私信容易被风控识别为机器人行为。本次替换为"精确搜索定位主页"+"关注/点赞热身互动"，两步都要遵守"不阻塞主流程、失败尽力而为跳过"的产品决策（不做取消关注机制）。

## Golden Path（核心场景）

用户/系统从 [中台派发 dm_assignments 任务] → 经过 [搜索定位→热身互动→私信发送] → 到达 [Dashboard 触达记录变为 sent]

具体：
1. 中台派 `dm_assignments` 任务（payload 含 lead 的抖音号）→ Android agent 收到任务
2. 无障碍服务打开抖音搜索框 → 输入 lead 的抖音号（精确字符串，非昵称）→ 随机延时 2-5 秒模拟阅读结果
3. 系统在搜索结果里精确匹配抖音号完整字符串 → 点击唯一匹配结果进入主页；搜索不到唯一匹配（0 个或多个同名结果）→ 标记 `failed`，不重试，转人工核实
4. 系统读取"关注"按钮当前文本状态 → 若为"关注"（未关注）则点击；若已是"已关注"则跳过；找不到按钮/加载超时 → 尽力而为跳过，不阻塞
5. 系统读取主页第一个作品的点赞按钮状态 → 若未点赞则点击进入作品详情页点赞后返回；若已点赞、无作品可点赞、主页仅关注可见 → 尽力而为跳过，不阻塞
6. 系统随机延时 2-5 秒 → 返回主页 → 点"私信" → 输入话术 → 发送 → 确认送达（复用已验证过的链路）
7. 用户在 Dashboard 触达记录页看到该条记录状态变成 `sent`

**熔断规则**：单个 lead 从 Step 2 到 Step 6 总耗时超过 90 秒 → 中止当前 lead，标记 `timeout`（区别于 `failed`），进入下一个 lead，不阻塞整批任务队列。

**关于"关注"的产品决策**：关注是不可逆的社交动作（对方会收到通知），本次决策为**不做取消关注机制**——即使后续判定该 lead 低价值，也不回滚已关注状态。

## 边界情况

- Step 3 搜索 0 个或多个同名结果无法唯一确定 → `failed`，不重试
- Step 4/5 找不到关注/点赞按钮、主页无作品、主页仅关注可见 → 跳过，不算失败
- Step 4/5 关注或点赞其中一步加载超时/失败 → 尽力而为跳过，继续走到 Step 6
- 单 lead 总耗时 > 90 秒 → `timeout`，中止当前 lead 不阻塞后续队列

## 范围限定

**在范围内**：
- 抖音号精确搜索定位主页（替换 `openProfile()`）
- 关注/点赞热身互动（按钮态判断跳过已完成/未完成）
- 90 秒单 lead 超时熔断
- 身份核对（精确匹配抖音号）、按钮态判断（关注/点赞文本解析）抽成纯函数并写单测

**不在范围内**：
- 关注/点赞历史的跨批次持久化数据库查询（按钮态实时判断天然去重，足够覆盖）
- 点赞作品的智能选择策略（本次固定选主页第一个作品）
- 关注后的取消关注机制

## 假设

- [ASSUMPTION: 抖音搜索结果页的抖音号文本可通过无障碍树读取到完整字符串，用于精确匹配]
- [ASSUMPTION: "关注"/"已关注"、"点赞"/"已赞"的按钮文本在当前抖音版本下是稳定可判断的固定字符串]

## 预期受影响文件

- Android agent 中 `DouyinDmOutreachService`（或等价私信发送服务类）：插入搜索定位 + 热身互动两段动作，替换 `openProfile()`
- 新增/调整：抖音号精确匹配纯函数（唯一匹配/零匹配/多匹配歧义判断）
- 新增/调整：按钮态判断纯函数（"关注" vs "已关注"、"点赞" vs "已赞" 文本解析）
- 新增/调整：单 lead 90 秒超时熔断逻辑（计时起点 Step 2，终点 Step 6）
- 对应单元测试文件

## NFR 约束

<!-- 来源: 本次任务 PrepPRD 显式拍板值，decisions 表 category=nfr 查询为空（golden-path-decisions / abilities decisions 两源均无记录），故全部取 PrepPRD 值 -->
- 随机延时：模拟真人操作，搜索后等待 2-5 秒、私信发送前等待 2-5 秒（均为随机值，禁止写死单一常量）
- 频控：关注 ≤10 次/小时，点赞 ≤15 次/小时
- 单 lead 超时熔断：90 秒（从 Step 2 搜索开始计时，到 Step 6 私信发送/确认送达结束），超时标记 `timeout`（区别于 `failed`），不阻塞整批队列
- 可观测：搜索失败（`failed`）、超时（`timeout`）、关注/点赞跳过均需可在触达记录/日志中区分归因，便于人工核实

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级（step/journey_feature 级查询均为空，全部取自 area 级） -->
- [禁止写死环境假设值] 屏幕外坐标/UIA 按钮文本阈值/搜索结果解析等环境假设值禁止写死常量，要么从环境推导要么真机校准——本 sprint 的按钮文本判断、搜索匹配逻辑属于此类接缝，必须真验（来源: area）
- [真环境验证才算done] 依赖真机的接缝断言（搜索定位、关注、点赞、私信发送）必须在真机上验证过才算 done；本 sprint `target_environment=local_api` 只做纯函数单测级验收，真机验证由人工补验，未真验前只能标 logic-done-pending（来源: area）
- [测试默认多租户] 单元/E2E 测试默认种 ≥2 个租户并断言互不串，本 sprint 若涉及多账号/多租户场景数据需遵守（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容/抖音号等敏感信息不得明文进日志（来源: area）
- [端点鉴权] 若本 sprint 涉及新增 API 端点，必须有 auth，无鉴权端点不准 ship（来源: area）
- [租户隔离] 碰租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: GET /api/brain/journeys/:id/golden-paths 查询为空（该 journey 下尚无 golden_path 表登记记录）；以下摘要取自 PrepPRD「Journey 当前状态」段落，供 proposer 参考不得回退 -->
- 抖音私信主动触达（PR #1124/#1126/#1127，medium）：中台派 `dm_assignments` 任务 → Android agent 拉起抖音 App → 私信发送 → 通过 `/dm-outreach-result` 回执确认真实送达（本 sprint 只在此链路前插入搜索定位+热身互动两段新动作，不改动已验证的发送与回执逻辑）

## E2E 验收

> 期望验收点（自然语言，proposer 按 target_environment=local_api 翻译为 curl/单元测试命令）：
> - 抖音号精确匹配纯函数：给定唯一匹配/零匹配/多匹配三类输入，断言分别返回匹配成功/`failed`不重试/歧义判定
> - 按钮态判断纯函数：给定"关注"/"已关注"、"点赞"/"已赞"等文本输入，断言正确判断是否需要点击
> - 90 秒超时熔断纯函数：给定超过/未超过 90 秒的耗时输入，断言分别标记 `timeout`/正常继续
> - CI 全绿
> - （人工补验，不计入本次 Harness E2E）真机对一个真实测试账号跑通：搜索定位到主页→关注→点赞第一个作品→私信发送→确认送达

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（vitest/jest 单测 + CI 校验）
# 期望验收点：见上方自然语言描述
```

## journey_type: agent_remote
## journey_type_reason: 涉及 Android 远端 agent（DouyinDmOutreachService）与中台 dm_assignments/dm-outreach-result 协议交互，非 dashboard/纯 brain 后端
## target_environment: local_api
## target_environment_reason: PrepPRD 显式指定——Harness 只做纯函数/单元测试级验收（身份核对、按钮态判断、超时熔断三块抽函数写单测跑 CI），真机搜索定位+关注+点赞+私信全链路由人工在 Honor 真机（Tailscale IP 100.91.227.1）手动补验
## journey_id: 368c40c2-ba63-8120-86a9-c8739cde0d2a
## step_id: <无独立 Step UUID；取 PrepPRD 锚定的 Ability feature_id=4abe6ab9-aa55-40a0-bd0b-e38f7f8bd840（抖音私信主动触达，medium）>
