# 铁律清单（Brain active invariants）

合同（02-spec.md）须在 `## 铁律对照` 里对与本改动相关的每条铁律逐条交代。

### INV-ae9a2eb9
- 主题：备用云手机只允许西安四台实体手机出口自动切换
- 内容：替代固定西安PC出口：出口候选仅 honor-100-1、honor-100-2、honor-100-3、q5；自动探测和故障切换；四台全断或Tailscale停机时普通业务应用断网，不回落机房公网。

### INV-5eb4ec04
- 主题：办公室实体手机日常使用、无影云手机备用且强制西安出口
- 内容：四台办公室实体手机作为日常设备，无影云手机作为备用；云手机普通业务流量必须经过 Tailscale 西安出口，不能使用出口时断网，不允许回落机房公网。

### INV-45cd3ec2
- 主题：【撤销 ff177feb】smoke 被生产保护 guard 拦截时维持 exit 0（未授权=安全跳过）
- 内容：撤销决策 ff177feb。维持全仓约定：未授权写入（SMOKE_ALLOW_WRITE≠1）→ exit 0 且不发任何请求；CI 显式授权跑。runner 生成的 cw-*-qa-smoke.sh 同口径。独立裁判提示词补一句：guard 未授权 exit 0 是仓库约定，不算产品问题

### INV-ff177feb
- 主题：coding workflow 回归 smoke 被生产保护拦截时的退出码
- 内容：统一判失败（exit 1），不静默 exit 0 冒充通过；runner 生成的 cw-*-qa-smoke.sh 与手写 smoke 同一口径

### INV-6f217439
- 主题：一个组织共用一套CRM，多微信账号保留来源关系
- 内容：组织是CRM隔离边界，一个组织多个微信账号汇入一套CRM；客户关系和消息保留来源账号，同一客户跨账号身份有证据才合并，不按昵称自动合并。

### INV-356011bd
- 主题：朋友圈配置共用一个Notion数据库，用tenant区分
- 内容：使用一个共享Notion配置数据库，以tenant属性区分租户，以配置类型区分不同配置记录，详细资料用每条记录的Markdown正文填写；不按租户或配置类型新建数据库。

### INV-25e6feec
- 主题：手机巡查仓库允许保留来源提交的正常合并
- 内容：主理人确认允许perfectuser21/zenithjoy-workspace main使用merge commit；仅将requiresLinearHistory改false，保留全部现有required status checks、审查、管理员受限、禁止强推/删除等保护要求；PR2104须111项检查正常通过后普通合并，不使用admin/force。

### INV-91e9abe3
- 主题：Claude 无头与 Codex 的使用边界（主理人 2026-10-10 澄清）
- 内容：改代码的开发会话可以在本机用 Claude 无头（含 AI 自己为主理人改代码时另起的 claude -p 会话、新编码流水线 coding-workflow）；其它机器上跑的、由系统自动执行的任务一律用 Codex（含 OPC 重活穿透到 M1/M4，凭据用 MMV 本机的临时穿透包，不在 M1/M4 登录）。Brain 的器官(mouth 等)走 API 直连，不走 Claude 无头。

### INV-3859041e
- 主题：Claude Code 无头通道逐项处置（主理人 2026-10-10）
- 内容：删：Brain 自动拉起桥接(server.js startCeceliaBridge)、cecelia-bridge 内 claude -p、cecelia-run.sh 与桥接派发 dev/research、llm-caller 的 anthropic(经桥接) 路径(mouth 等器官不再用)、Commander(commander-invoker)、通用启动层对 claude 的 SSH 逃逸(harness-skill-relay 用，本机执行已关)、AI Gateway(ai-gateway.cjs，无运行进程、2月后未改)；主机上：escort 护航唤起 headless Cla…

### INV-067867c8
- 主题：关停 Claude Code 无头调用通道（本机桥接 :3457）
- 内容：2026-10-10 主理人决定：Brain 不再通过 cecelia-bridge 的 claude -p 调用 Claude Code（订阅 OAuth），避免再次封号。已执行：停掉遗留的预览桥接进程(pid 46195)、禁用 launchd 的 com.cecelia.bridge 与 com.cecelia.bridge-keepalive、本机 fleet-worker 重新禁用。mouth 等器官的新主用模型待定。

### INV-8d328e4d
- 主题：原生商品比价必须取得每个目标平台的真实商品链接
- 内容：商品页链接为Skill强制交付项。要求比较Amazon/HomeDepot时必须获取两家真实商品页链接并回填Notion；任一链接缺失则整单失败，不能以有价格代替任务成功。

### INV-696c9f96
- 主题：coding 线命名与代际（coding commander / Claude Code coding harness）
- 内容：①现行 coding 的指挥叫 coding commander（全称 Claude Code coding commander）：MMV 上 Claude Code、最新 Opus，只管 coding；②与 OpenClaw work-commander（业务 workflow，Codex）是两个东西，互不调用；③代际：上上代 = Kernel Harness（含顾问 Commander，orchestrator/commander-*.js）与 Claude Code 里的旧 coding Harness（harness-controller skill-relay）；上一代 = Open…

### INV-02d8e749
- 主题：coding 链重写不得缩减已拍板设计
- 内容：新 coding 链（程序编排 + md 链）只替换编排方式，旧 Harness 已拍板的能力一律保留：GAN 无轮数上限、按 detectConvergenceTrend 收敛（发散/震荡 force APPROVED + P1）；evaluator 是 CI 绿后、合并前的门，真启服务像真员工一样用 curl/psql/Playwright 验；独立 Judge、用户视角 PRD、多环境多仓库、预发 E2E、测试入回归池均需补回

### INV-0dc6b84f
- 主题：coding 研发线执行地与模型（修订 ac7c8801）
- 内容：coding 研发一律在 MMV 用 Claude Code；Commander 用最新 Opus（5.5 起，后续 5.6/5.7… 跟最新）；链上 claude 会话用 opus 别名自动跟最新 Opus，不写死版本号

### INV-ac7c8801
- 主题：coding 研发线执行地与模型
- 内容：coding 研发一律在 MMV（美国 Mac mini）上用 Claude Code 执行；Commander 及链上所有 claude 会话（spec/build/verify/ci_fix）固定用 Opus 5.5（claude-opus-5-5）

