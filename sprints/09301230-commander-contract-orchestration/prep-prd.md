# PrepPRD：Commander 与契约编排——先稳后活

> 设计定案：Brain decisions `3c98fb36`（09-30），关联 `7f842d12` / `018e4e84` / `e8f872cb`。
> 可读版（含架构图、路线图）：https://claude.ai/code/artifact/4397493d-832b-4ff4-9d7d-fbd6415cf1c4
> 本文件是执行体读的 PRD 正本；每个阶段一个 Brain 任务，payload.prd_section 指向本文对应小节。

## 一句话

workflow 在设计时用契约写死；运行时由执行器（程序）照契约跑，Commander（AI）先上岗、陪跑到底、做售后；成败由程序按契约判，人只看趋势表。编排不再依赖 n8n，也不由 Commander 临时组装。

## 背景（为什么现在做）

- 09-29 夜上线 Commander 当入口 + 契约组装执行（PR #2014–#2031），OpenClaw 召唤、定时发起、对标获客真机跑通。
- 09-30 02:00–08:15 事故：关键词采收兜底重扫后进度清零变死循环，三部手机各卡 6 小时；escort 02:52 被移除后无人陪跑；值守 cron 已不存在；stream 哨兵未触发；无总时限、无程序看门狗。修复 #2030 已上，但暴露的是结构性缺口。
- 契约层（8 活动 43 步骤、超时、失败分类、探针）已声明完整，执行层只用了"发现可替换"这一小块。

## 总体架构

| 层 | 角色 | 谁做 | 变不变 |
|---|---|---|---|
| 设计时 | 写契约 YAML：串哪些活动、每步执行者、超时、失败分类、后置探针 → PR/CI 组装闸 → `wf-plan` 编译 `plans/<能力>.plan` → 部署执行机 | 人 + 有头会话 | 定了不变 |
| 触发 | 定时 / 对话 / 事件，带完整调度单（workflow、机器、手机、业务线） | OpenClaw cron / Brain | — |
| 陪跑 | Commander 先上岗 → 按调度单启动执行器并确认起跑 → 盯到 finalize → 售后 → 下岗 | `work-commander`（GPT-5.6 Terra，Codex 运行时，跑场池穿透） | 与有头会话同权 |
| 执行 | 执行器照契约逐个调用活动，每步写账本 | `wf-run.sh`（程序，不思考） | — |
| 活动 | 预检/发现/判定/采集/评分/配送/归位；判断类 = skill，动作类 = 脚本 | 多 workflow 共享 | — |
| 兜底 | 执行器底线 → 看门狗拉新 Commander → Brain 判 lost → Bark | 全是程序 | — |

## Commander 定位

- 只服务 workflow，不服务单次任务；每条 workflow 第一个到场，但不编排、不选机器/手机、不起草契约。
- 顺序：Commander 上岗 → 启动执行器 → 确认 `WF_RUN_STARTED` → 陪跑 → 售后。保底：到点 15 分钟该手机无 run，crontab 直接启动执行器。
- 在场时长：预检前到账本 finalize 后；中途不得被删。
- 三档权限（与有头会话同权、受同样规矩）：

| 档 | 动作 | 例子 |
|---|---|---|
| 自动做 | 可逆、不出本 run | 平滑停批（放锁、落池、回桌面）、重启抖音、唤醒解锁、重试瞬时失败、重拉 escort、补落池、写复盘 |
| Bark 请示 | 不可逆或越出本 run | 删数据、改 crontab/配置、重启健康容器、切换抖音登录号 |
| 只报不做 | 改代码 | 写清根因与修法，由白天有头会话在美国本机走 /dev 提 PR |

- 每条 workflow 一个陪跑 skill：骨架从契约生成（每步正常什么样、预算、失败分类），叠真机 SOP；Commander 身上只挂身份 + 宪法。现通用 `workflow-commander` 与 n8n 时代 3 个旧 skill 退役。

## 成败判定（程序判，人不判单 run）

| 层 | 判什么 | 依据 |
|---|---|---|
| 1 执行器自判 | completed / partial / failed | 账本 finalize：活动产物 + 契约后置探针 + 落池条数（#2013 已有） |
| 2 Brain 对账 | 执行器口头汇报算不算 | 读回执 + 查库；**整批总时限到期无 finalize → lost**（待做） |
| 3 趋势 | workflow 健不健康 | 成功率、每批线索、连续零产出、时长 |

