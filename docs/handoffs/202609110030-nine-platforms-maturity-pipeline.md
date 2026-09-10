# Handoff：九平台全通 + 发布 skill 熟化机制定稿（0910 全天冲刺收官）

日期：2026-09-11 00:30 · 会话：d5a5065b · verdict: **PASS**

## 一句话状态

智能发布九平台全部实证打通（8 真机 + 1 纯代码），四台手机两地互备，三入口（Notion/飞书/小程序）+ 定时；主理人今晚拍板了 skill 熟化机制四件套（阶段协议/回流铁律/拟人纪律/三层固化刀法），全部已写进 android-publish 底座并 commit。

## 完成（done）

### 平台面（9/9，全部完整协议链：建单→claim→领包→发布→回执→rollup 自动 published）
| 平台 | 账号 | 机器 | 可见性 |
|---|---|---|---|
| 抖音 | 躺赢AI学姐（金诺）/ Ai办公室 90915521618（悦升） | 金诺机 / realme | 私密 |
| 快手 | 茂辰养老 2819032020 | 金诺机 | 私密 |
| 小红书 | 大湖成长之路Ai+ 2353199012 | realme | 私密 |
| 微博 | 大湖成长之路 | realme | 私密 |
| 头条 | 大湖Ai+（抖音一键授权 0910 当场登通） | realme | 私密（微头条图文首通） |
| B站 | 徐先生Ai助力企业 | realme | **私密**（图文动态支持仅自己可见，推翻 0830"只能公开"旧结论） |
| 知乎 | 大湖系（第165篇创作） | realme | 公开+AI声明（主理人拍板） |
| 视频号 | 大湖成长之路-Ai+ 98关注 | realme | 公开（自动带的真实定位已手动去除——重要隐私坑） |
| 公众号 | Mzk1NzY4MDgwMg | **纯代码**（官方API：token→素材→草稿→freepublish） | 主页可见不推送粉丝 |

### 功能面（今天上线）
- **定时发送**：PR#1806，contents.scheduled_at + 编排双侧「定时」闸（fail-closed），staging 真验过，Notion/飞书「定时」列已加
- **小程序直发**：miniapp PR#36，上传完→去发布→填文案勾平台→进队列；已传微信平台 v0.1.0（CI 上传被 IP 白名单拦，走本地 robot 1；预览二维码可随时重生成）
- **刀A agent 自动拉素材**：PR#1807，PublishPollLoop 30s 轮询+原子 claim+流式下载+MediaStore 落相册；金诺机 2.1.49 真机验证（派单 32 秒自动认领素材进相册）
- **claim 防重复领单**：POST /api/publish-tasks/:id/claim（CAS queued→dispatched），多机安全

### 机制面（主理人 0910 晚拍板，全部已 commit 进 ~/.claude-account2/skills main）
1. **熟化流水线**（commit 4f573cd）：回流铁律（每单新坑必须当场回流+commit）；熟化判据=同平台连续3单零新坑跨≥2机→触发刀B固化
2. **运行阶段协议**（commit 9c100ef）：EXPLORE/VALIDATE/HARDEN/FROZEN 四阶段姿态内置 skill 头部阶段块——执行 AI 加载即知道本单姿态，唤起提示词只需"处理发布队列"；七平台手册已打 VALIDATE 标
3. **拟人纪律**（commit 579091a）：同机平台间隔≥15min/贴人类作息/定时±5min抖动/坐标±5px/随机犹豫/变速滑动/发后刷信息流/闲逛混入；自查标准="真人做得出来吗"
4. **三层固化刀法**：流程=Kotlin状态机（死）；定位=无障碍树语义查询（死代码但天然跨分辨率）；视觉=AI on-call 兜底+设备坐标缓存

### 基建面（顺手修的暗伤）
- 注册表扫描器静默罢工5天（脏文件堵 clean-main 闸）→ 已清、快照全刷新、地图 fresh
- headless 三连墙（map_stale/revision_mismatch/assertion_missing）→ 前两个已修，第三个是账本缺 assertion 绑定（见 next）
- 机队档案重建：M1=小龙虾(…223)+realme(e6c7ef34)；M4=金诺机(…983)+新机(…137)；rog 通道已废
- 悦升三机拉齐：小龙虾/realme 九平台App全齐（此前"头条B站被清"是 grep 包名乌龙）；新机灌装中（快手/小红书/B站/头条已有，微博/知乎补装流水线跑着）

## 未完成（not_done）
- 发布唤起器 cron（headless 会话）——机制四件套的最后半层"谁唤起"
- 公众号脚本入仓成正式 worker（本 PR 已带 `apps/api/scripts/wechat-mp-freepublish.py` 保底，未接作业单轮询）
- 刀B（App 操作 Kotlin 化）——等 VALIDATE 计数：微博/头条/B站/视频号已 1/3，抖音/快手/小红书 0/3（今天有坑重数）
- realme/新机/小龙虾 agent 未接 staging 发布轮询（只金诺机在轮）；平台亲和 claim 未做（agent 会抢本机发不了的平台的单）
- 生产 promote：#1806/#1807/miniapp#36 全在 staging，等主理人放行
- 无锚作品（小程序直发）的定时到点派发 worker
- 新机(…137)账号全空白（主理人考虑登自己抖音号）；大湖抖音号不在任何机队手机上
- headless 账本债：android_worker_publish capability 无 must_run_assertions 绑定

## next_steps（按序）
1. **发布唤起器 cron**：照 OpenClaw 架子（cron→headless 会话，提示词"处理发布队列：查 queued 单→按平台 skill 发布→回执"），注意拟人纪律要求串行+平台间隔
2. **公众号 worker 化**：wechat-mp-freepublish.py 接作业单轮询（或并入 notion-orchestrator 同款 worker），凭据 ~/.credentials/wechat.env（WECHAT_APPID/WECHAT_APPSECRET，本机 IP 已在白名单）
3. 生产 promote（主理人说"可以"后 workflow_dispatch promote-prod-hk）
4. VALIDATE 计数攒单→最快平台进 HARDEN→刀B 点火
5. realme 三台 agent 接轮询前先做平台亲和 claim（否则互抢）

## data_sources
- skill 仓：~/.claude-account2/skills（android-publish 底座 246 行含全部机制；今天 8 个 commit：151b08f→579091a）
- 发布台账：hk-vps staging DB `publish_tasks`（platform/machine/receipt 全记录）
- 公众号脚本：apps/api/scripts/wechat-mp-freepublish.py（四步API，0910 真发实证 publish_id 2247484395）
- 真发证据：公众号 http://mp.weixin.qq.com/s?__biz=Mzk1NzY4MDgwMg==&mid=2247484395&idx=1&sn=d1ef8eda6b3625c419a7c64721fab0b1
- 设计 spec：docs/superpowers/specs/2026-09-10-{scheduled-publish,agent-publish-pull}-design.md
- PR：#1806（定时）#1807（刀A）miniapp#36（直发）

## decision_refs
- 三模式架构（AI代笔待审/先传后编/现场直发）· 定时发送 small-change · phase3 基座纯代码化 · B站知乎视频号公开发布放行 · 熟化机制四件套 · 2生产+2研发机队分层（金诺=金诺机；悦升=小龙虾生产+realme/新机研发）