### INV-52f1801e
- 主题：cecelia 依赖安装只能在仓库根执行 npm ci
- 内容：cecelia 是 npm workspaces（packages/*、apps/*）。安装/修复依赖一律在仓库根执行 npm ci --legacy-peer-deps --ignore-scripts；禁止在单个包目录（如 packages/engine）内跑 npm ci——它会重装整个根并清空其他包的依赖。修复后用 node -e require.resolve(zod) 对 brain/engine/apps 四包逐一验证。

### INV-751f73be
- 主题：封停 Claude Code 自动激活
- 内容：全部无人值守Claude Code启动封停，包括Cecelia意识与派发、Bridge保活、护航脚本、OPC及后台Worker；保留主理人亲自启动的Claude。主理人追加要求停止西安PC现有Claude桌面进程组，其登录自启也关闭。恢复自动化须主理人明确决定。

### INV-ae4b4428
- 主题：skill沉淀成代码时DOD必须写成代码内联判断+拦截,不是事后Brain探针
- 内容：一个步骤从skill(AI灵活判断)沉淀成代码(确定性执行)时,该步骤的DoD必须同步变成代码里的真实判断+阻断:判不过就不往下走(比如abandon本次/return/break),不能只是把AI判断换成脚本跑一遍就算完事。Brain的step_probes/CI断言是事后观察层(读已写完的数据,翻仪表盘颜色),不拦截任何执行,不能替代这个内联拦截。

### INV-e2551d59
- 主题：runner 镜像摘要唯一真身=仓库
- 内容：跑场机 runner 镜像摘要以仓库 main 的 fleet-node-profiles.json / node-profile.js 为唯一真身；机器上的镜像必须与仓库一致，禁止在机器本地热修配置迁就镜像；镜像重建后必须经 PR 重钉进仓库再下发

### INV-fa4fbaf4
- 主题：智能获客真机录制的手机媒体音量策略
- 内容：record_start 录制前把媒体音量精确驱动到 1（幂等，读当前值按差值），录完不复位、不压回 0，音量永远钉在 1。废弃现有的无脑 VOLUME_UP x2。

### INV-437dc0ec
- 主题：us-vps OpenClaw 网关退役 + 关闭 skill workshop 周评审
- 内容：①MMV 为唯一 OpenClaw 落点，us-vps 网关 2026-09-21 停机并建 /root/.openclaw-gateway-retired 退役标记；②skills.workshop.autonomous.mode 由 auto 改 propose，停掉 22 条周评审（保留提案捕获）；③notion-openclaw-mcp 经 /opt/openclaw/bin/openclaw-remote.sh 转发到 MMV，MCP 桥代码不动

### INV-eb0a03df
- 主题：OPC/OpenClaw 零执行铁律扩大覆盖：Notion「任务」GTD库委派通道(通道2)也必须下放执行
- 内容：us-vps 上不允许起任何 openclaw agent 推理进程，不论来自哪条通道。「任务」GTD库(状态=委派, notion-qiumi-delegate.py) 与「经营对象」执行机器队列(opc-remote-worker.sh) 待遇一致：us-vps 只认领Notion记录+回写结果，真实openclaw agent执行下放到 MMV / xian-m4 / xian-m1 跑场池。

### INV-d31ea63d
- 主题：Notion workspace 唯一化：只保留 ZenithJoy
- 内容：全系统只用 ZenithJoy workspace（integration CCAPI2026 + 员工 connector×2）；旧 Zenithjoy-July 的 token Notion-juke 已从 1Password CS 归档；DB 里指向旧 workspace 的 notion_id 死引用一律清 NULL 重建

### INV-ad83ffdf
- 主题：Meta发布遇 publish_outcome_requires_review(409) 必须人工核实，禁止自动重试
- 内容：idempotency key 已被声明但状态未收敛时返回 409，调用方必须人工去 FB/IG 后台核实是否已发出，绝不自动重试。

### INV-0cb79c35
- 主题：Meta发布幂等必须用D1原子声明，禁止退回KV
- 内容：meta_publish_attempts 表建在 Cloudflare D1，靠 idempotency_key 主键约束 + INSERT ON CONFLICT DO NOTHING 做原子声明(changes===1 才算抢到)。绑定名 META_PUBLISH_DB。禁止改回 KV 的 get-then-put。

### INV-95477a66
- 主题：us-vps 零执行物理化：会话跑场池+三层机器闸
- 内容：us-vps 只做调度/接线/账本，一切推理与执行进会话跑场池（MMV主→XIAN-M4→XIAN-M1，探活守护自动路由）。物理保证三层：①docker 内存闸（gateway 1.86G/Brain 收紧至1.5G）②配置漂移守卫（defaults.primary 必须 terra 进池、appServer 必须 ssh 下放形态，漂移15分钟内自动还原+重启，豁免口 .allow-local-primary）③内存双守卫（挂死单杀6h+总量1.4G温和重启）。全部守卫 proven-to-fire。

### INV-27bb6d1a
- 主题：批量对外动作必须带随机性三件套+多账号分摊,固定周期整点发送=风控自首
- 内容：拟人纪律:①概率跳过(本轮30%)②轮内随机延迟(0-8分钟,不卡整点半点)③动作前停顿(3-8s);加多账号轮流分摊单号频率。适用于私信/评论/关注等一切批量对外动作

### INV-6eb0dff5
- 主题：贵工序(录屏/ASR/LLM判定)前必须有零成本过滤器,便宜闸永远在前
- 内容：视频判定序:零评论跳过→图文跳过→静音空文案不合格→才进转写判文案;评论分拣序:规则闸判70-80%→才进模型。最贵的工序排在最便宜的过滤器前面=烧钱结构

### INV-c7b0f5f5
- 主题：uiautomator dump rc=0且零文件产出=页面结构性不可读,两拍不中必须走视觉兜底禁止死磕
- 内容：自动播放页面(抖音综合搜索页实证)dump返回码0但不产文件,媒体键暂停兜底也无效——这不是时序问题,加大重试纯烧时间(三波180s白等实证)。合法出路=locate_cached视觉定位(带坐标缓存,一次定位后续零成本)

### INV-54dfc25d
- 主题：凡UI复制→读剪贴板链路必须带新鲜度守卫,张冠李戴比取不到更毒
- 内容：复制动作会静默失败,剪贴板残留上一个对象的数据——直接把A的链接/内容写给B。守卫=每profile记上次成功值,本次相同即拒收(COPY_STALE);同对象重取天然安全(每次复制生成不同短链,0914三连实证)

### INV-9dada8f9
- 主题：回已知状态必须显式activity直启+树验证,禁止假设重新打开=干净态
- 内容：monkey/LAUNCHER只把app带回前台,不清页面栈——上轮残留页面(如永不idle的搜索页)会毒死后续所有读树。归位=am start -n 主Activity(singleTask清顶)+树锚点验证

### INV-b8607b31
- 主题：前台/页面判据必须用无障碍树锚点,activity名单独作判据=在猜(荣耀系实证)
- 内容：荣耀ROM mCurrentFocus/topResumedActivity 会永久挂在SplashActivity不更新(0914截图实证:feed明明在跑)。页面判据必须以无障碍树锚点为准(如底部导航「我,按钮」,注意「已选中」变体grep不带右引号);activity名最多作辅助信号

### INV-96054a8b
- 主题：us-vps(Brain+OpenClaw)角色定型：纯任务调度器，禁止本机跑真实任务
- 内容：us-vps上部署的Brain和OpenClaw核心原则统一：两者在这台机器上都只应该是任务调度器/分发器，不应该在本机执行真实任务负载(codex/claude实际跑代码生成、agent执行等)。所有真实任务执行必须下放到worker机器(xian-m1/xian-m4/美国M4)。

### INV-ca6bf8e7
- 主题：引擎-机器绑定铁律
- 内容：Claude Code 只在本机 MMV 运行，绝不铺到其它机器；西安 M1/M4 只跑 Codex；Grok 只在本机。任何调度器（Cecelia Brain / OpenClaw）需要 Claude 的任务一律路由到本机。

### INV-d7e2d132
- 主题：[capture-triage] learning: [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表
- 内容：learning: [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表（漏最后一个=菜单静默不显示）。 [ ] dashboard 新页三件套缺一不可：navigation 组件映射+菜单项+InstanceContext features 表（漏最后一个=菜单静默不显示）。

### INV-76cb816c
- 主题：[capture-triage] learning: [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的
- 内容：learning: [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的隐形炸弹。 [ ] 枚举语义常量（非终态集合）只允许一份，落在被各消费方共同 import 的 service；手抄同值副本=H-3 类 sweep 的隐形炸弹。

### INV-761f242b
- 主题：[capture-triage] learning: [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CA
- 内容：learning: [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS——超时重试就是并发的标准形态，串行幂等防不住。 [ ] "SELECT 判态再 UPDATE" 的幂等一律升级为 UPDATE ... WHERE status=ANY(非终态) 的 CAS——超时重试就是并发的标准形态，串行幂等防不住。

### INV-55f0d846
- 主题：[capture-triage] learning: [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。 [ ]
- 内容：learning: [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。 [ ] jsonb `||` 是浅合并：往任务 result 里塞回执要用固定子键（receipt），不覆盖发布包 payload。

### INV-3ecd7ffa
- 主题：[capture-triage] handoff: fix(kernel): PR 与 main 冲突(DIRTY)路由 generator-fix rebase，根除死等/判死 [r84] v
- 内容：handoff: fix(kernel): PR 与 main 冲突(DIRTY)路由 generator-fix rebase，根除死等/判死 [r84] verdict=PASS 完成: Provider-neutral Harness gates passed and PR merged. 下一步: 完成，无下一步

### INV-848aeef2
- 主题：[capture-triage] learning: 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 徐啸的纠正指出：
- 内容：learning: 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 多人协作禁止混用授权凭据——操作他人账号资源要用其本人的授权 徐啸的纠正指出：在处理飞书、钉钉等多账号系统的集成时，如果要代表某个团队成员操作其资源，必须使用那个人的授权（App ID/Secret

### INV-93ed0761
- 主题：RPA 失败必须自带现场三件套（前台包名+诊断行+截图），否则一律按'在猜'处理
- 内容：① 凡 agent 在真机上判失败（finishWithError/finishWithOutcome 等出口），必须把【前台包名 + 该错误码的诊断行 + 当时截图】随结果一起上报并落进**人会看的正表**，不是塞进旁边任务表的 JSONB。② 人/AI 排查 RPA 问题时，动任何东西之前——**包括只改设备设置**——必须先拿到这三件套；缺一件就是在猜，禁止据此改设备或改代码。③ 新增/修改 RPA 错误码出口而未带现场 → CI 闸门卡 PR，不靠自觉。

### INV-49fbb2b9
- 主题：J7 处置：/api/fields 不下线、field_definitions 加租户列（issue 1ae57f1a）
- 内容：不下线 /api/fields 四端点，改为挂 works 家族的 tenantContext 租户闸；同刀给 zenithjoy.field_definitions 加 tenant_id 列（外键+索引+回填），五处 service SQL 全部带 tenant_id 条件。db_fields（路③，org_id）与 field_definitions（works 家族，tenant_id）两表并存不合并，语义重叠就此消解，不留作后续技术债 sprint。

### INV-eec4d0b6
- 主题：单测绿≠真机有效：okhttp 静音第一版白做，改用 Filter
- 内容：okhttp 内部 logger 改用 Filter 拒绝一切记录，不再只依赖 Level.OFF；level 仍照设。凡『改运行时环境行为』的守卫，单测只能证明自己那段逻辑，必须补一条真机读数才算完

### INV-2dc450f7
- 主题：安卓设备就绪度巡检 · 五条验收断言（判据必须用不会撒谎的那个）
- 内容：[1] 无障碍真绑定：查 dumpsys accessibility 的 Bound services 含三个服务类；严禁用 settings get secure enabled_accessibility_services。[2] 包与身份唯一：每台 prod/e2e 版本一致 + machine_id 唯一（PR #1661 按机器指纹去重）。[3] 注册真成功：日志含 registered-tier= 且无 license key fallback；心跳 online 不算数。[4] 前台拉起可用：startCollect 抖音到前台=true，非 WRONG_FOREGROUND。[…

### INV-edbf1fb9
- 主题：本地候选流程必须覆盖所有出口（PR 假设第三次漏洞）
- 内容：wait:human_review 无远端 PR 时用冻结候选（分支+head_sha）通知人审并返回 DONE；凡涉及 PR 的 handler/闸门都必须同时支持 candidate 载体。后续对 kernel 全量出口做一次 pr?. 依赖审计

### INV-3529e88f
- 主题：机械闸不得依赖 LLM 自愿配合（覆盖判定最终口径）
- 内容：覆盖判定：优先 step_index，否则位置对齐；只检查每步有条目且无 passed=false。措辞比对退出否决路径；防造假交给 Runner 亲自执行且 SHA 匹配的冻结 required_assertions + Evaluator/Judge 双独立复核

### INV-29e7d8f8
- 主题：能力探针必须探真正要用的资源（不探身份端点）
- 内容：GitHub 探针改探 TaskBundle workspace_spec.repo 的 /repos/<owner>/<name>；/user 仅作无 repo 上下文回落；非 2xx 仍 fail-closed。原则推广到其它探针：探针目标 = 该角色真正要访问的资源

### INV-f2d2f383
- 主题：机械覆盖判定不得依赖 LLM 措辞（按序号对齐）
- 内容：Golden Path 覆盖检查按裁判回显的 1-based step_index 对齐；文字锚点仅作无 step_index 的向后兼容兜底；越界/重复序号不采信

### INV-15e28dee
- 主题：止损闸不得依赖 PR 专有字段（本地候选流程必须同样生效）
- 内容：recollect 止损改按本轮候选计数（决策日志尾部回溯到 generator/generator-fix 为界）；凡涉及 head_sha 的闸门都必须同时覆盖 pr 与 candidate 两种载体

### INV-b19c8ab8
- 主题：发回重做的原因禁止散文截断（Alex 08-17 拍板）
- 内容：Judge FAIL 反馈取消 1500 硬截（32000 仅作膨胀护栏），缺步/未过步/裁判意见三段完整；机械判定必须同时以结构化字段（coverage_gaps）下发，与合同 required_assertions 一起注入下一轮执行者

### INV-7a4ccb09
- 主题：[capture-triage] learning: [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdou
- 内容：learning: [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No [ ] nightly-red issue 自动化文案：连续 ≥3 晚同一 job 红时，把失败 step 的最后 20 行原始 stdout（不是 PowerShell `Write-Error` 截断后的）贴进 issue，避免"No mo"这种残缺报错让人放弃归因。

### INV-b8091f6c
- 主题：[capture-triage] learning: [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_H
- 内容：learning: [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 requir [x] 守卫：`lint-nightly-sparse-checkout-deps.sh` 机械对账"脚本 `os.path.join(_HERE, ...)` 依赖目录 ⊆ 该 job sparse 列表"，接进 ci-l1 required gate；含变异测试（单/双引号、`|-` 块标量、守卫解析不到时自报红）——守卫失明必须报…

### INV-53f23a09
- 主题：generator_infrastructure_retry_identity
- 内容：Generator 基础设施失败必须重试原始服务端派发动作：首次 generator 重派 generator，generator-fix 重派 generator-fix。

### INV-ae95068e
- 主题：planner_role_branch
- 内容：Planner workspace must start on the exact server-owned planner_branch; Provider may validate but must not checkout or switch branches.

### INV-a2352105
- 主题：关键词获客私信话术=目标驱动、大模型逐线索生成，不是固定模板
- 内容：客户只给目标(约到店/加微信/推课等)+边界(禁词/长度/不承诺价格等)；每条私信由 LLM 依据该线索的评论内容与画像现写，人人不同；Gate-0 由"话术定稿"改为"目标+边界定稿+抽样人审"；话术质量为软承诺(eval 集+judge+抽样)，敏感词/边界为硬闸(fail-closed 不产单)。

### INV-7e9a3a67
- 主题：地图归属必须是映射(声明)不是扫描：采用 Meta OWNERS 形态——目录级 OWNERS 文件贴代码走，Brain 只读声明确定性投影，冲突即报不猜；跨 cecelia/zenithjoy 两仓
- 内容：照相层(扫描)只回答存在/新鲜，永不定归属；归属只来自代码旁的 OWNERS 声明(capability/step)+PR 出生 GP-Anchor。刀1 cecelia：Brain 读 OWNERS 新事实 kind + 地图按声明投影 + 冲突清单 + cecelia 自贴样板(task 558de0ca 无头 harness)。刀2 zenithjoy：keyword_acquisition 相关目录贴 OWNERS + CI 闸(GP-Anchor 与所改文件 OWNERS 一致)。手写挂片(如 line02 19 条)降级为历史登记，不再作地图输入。

### INV-26793221
- 主题：修正 c84bef20：挂片/FR/NFR/EV 的家 = Brain 格子账本(journey_features + journey_step_links + golden_paths)，不在 product-map.yaml 加 att…
- 内容：两层结构不变(步=3–5 承诺, 挂片=一等公民细单元)，但落地方式修正：product-map.yaml 只管步骤名(承诺)+数量+锚点，不新增 attachments schema；挂片进 journey_features、FR/NFR/判定点/不变量/场景/断言进 journey_step_links(cell_kind=element/capability/scenario/base_ref)、GP 7 项合同进 golden_paths，展示走 Notion 与 staff-hub /line-health/<line>。line02 智能获客当前账本 0 格(其他线已填 84/65…

### INV-c84bef20
- 主题：Capability 骨干颗粒度：两层结构——步=承诺(3–5步) + 挂片=一等公民细单元(厚度/FR/NFR/EV/删/加粗加细都挂在挂片上)，不靠把步切细
- 内容：一个 capability 的骨干保持 3–5 个客户可感知的承诺步(doctrine §5)；每步下面的挂片(feature/使能件, L5)与判定点必须成为 product-map 的一等公民结构：每个挂片有 名称/类型(feature|judgment)/厚度(thin|medium|thick|done)/FR/NFR/EV 验收断言引用(smoke step 或测试)；删除/加粗/加细/定 FR-NFR/验收全部落在挂片上，不通过增加步数来获得颗粒度。挂片≠子步骤(不要求先后顺序)，是兑现该步承诺所需的零件。首个样板：line02/keyword_acquisition 重切为 4 …

### INV-f7f63417
- 主题：[capture-triage] learning: [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）
- 内容：learning: [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。 [ ] 每次改注入/启动路径必须在 4号机（rog 192.168.1.96:5555，e2e 包 `DEBUG_E2E scan` 广播）跑后台冷启动探针 ≥3 次，修前红修后绿才算数。

### INV-c5438d6c
- 主题：[capture-triage] learning: [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语
- 内容：learning: [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。 [ ] 读 logcat 判根因时，`targets O+, restricted` 一类 ActivityManager 信息日志先查其语义（广播/进程限制），别直接对号入座到自己怀疑的模块。

### INV-39624ab8
- 主题：Fleet Generator Brain URL authority
- 内容：本地 Dispatcher 与 Fleet Worker 必须同时注入服务端权威 HARNESS_BRAIN_URL；Generator 仅在通用 BRAIN_URL 缺失时从该变量恢复，预检仍 fail-closed，禁止手工为单个 Attempt 绕过。

### INV-6b24fbde
- 主题：smoke-invariant-1786692495-37576-jf
- 内容：smoke jf 铁律

### INV-0e030008
- 主题：smoke-invariant-1786692495-37576
- 内容：smoke 铁律

### INV-ddca7267
- 主题：Kernel existing PR evaluator validation clock adoption
- 内容：保留 validation_clock_required 默认 fail-closed。仅 gear=hotfix 且 payload 显式 pr_url/pr_head_sha 与 GitHub 实时观测完全一致时，首个 Evaluator intent 可建立一次共享 validation clock；后续 Judge 复用。缺失或不一致一律拒绝。

### INV-42d6c346
- 主题：[capture-triage] learning: judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补
- 内容：learning: judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码，避免对正确实现无谓返工 judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 时优先走 evaluator 补证轮（behavior_tests 扩容）而非改代码，避免对正确实现无谓返工

### INV-c906dd6c
- 主题：[capture-triage] learning: 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 ex
- 内容：learning: 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次 合同里的验证命令必须实跑确认 exit code 语义：vitest 对 include 范围外路径（如 sprints/**）绿态也 exit 1，写进合同前先跑一次

### INV-a39272f7
- 主题：[capture-triage] learning: judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（roo
- 内容：learning: judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code 字段）排序进窗口前列，否则会因证 judge 证据消费窗口为前 8 条 × 600 字符，evaluator 产 .brain-result.json 必须把一手证据（root-cause 输出、Red→Green 时序、exit_code 字段）排序进窗口前列，否则会因证据截断被误打回

### INV-433fb902
- 主题：headed_manual 任务消费语义拍板（task 94ee0ec4）
- 内容：headed_manual=true（payload 旗标，jsonb 布尔或字符串 true 均识别）的任务采用「消费」方向：不进入无头自动派发（selectNextDispatchableTask 派发谓词排除），不被 liveness 假杀路径处置（零 spawn 证据任务安全回队不 kill），保持等待有头人工执行。改此语义须新 decision 废旧。

### INV-ff1895e3
- 主题：[capture-triage] learning: 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 deb
- 内容：learning: 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290 指标口径类告警先查口径三源失真（未接线恒空子指标、守卫自产回流自噬、双重计数）再当真实退化处理：m2 欠账 +5 实为冒烟噪声，真库 debt 462→288-290

### INV-a9aca4b2
- 主题：[capture-triage] learning: 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（iss
- 内容：learning: 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2） 毕业步与 canonical 不可变 lint 存在结构性矛盾，涉 canonical 文件的收尾 commit 前先核对不可变清单（issue 8d2a9ff2）

### INV-933701a3
- 主题：[capture-triage] learning: controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 rep
- 内容：learning: controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo 造成跨任务污染（issue 78016a5f） controller 台账 .harness/progress.md 必须保持在 git 追踪之外，否则随 sprint PR 带入 repo 造成跨任务污染（issue 78016a5f）

### INV-a0bac43b
- 主题：[capture-triage] learning: judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同
- 内容：learning: judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同预先声明验证真相形态或对闸⑤放行（issue 0f586765） judge 机械闸⑤（meta_verification_gap）对 local_api/无 UI smoke 任务会死锁：此类任务需在合同预先声明验证真相形态或对闸⑤放行（issue 0f586765）

### INV-909ce765
- 主题：[capture-triage] learning: Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required
- 内容：learning: Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），功能 PR 遇到时应确认既有性并单独立案，不在功能 PR 里追修 Deploy Preview Environment check 跨 PR 失败是 Brain infra 既有故障（非 required check），功能 PR 遇到时应确认既有性并单独立案，不在功能 PR 里追修

### INV-91ee7d53
- 主题：[capture-triage] learning: 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复
- 内容：learning: 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-anchor 高频合并 repo（如 cecelia）上 update-branch 后应立即挂 gh pr merge --auto 抢竞态，避免反复 BEHIND re-anchor

### INV-17722a93
- 主题：[capture-triage] learning: headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payl
- 内容：learning: headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径必须在受控 Harness 根目录（DEFAULT_BASE_REPO/.claude headed 前台点火任务必须在点火时用 Brain 同款 jsonb merge 把 worktree_path 写进 task payload，且路径必须在受控 Harness 根目录（DEFAULT_BASE_REPO/.claude/worktrees/harness-v2/）内，否则 judge API 会因 filesyst…

### INV-56a0ba9f
- 主题：[capture-triage] learning: watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_
- 内容：learning: watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_dead 假标签污染 u watchdog 对『从未启动的进程』必须走 never_started 分类兜底且不覆盖已有 error_message/failure_class，防止 process_disappeared→liveness_dead 假标签污染 urgent 学习流

### INV-c6f9e985
- 主题：[capture-triage] learning: relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写
- 内容：learning: relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize 收账闸报 no_e relay 单session 模式必须在各 phase 完成时调 POST /api/brain/harness/phase-event 写 node 级 done 事件并推进 run.phase，否则 finalize 收账闸报 no_evaluator_gate/pr_not_found 降级、harness/complete Da…

### INV-70bce96e
- 主题：[capture-triage] learning: PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge
- 内容：learning: PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI PR 处于 CONFLICTING 状态时 GitHub 静默不触发 pull_request CI：不要按 CI 卡死空等，先 merge main 解冲突再等 CI

### INV-81294701
- 主题：[capture-triage] learning: capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6
- 内容：learning: capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI fix 中占 2 capture_atoms urgent 路由建任务前必须按锚点/探针坐标查重：同根因已有 open 任务时合并而非裂变新单（实证：a6e6afc7 与 78e812c0 同 m7 探针双修复撞车，合流成本 5 轮 CI fix 中占 2 轮）

### INV-8078e342
- 主题：[capture-triage] learning: 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染 守卫/探针自产数据
- 内容：learning: 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染 守卫/探针自产数据用共享常量前缀（如 LEDGER_SELF_ATOM_PREFIX）标记并在统计侧排除，防自指计数污染

### INV-d736a17d
- 主题：[capture-triage] learning: 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计 探针类时间窗口用
- 内容：learning: 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计 探针类时间窗口用确定性日历窗口（自然日+时区）而非 NOW()-interval 滑动窗，防执行时刻秒级漂移重复计账/漏计

### INV-3b9804e6
- 主题：[capture-triage] learning: evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证
- 内容：learning: evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL evaluator 临时脚本必须落会话独享路径（含 session id），禁止共享 /tmp 固定文件名——并发 sprint 互踩已实证导致首跑 FAIL

### INV-2f11ae25
- 主题：CI 真机车道 envfail(环境未就绪) 的呈现方法
- 内容：envfail(exit 3) 必须让 job 红 + 触发报警(nightly-red issue/通知)，绝不允许映射成 job success(infra-skip) 静默放行；环境未就绪连续出现视同车道瘫痪，与真机验证失败同级告警

### INV-dcb1602b
- 主题：[capture-triage] learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code ins
- 内容：learning: cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在 cortex.js::recordLearnings 等触发条件窄的路径，真实端到端验证成本高时，可用结构性 source-code inspection(零mock)+同机制其他调用点的真实端到端触发(零mock)两层交叉验证兜底，但需在报告里如实标注为已知覆盖余留，不能算作等价于全链路测试

### INV-f437b0fd
- 主题：[capture-triage] learning: 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一
- 内容：learning: 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染 冒烟/校验类脚本涉及数据库连接目标时，写入侧与校验侧的 DB_NAME 必须来自同一变量/同一解析逻辑，禁止两处各自默认值——本次因此导致一次真实生产库脏数据污染

### INV-1129ee0d
- 主题：Harness GP 全局高风险清单
- 内容：权限、资金、外部发布、生产数据命中任一项时，无论执行线分类为何，强制真人确认。

### INV-e6513dff
- 主题：[capture-triage] learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实a
- 内容：learning: proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈） proposer起草涉及agents表字段的合同/测试前先psql核对真实列名，不要凭经验假设常见字段名（machine_id vs 真实agent_id已有历史回归测试仍会重蹈）

### INV-052e10a0
- 主题：[capture-triage] learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库
- 内容：learning: contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点 contract-dod.md/测试里涉及 status 枚举的硬编码断言，GAN 新增状态值（如本次的 'stale'）时应做一次全仓库 grep 复查，避免遗漏同类枚举检查点

### INV-a3d7c6e8
- 主题：环境接缝守卫铁律未被CI强制—真机失败路径服务端零留痕连续复发
- 内容：确认/dev skill"哨兵(回归守卫)死规矩"章节里描述的CI闸门("PR碰了环境接缝却没带对应自检→CI红,合不进")尚未在zenithjoy repo实现,只有文档铁律没有机器强制。2026-07-28 Path2安卓5台真机复测暴露3处真实案例:①agent-burner.ts /account-scan-result handler对ok=false且非UUID request_id(手机自动循环扫描失败,占99%真实运行路径)的响应无条件跳过持久化,错误码/截图/界面树只留在手机logcat服务端查不到 ②customer-admin.ts绑定失败分支(ALREADY_BOUND…

### INV-636296d4
- 主题：[capture-triage] learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/s
- 内容：learning: watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功） watchdog_overdue 标 failed 的 relay run 经 orphan requeue + 外部真相核查（查 PR/sprint 目录）从头重跑是安全恢复路径（f90ddca3 实证成功）

### INV-588a76b9
- 主题：[capture-triage] learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（
- 内容：learning: 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证） 通知/写库接口的成功判定必须看语义字段（sent/accepted），只 grep ok:true 会把 sent=false 误判为送达（harness/notify 实证）

### INV-442d9ce8
- 主题：[capture-triage] learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接
- 内容：learning: dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单 dep-audit 因新披露 advisory 突然翻红时先查 fixAvailable：布尔 true = semver 兼容修复，直接 npm audit fix，不要急着加白名单

### INV-4284ca38
- 主题：[capture-triage] learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reap
- 内容：learning: headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断 headed relay session 在长 CI 等待循环中应周期性 PATCH relay-runs 心跳，防止 Brain reaper 单信号把存活 session 的任务误标 failed（failed 是状态机死端，收账链会断裂）

### INV-46e9afb4
- 主题：[capture-triage] learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 p
- 内容：learning: 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失 毕业（测试入册）commit 后必须本地先跑 lint-tdd-commit-order 与 check-test-coverage 再 push：毕业 rename 是这两个门的高危触发点（contract 表路径失效 + Red 计数失效）

### INV-f200769d
- 主题：[capture-triage] learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manu
- 内容：learning: 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。 合同批准前必须同时记录 manual oracle 的真实 exit code，并确认目标解释器确实启动。

### INV-d9e4f4c1
- 主题：[capture-triage] learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 ex
- 内容：learning: manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。 manual:node -e 双引号中的 JavaScript `${}` 必须在 GAN 批准前逐条真跑，bash -n 不足以捕获 expansion failure。

### INV-9aeae77e
- 主题：Harness Kernel 有界运行的终止判据：进展驱动（收敛判据），不是固定次数上限
- 内容：修复循环（generator fix loop）的终止判据必须是收敛性：每轮有真实进展（新 SHA、失败面在缩小）就允许继续，不设固定轮数上限；只有检测到不收敛（same-SHA 无进展、同签名振荡如 d707、重复同类失败）才终局。所有熔断触发后的出口一律是 FAILED + 升级人工，永远不允许因轮次耗尽而放行 PASS/merge。deadline 作为宽兜底保留（放宽到 8h 量级），且 wait:human_review 等人工批准期间必须停表。PR #4226 的 MAX_FIX_ROUNDS=3 硬上限、MAX_HOPS=60 误算预算、120min 全程 deadline 均需…

### INV-47243466
- 主题：smoke-invariant-1784808160-58494-jf
- 内容：smoke jf 铁律

### INV-6041333c
- 主题：smoke-invariant-1784808160-58494
- 内容：smoke 铁律

### INV-622171ab
- 主题：smoke-invariant-1784806023-5054-jf
- 内容：smoke jf 铁律

### INV-a3989e96
- 主题：smoke-invariant-1784806023-5054
- 内容：smoke 铁律

### INV-b9e7a730
- 主题：[capture-triage] learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至
- 内容：learning: [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测 [ ] 测试如果全部依赖"重置状态=冷启动"的写法（`afterEach` 清空 sentinel、传 `sinceMs=0`），要专门补至少一条"真实多轮扫描、状态不重置、时间真实流逝"的集成测试，否则这类"跨扫描周期"的 bug 永远测不出来

### INV-e06d4aa2
- 主题：[capture-triage] learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假
- 内容：learning: [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的 [ ] 涉及"周期性重新扫描同一批数据"的设计，一旦引入外部付费调用（LLM/第三方API），必须同时设计"是否已处理过"的前置检查，不能假设"重扫不常发生"就不用防——扩大扫描窗口（为了修一个 bug）反而可能意外放大另一个本来隐藏很浅的问题

### INV-394a904a
- 主题：[capture-triage] learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注
- 内容：learning: [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测 [ ] 跨模块的"时间常数"（扫描间隔、闲置阈值、缓存 TTL 等）如果彼此之间有隐含的大小关系依赖，必须在设计阶段显式写一条不变量断言或注释（比如"必须保证 LOOKBACK_WINDOW > IDLE_THRESHOLD"），不能指望测试覆盖到——本次这个 bug 潜伏在 3 个独立 Task 的接缝处，任何单个 Task 的测试都…

### INV-be2b7dfe
- 主题：[agent-offline-alert] learning: theater_mismatch 检查——contract 中 android 关键词即使在排除列表也会触发，可用 windows_cloud 环境绕过
- 内容：theater_mismatch 检查机制：contract 文本中出现 android 关键词，即使在排除说明列表内，也会触发 theater 不匹配警告。可将 target_environment 设为 windows_cloud 绕过该检查，因为 agent-offline-alert 功能本身属于后端服务，不依赖 Android 真机。

### INV-f91cbfc7
- 主题：[agent-offline-alert] learning: target_environment 从 DB tasks.payload 读取，不从文件读，任务注册时必须正确设置
- 内容：target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取。务必在 POST /api/brain/tasks 注册时在 payload 中正确设置 target_environment，否则 harness 会用错环境路由。

### INV-de6a2ee1
- 主题：[agent-offline-alert] learning: Brain judge .brain-result.json 必须有顶层 exit_code + log_tail + behavior_tests[]，每条需含 exit_c…
- 内容：Brain judge API 格式要求：必须有顶层 exit_code + log_tail + behavior_tests[]（每条需 exit_code + log_tail）。缺失任一字段 judge 会报格式错误。sprint 07201705-agent-offline-alert 实证。

### INV-d976752e
- 主题：[capture-triage] learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，
- 内容：learning: [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工 [ ] DB 表字段长度约束（如 `varchar(100)`）在写入前若来源数据没有天然长度保证（如文件系统路径/目录名），必须显式截断，不能假设"看起来不会太长"——本次触发条件（嵌套 worktree 路径）就存在于开发者自己的日常工作模式里，不是边缘 case

### INV-6ede438b
- 主题：[capture-triage] learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:
- 内容：learning: [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit m [ ] 复活/重做一个曾经死过的功能前，先用 `git log --diff-filter=D` + `git show <commit>:<path>` 读退役前的真实代码，逐字核对 death cause，不要只信退役 commit message 的一句话总结——本次靠这个方法把"死因不明的历史教训"变成了"可复现、可规避的具体 …

### INV-e9c7752f
- 主题：[capture-triage] learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else`
- 内容：learning: [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见 [ ] 调用任何"失败不抛异常，返回 null/false 表示失败"契约的函数时，写完 `if (成功分支)` 一定要显式写 `else` 处理失败分支，不能只依赖外层 `try/catch`——这类"错误码而非异常"的契约在本仓库很常见（`pushCapture`/`claimDedupeKey` 等），review 时应主动搜索"…

### INV-e1d3d174
- 主题：smoke-invariant-1784543934-2387-jf
- 内容：smoke jf 铁律

### INV-33ede9f1
- 主题：smoke-invariant-1784543934-2387
- 内容：smoke 铁律

### INV-5abda98e
- 主题：[capture-triage] learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探
- 内容：learning: journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检 journey_features 表的 updated_at 长期停滞（明显早于对应 PR 合并时间）可作为 report 阶段漏跑的兜底探针信号，建议定期巡检

### INV-e83b2f0d
- 主题：[capture-triage] learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因
- 内容：learning: harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 harness-controller relay 容器可能在 Step 6(merge) 后异常退出而跳过 Step 7(report)，因为该硬约束只写在 prompt 里没有机械闸门；Brain 侧不应仅凭容器 exit code 0 判定 task 完成，应校验 pr_merged_at/notion_synced_at 等 rep…

### INV-9f14c074
- 主题：[capture-triage] learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 j
- 内容：learning: contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN contract-proposer 起草 host/环境白名单类断言时强制核对 headed 人工接管场景，本次 round1 误判直到 judge 实测才暴露、多耗 4 轮 GAN

### INV-37e0d7c9
- 主题：[capture-triage] learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task shor
- 内容：learning: headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub headed relay 点火时必须把 base_repo 或 pr_url 写入 task payload，且分支名带 task short id，否则 finalizeHarnessTask 收账守卫与 watchdog GitHub 反查双双失明（pr_not_found 拒绝 completed）

### INV-ea7d9c3e
- 主题：[capture-triage] learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（convers
- 内容：learning: [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留） [ ] 退役判断依据数据不靠记忆：本次靠查生产库实锤（cursor 状态分布/表行数/消费方 grep）拍板，避免误删活模块（conversation-consolidator 同名族但活着，已验证保留）

### INV-42a4d7c3
- 主题：[capture-triage] learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错
- 内容：learning: [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖） [ ] catch 吞错的后台 job 必须带失败计数指标，连续失败超阈值告警（inbox P1 账龄哨兵将覆盖）

### INV-1676385f
- 主题：[capture-triage] learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表
- 内容：learning: [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审 [ ] 表名认领冲突：建新表/复用表前先 grep 全部写入方，两个模块写同一张表必须 schema 对齐评审

### INV-1bd4e034
- 主题：[capture-triage] learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消
- 内容：learning: [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者） [ ] 新增后台 job 必须同时声明消费方——无下游读方的落库 job 不允许上线（inbox 统一设计已立为死规矩：每条路由必须有真实消费者）

### INV-8dbe91ee
- 主题：多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查
- 内容：1) contract-dod模板加规则：新字段与既有字段语义重叠时必须本sprint内消解或建正式decision+挂任务队列，禁止只在文档里写'留给后续技术债sprint'了事，harness-contract-reviewer遇到此类表述直接判needs_revision；2) harness-planner 4问加第5问：涉及几种设备/操作系统类型？每种是否都有对应UI区分？3) golden-path-reviewer 6维rubric加'多端完整性'维度：功能涉及多个os_type/device_platform时验收需确认展示层是否区分，不区分则FAIL；4) 已排一次全仓一次性…

### INV-113a9330
- 主题：[capture-triage] learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 gi
- 内容：learning: [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面 [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面

### INV-26a1d06e
- 主题：[capture-triage] learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-pars
- 内容：learning: [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量 [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-parse 失败回显字面量

### INV-66f41f70
- 主题：[capture-triage] learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（b
- 内容：learning: [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子 [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源（brain-deploy、git tag 向上找共享 refs、/tmp 状态文件）——SKIP 钩子逐个显式设，跳过项列在 smoke 头注释

### INV-9202c14e
- 主题：[capture-triage] learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚
- 内容：learning: [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸 [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚本尤其注意管道赋值 `|| echo ""` 兜底，grep 空结果 + pipefail 会静默炸死 set -e 脚本）

### INV-5775d866
- 主题：[capture-triage] learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用
- 内容：learning: [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱 [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用"工作区 diff"——部署根 reset 后 diff 恒空是结构性陷阱

### INV-cec579d2
- 主题：产能配比政策线（本周）：工厂 70% / 业务 30%
- 内容：planner/排序官按此配比取格子：工厂域占 70%，业务域占 30%。本周值，地基浇筑期工厂优先但业务保底不归零；判官体系+抢跑病+地图盲区闭合后上调业务比例。

### INV-51b9b095
- 主题：判官档位表：排序官/裁决类角色一律用三家旗舰（Claude=Opus 4.8 / Codex=GPT-5.6 Sol / Grok=Grok 4.5）
- 内容：额度分配器的 triage/judge 类任务档位映射：Claude→Opus 4.8；OpenAI Codex→GPT-5.6 Sol（5.6 家族旗舰，07-09 发布）；xAI→Grok 4.5（07-08 发布，Opus-class）。厂商选择仍按余额水位动态挑，档位在 vendor 内固定取旗舰。推翻此前 AI 建议的便宜档（Sonnet）——判官质量优先。

### INV-2d28de45
- 主题：工厂域上图裁决：工厂件不挂业务域的图，但工厂域自己是一个域（同一套模型/同一套闸，感知者=主理人）
- 内容：修订 golden-path-mapper Mode2 四问归家工厂件条款：删「不上 GP 地图走内部工程排期」，改为「不挂业务域的图；按四问归家归入工厂域（感知者=主理人）；共用一张账本；开发产能按主理人拍板的配比政策线分配」

### INV-ee2890bb
- 主题：cloak 跨进程死路铁证：DWM cloak 仅属主进程可用，提权路线作废
- 内容：line04 扫描态窗口隐身放弃 DWM cloak 路线（含提权变体），改走路线②挪坐标屏幕外+对称还原。cloak 只能由窗口属主进程调用

### INV-6414193b
- 主题：[capture-triage] learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFi
- 内容：learning: lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFileSync

### INV-14ed5336
- 主题：[capture-triage] learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Tes
- 内容：learning: Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑 Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑

### INV-755fb846
- 主题：[capture-triage] learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness
- 内容：learning: Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入 Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness/，防非測試文件混入

### INV-c674ab49
- 主题：[capture-triage] learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code in
- 内容：learning: 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效

### INV-55cb4cb7
- 主题：[capture-triage] learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新
- 内容：learning: 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径

### INV-e8230eb5
- 主题：[capture-triage] learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，g
- 内容：learning: harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller，generator 只推 branch 并报告 branch ready

### INV-72890f7c
- 主题：[capture-triage] learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude sessi
- 内容：learning: headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NOD headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session 内部感知 harness 上下文的变量（HARNESS_TASK_ID、HARNESS_NODE 等），必须在 innerCmd 字符串中显式 export，而非依赖 _spawnHeaded…

### INV-8d92f7b1
- 主题：[capture-triage] learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 6
- 内容：learning: Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同——本次task 63db6f8a的自动headed spawn从未走通，若照抄049ebf93先例断言会误判FAIL

### INV-1100cb8f
- 主题：[capture-triage] learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml
- 内容：learning: 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml、packages/quality/smoke-allowlist.txt 等跨 sprint 共享判定文件未经合同显式授权不可修改），遇到自身改动触发 CI 红时必须另开独立 sprint 走 G…

### INV-26886b60
- 主题：[capture-triage] learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR
- 内容：learning: PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合 PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR head SHA 核对 evaluator/judge verdict 文件锚定的 sha 与实际合并 sha 一致，确认无代码漂移后才能在报告中标注流程完整性未受损

### INV-d8366ef1
- 主题：ZenithJoy prod 数据库切换日提前至 07-14：即刻定格独立 zenithjoy 库
- 内容：prod API 运行时已于 07-14 20:30 起实际连独立 zenithjoy 库（既成事实），且两库自 07-13 快照后无分叉写入。Alex 拍板不等 07-16 切换日，立即全面向 zenithjoy 对齐所有持久化源：plist DATABASE_NAME=zenithjoy（已改）、GitHub 变量 ZJ_PROD_DB=zenithjoy（已设）、deploy-lib.sh/plist 模板/workflow 兜底默认值全部翻 zenithjoy（走 /dev）。cecelia.zenithjoy schema 自此为只读遗留，禁止任何组件再写入。

### INV-be038f9e
- 主题：部署配置漂移铁律：改环境变量/部署配置的任务必须验证持久化一致性
- 内容：任何 /dev 任务若修改了环境变量或部署配置（.env.docker、deploy-lib.sh 默认值、GitHub 仓库变量、compose 文件等），声明完成前必须同时证明两点：①运行时状态正确（容器/进程当前读到的值对）②持久化配置一致（下次正常部署/重启后仍会得到同样的值）。只验证运行时当下状态、截一张现在跑得对的图不算完成。

### INV-dc18d43d
- 主题：无闸不成文——pipeline 生命周期/记账/验收判据一律下沉代码
- 内容：①LLM 只管创造段（规划/合同/写码/修复），生命周期与记账由 Brain 按外部真相机械判定 ②接力棒保底层泛化（session 降级为加速器，缺棒由 Brain 补点火窄 prompt session），合流 initiative a2953ddc 不另起炉灶 ③EVA v3 前冻结七棒 SKILL 文本，评分口径改为条文无代码闸对应计 0 ④验收指标改业务口径：连续 5 条真实 harness_initiative 零人工完成率

### INV-264814b3
- 主题：smoke-invariant-1783850042-79911-jf
- 内容：smoke jf 铁律

### INV-552520d0
- 主题：smoke-invariant-1783850042-79911
- 内容：smoke 铁律

### INV-09fb5c69
- 主题：harness 人工救场禁用 CI 绿顶替 evaluator 验收 + 合同必须 1:1 映射 PrepPRD Golden Path
- 内容：①controller 死后人工接管合并前，必须手动补 evaluator 步骤：逐条核对 PR 交付文件清单 vs contract-dod vs PrepPRD Golden Path 每一步，缺项=不合并另立刀；CI 绿只证明已写代码没坏，证明不了该写的都写了。②GAN reviewer 审合同必须拿 PrepPRD Golden Path 逐步核对 BEHAVIOR 覆盖，步骤无对应 BEHAVIOR = REJECTED。

### INV-3efefc23
- 主题：[capture-triage] learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI
- 内容：learning: [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红 [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI 两连红

### INV-5b91a042
- 主题：[capture-triage] learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR
- 内容：learning: [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / re [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR / executor dispatch 分支 / executor override 排除 / relay loadSkill 映射 / dispatcher cap+lock+bridge 三防线

### INV-365d645a
- 主题：[capture-triage] learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d
- 内容：learning: [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a） [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机，判定点决策 d172e54a）

### INV-02e74e46
- 主题：[capture-triage] learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存
- 内容：learning: [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator [ ] 本机（美国 Mac mini）**禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务**——gui 域不存在，永不加载；用系统域 LaunchDaemon + `UserName=administrator`（bridge 先例）

### INV-b145c74a
- 主题：[capture-triage] learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest
- 内容：learning: [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTE [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest（MUST_RUN_DAEMONS / MUST_LOAD_DAEMONS / MUST_LISTEN_PORTS）

### INV-3f9594fa
- 主题：smoke-invariant-1783693282-93097-jf
- 内容：smoke jf 铁律

### INV-4b73376c
- 主题：smoke-invariant-1783693282-93097
- 内容：smoke 铁律

### INV-9216d107
- 主题：harness judge 未按 target_environment 校准证据要求(wechat-cs-reply run e74341f4 实证)
- 内容：harness-judge(Brain /api/brain/harness/judge，DeepSeek裁决)在校验前必须先读该 sprint 的 target_environment，按环境能力上限校准证据要求——local_api 环境没有真实设备、没有真实LLM key，不能要求 listen_chat.py 设备端日志或真实(非mock) LLM 调用这类结构上不可能提供的证据；judge 该看的是"evaluator PASS + CI真绿(非静默跳过)"这类该环境内可获得的证据是否齐全，而不是套用适用于 windows_wechat/linux_server 等有真实设备环境的证…

### INV-6d11717d
- 主题：harness pipeline 假阳性smoke+evaluator替代证据双缺口(wechat-cs-reply run e74341f4 实证)
- 内容：两处待修：①smoke脚本模板要求文件存在性检查(如 migration 路径查找)找不到必须 exit 1 硬失败，禁止静默跳过continue——防CI显示绿但实际没跑到；②harness-evaluator 在 target_environment=local_api 等拿不到真实DB/服务的弱环境下，禁止把"CI状态绿"直接当unverifiable项的替代证据放行——CI绿不等于该步骤真的执行过(本次S-3因①的静默跳过bug导致CI绿但从未真正跑过)，evaluator至少要核实该CI job的具体step输出里有没有跳过/未执行字样，而不是只看job结论色

### INV-ebf5cff7
- 主题：mmui 点击铁律：窗口管理自愈可用 fg+click_input，发送/回复路径禁用
- 内容：mmui 自绘按钮对 UIA Invoke 和不抢前台的 PostMessage 无响应；点击必须 AttachThreadInput 拉前台。click_input 真实鼠标注入例外仅限 _attempt_welcome_screen_heal / _reset_session_list_to_top 两个窗口管理自愈函数（test_uia_interaction.py 白名单锁死），发送/回复路径维持禁令。

### INV-76ab76ea
- 主题：relay 模式下 harness 保留 staging→production 放行层（刀4 重构）
- 内容：恢复 staging_e2e 派生：把派生逻辑从已死的图节点 mergePrNode._spawnStagingE2eTask 搬到 controller skill 的 merge 后步骤（controller merge 成功→curl 新 Brain 端点 POST /api/brain/harness/staging-e2e 建 staging_e2e 任务）。三阶段有序：①cecelia 加 staging-e2e 端点 ②zenithjoy-skills controller Step6 接线 ③验证 staging 链复活后删两个死图文件(harness-task/initiat…

### INV-e90c0fbb
- 主题：[harness缺口] relay watchdog pr_url 未写回致重复 spawn + 假失败 + 烧钱
- 内容：记录暂不修（任务终态 failed 无紧急性）。根因：harness-skill-relay controller 建 PR 后未把 pr_url 写回 tasks.pr_url/initiative_runs.pr_url；watchdog 唯一成功判据是容器消失+查到 MERGED，pr_url 空则误判死 spawn 重点火，5 次触顶 MAX_RELAY_ATTEMPTS 标 failed，每次建重复 PR 烧一整个 session。实测：任务 52145edd 5 次 spawn 建 4 个重复 PR（#3618/3621/3626/3627），其中 #3626/#3627 全绿可合…

### INV-b0b2d702
- 主题：harness pipeline 禁用于 infrastructure 仓库(重申)+judge阶段不得用subagent顶替
- 内容：1) infrastructure 仓库的任何改动一律走 /dev 直接建分支写代码,不套用 harness-controller 完整流水线——harness-judge-cli.mjs 硬编码相对路径假设跑在 cecelia 主仓根目录(scripts/../packages/brain/src/harness-judge.js),对其他 base_repo 完全不可移植,是已知未修的架构缺口(复核并重申 2026-06-01 decision 817a17eb的既有结论)。2) 若未来确实需要跨仓库跑 harness,必须先把 judge/evaluator 等硬编码路径组件做跨仓库改造…

### INV-7ccfa168
- 主题：[系统]单 slot 串行任务，并行只许跨 slot
- 内容：一个 slot/会话内严格串行执行任务——同一 slot 同时只允许一个任务在跑，任务与任务之间必须前一个收口（handoff）后才起下一个；需要并行时用多个 slot/独立 session 各跑各的任务。澄清边界：单个任务内部的子代理扇出（如 /dev Phase2 的 Agent B/C/D 三路补全、subagent-driven 的实现者+审查者）属于任务内部实现，不算违反；违反的形态=一个 slot 里两个任务并发推进。 【07-07 补充（Alex 追问后定型三层并发模型）】slot 之间随便并行；一个 slot 内任务串行；一个任务内部：只读工种（分析/补全/审查类子代理）可扇出…

### INV-06950012
- 主题：Cecelia vs ZenithJoy 载体边界
- 内容：Cecelia=本地开发+本地大脑，只在本机/云，绝不存在于 Windows/安卓设备上；ZenithJoy=客户交付物，活在客户的安卓机/Windows 机上。真机(安卓/Windows)相关的 runner/E2E/守卫一律归 ZenithJoy repo，不放 cecelia

### INV-c1d0abce
- 主题：替换核心驱动/调度器/graph 必清孤儿（migration-orphan-audit）
- 内容：替换核心驱动(如 executeTick→runScheduler)、调度器、graph 拓扑、主循环时，必须 grep 旧驱动挂的每一个副作用/安全网/节点/watchdog 的真实调用点，逐个确认「已迁到新驱动 or 显式删除」，禁止留半接线的孤儿。硬验收：grep 旧入口函数(如 executeTick)，若它只剩废弃定义、无真实生产调用→它当年挂的所有东西(超时失败/僵尸清理/恢复网/节点)全成孤儿，必须要么重新接到新驱动、要么删干净。留孤儿 = 安全网静默失效。

### INV-4d560f85
- 主题：框架原生优先，禁手搓框架已有能力（native-first）
- 内容：在 LangGraph / 任何框架上实现 retry / 持久化-resume / human-in-loop / 状态机循环 / 子图组合 之前，先查框架原生有没有。LangGraph 原生已提供：RetryPolicy(节点重试)、checkpointer+durability(状态持久化+自动恢复)、interrupt()+Command(resume)(HITL外部回填)、Send(并行扇出)、子图组合。框架做不到的(外部token→thread反查 / 死进程复活 / 外部副作用如GitHub PR状态对账)才手搓，且必须注释标明「框架做不到，因为X」。反模式信号(命中即停下抽SS…

### INV-80da99cc
- 主题：覆盖:Line04 客户名单/状态管理从飞书Bitable改为中台AI-native CRM
- 内容：旧决策(运行时配置走中台Postgres/人审名单画像走飞书Bitable)中,名单+状态部分改为走中台CRM;飞书降级为可选导出口,第一刀不接;无审批回复期没有草稿要审,飞书移动审批价值暂不存在(主动营销阶段再评估审批面)

### INV-05fb262c
- 主题：产线发布即冻结:研发不动客户版本钉子,客户跑稳定 tag,受控才升级(release 纪律)
- 内容：客户跑哪个版本只由中台 required_version 钉子决定,与 main 研发到哪解耦。①已交付产线打 stable tag 冻结(客服基线=cs-stable-v2.0.24=core 2.0.24+模块1.0.56,xian-rog 实测 mode=real+DELIVERED);②研发在 main/cp-* 往前,绝不动客户那个钉子;③测试只在独立机器(GHA windows / 测试客户机),绝不在生产客服机 xian-rog 上开发验证;④要给客户升=主动受控 bump 钉子,先测试机验。模块各自独立版本可单冻;唯一共享是 core 本体,同样照此。release分支/通道等…

### INV-04c34b86
- 主题：Line04 每客服配置 存储分层：运行时配置走中台Postgres，人审名单/画像走飞书Bitable
- 内容：按数据性质分两层：①每客服运行时配置(真发开关/营业时间/关键人/绑定微信号/生效快照)+真发gate=中台Postgres，前台客户管理页编辑，客户机轮询读；②客户名单/白名单SSOT/营销画像/审核台/互动记录=飞书Bitable，运营在飞书编辑，中台单向sync→Postgres。铁律：客户机永远只跟中台Postgres通信，绝不直连飞书。本sprint先做①(Postgres+前台)，②的飞书sync放D onboarding sprint后接。

### INV-616c9bf8
- 主题：A路线人审护栏被auto-agent gating取代
- 内容：Line04微信客服原'A路线人审护栏(approval_source禁system,AI一律不自动发必人审)'正式被auto-agent gating模型取代:auto_agent_enabled=ON+名单内+营业时间内+未超daily_limit→系统自动发(approval_source=system合法);OFF→监控态只出草稿不发;名单外→pending_human不发。安全边界从'一律人审'升级为'gated自动发'。ws3 smoke Step4旧断言相应更新。

### INV-9d2234ba
- 主题：iLink/ClawBot 微信协议彻底否决
- 内容：iLink/ClawBot 永久出局,不是 AI 客服方案,任何时候都不要再提。微信客服只有两条路:个微=pywinauto RPA(隐形替本人回客户私聊,已跑通)、陌生流量=企微官方API。删除 main 里所有 iLink 代码(ilink-client/poller/routes/env/migration)+ iLink sprint 目录

### INV-5e125909
- 主题：[系统]禁止写死环境假设值
- 内容：屏幕外坐标/UIA气泡阈值/假设调用方传X/假设.env有Y 等环境假设值禁止写死，要么从环境推导要么真机校准——这类值是接缝，必真验

### INV-3c30394c
- 主题：[系统]真环境验证才算done
- 内容：依赖真机/生产env/真实调用方的【接缝断言】必须在真目标上验证过才算done；未真验的只能标 logic-done-pending，绝不标 done。接缝清单通常1-3条，不是全功能跑真机。

### INV-056d93be
- 主题：[Line04]记忆按租户×联系人隔离
- 内容：对话记忆库按 租户×联系人 隔离,绝不串

### INV-615f57ab
- 主题：[Line04]防假成功
- 内容：发送后必须确认真发出,气泡未刷新不得判成功

### INV-c985f7e7
- 主题：[Line04]后台静默发送
- 内容：只走后台 UIA;禁前台键鼠全局注入(抢焦点/发错人)

### INV-beba0634
- 主题：[Line04]不进群
- 内容：只私聊;群一律跳过(读方向/成员结构判定,不只靠名字)

### INV-8389b6cc
- 主题：[Line04]不回自己
- 内容：只对【对方发来】的消息回,读最后一条气泡方向;永不回自己/AI发出的

### INV-55b8eb46
- 主题：[系统]测试默认多租户
- 内容：单元/E2E 测试默认种≥2个租户并断言互不串(让隔离漏洞当场暴露)

### INV-564802ee
- 主题：[系统]凭据安全
- 内容：secrets 不硬编码、不进 git、不进日志

### INV-459b6ff9
- 主题：[系统]日志脱敏
- 内容：客户隐私/PII/聊天内容不得明文进日志

### INV-50954d28
- 主题：[系统]端点鉴权
- 内容：每个 API 端点必须有 auth;无鉴权端点不准 ship

### INV-68976b17
- 主题：[系统]租户隔离
- 内容：碰租户数据的查询/写入必须 scope 到当前租户;跨租户数据绝不混读/混写