叫人边界：连续 2 晚零产出 / 同故障 3 次接班失败 / 不可逆动作 / 一台手机 24h 无成功批 → Bark；单批 0 线索、单次接班、单批 lost 不叫。主理人每日看一张程序生成的趋势表。

## 阶段与任务（Brain tasks，均 queued，payload.decision_id=3c98fb36）

### 阶段 1｜稳（2–3 天）

| Brain 任务 | 做什么 | 验收 |
|---|---|---|
| `7d150e33` | wf-run/batch2：整批总时限（默认 4h，可配）到点平滑收工（放锁、已采落池、回桌面、finalize）；每活动超时读契约 `budget.max_duration_s` | 人为制造死循环，4h 内自收工，账本 final=partial，锁 free，线索已落池 |
| `17ea4536` | Brain scheduler job：有 run 在跑且 Commander 心跳 >15 分 → 重新拉起 Commander 接班（只读账本接上）；Commander 每 tick 写心跳到账本；Bark 阈值按上表 | 杀掉 Commander，≤20 分钟内新 Commander 上岗并在飞书回执；连杀 3 次 → Bark 响 |
| `c2d73868` | Brain：总时限到期无 finalize → 判 lost，收割器放锁回桌面；对标 run 账本 run_id 前缀按能力取名 | 杀掉执行器与 Commander，到期后任务终态 lost、锁 free |
| `1ebaeb00` | 查清 09-30 02:52 escort（d417a34c）被谁移除；只有 run 收尾允许 Commander 下岗 | 事故根因写进 Notion Issue；再次 `cron rm` 在途 escort 会被拒或立即重拉 |
| `40f02c5e` | batch2 词间清场（force-stop 重开抖音）与收尾 close-app 进设备锁内 | 两批同机并发时，持锁方现场不被清 |

每道守卫上线时必须故意弄坏一次、亲眼看它报红（proven-to-fire）。

### 阶段 2｜定位（1–2 天）

| Brain 任务 | 做什么 | 验收 |
|---|---|---|
| `81958796` | 重写 `clawd-work-commander/AGENTS.md`（删 n8n V4 协议，只留身份 + 宪法 + "每次 run 先加载该 workflow skill"）；`COMMANDER.md` 宪法改为三档权限（覆盖"无杀权"）；`workflow-commander` skill 去掉选能力/选机器/起草契约，只"照调度单启动 + 陪跑 + 售后"；摘掉 agentic-workflow-runtime / social-leadgen-workflow / coding-workflow | 定时触发 → Commander 只照单启动、陪跑、售后；对话里让它"选一台手机"它拒绝并说明 |

### 阶段 3｜活动切开（1–2 周，大件）

| Brain 任务 | 做什么 | 验收 |
|---|---|---|
| `b0bae881` | 从契约倒推，把判定/采集/评分/配送从 `harvest-keyword.sh`/`batch2.sh` 切成可独立调用单元（统一入口：显式输入对象 → 显式输出对象）；执行器改为读契约 order / runtime.entry / budget / failure 逐个调用；逐条目流转（每视频 判定→采集）在契约里显式声明 | 新执行器跑通关键词获客，产出（线索数、账本阶段、探针）与旧脚本一致；契约里去掉"评分"后不改代码即可跑 |

### 阶段 4｜陪跑 skill（3–5 天）

| Brain 任务 | 做什么 | 验收 |
|---|---|---|
| `d3634db2` | 生成器：契约 → skill 骨架（每步正常态、预算、失败分类、探针）；首个关键词获客，叠 SOP（死循环、账号误读、锁被占、回主页失败）；对标获客复制只改发现 | Commander 按 skill 处置一次真实故障并写复盘 |

### 阶段 5｜第二条真正不同的 workflow（2–3 天）

| Brain 任务 | 做什么 | 验收 |
|---|---|---|
| `529325d9` | 组装一条不只换"发现"的 workflow（例：去掉评分或加一步） | 只改契约 + 补新活动，不改执行器与 Commander |

## 不包含

- 不换编排引擎（Temporal / DBOS 三次复议结论不变，只借概念）。
- 不改跑场池按 workflow 指定机器（Commander 落哪台都能 ssh 干活）。
- 旧 n8n 活动 skill 的"判断"部分是否回收，另议。

## 待主理人拍板

- [ ] 整批总时限 4 小时？
- [ ] Bark 阈值按上表？
- [ ] 旧 n8n 活动 skill：归档还是回收判断部分？
- [ ] 给 Commander 开专属飞书群（现无任何聊天渠道绑定）？

## GP-Anchor

GP-Anchor: none(infra)
