---
name: douyin-leadgen-102
description: 执行抖音获客102视频处理：验证101来源、领取待处理视频、判断资格并按评论量采集持久化。用于普通、深采或自动策略及代码异常接手；不修改评分标准或执行私信。
metadata:
  version: 0.2.2
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/douyin-leadgen-102/references/reuse-map.json
    - services/phone-adb-controller/skills/douyin-leadgen-102/references/runtime-calls.json
    - services/phone-adb-controller/skills/douyin-leadgen-102/references/activity-methods.json
---

# 102 · 视频处理与评论采集

首版可加载 Skill，本版实机验收待执行；不把文档、局部测速或旧版成功当成本版生产通过。

## Activity 方法配套

本工作流的方法依赖真身见[Activity方法清单](references/activity-methods.json)。执行指定Activity时，按本轮冻结 `activities[].implementations` 的真实name/version/source/digest及execution_path加载对应独立Skill；不能把本工作流Skill当作每个Activity的同一份方法。

- `douyin_video_processing.preflight` → `douyin-leadgen-activity-102-preflight@0.1.0`。
- `douyin_video_processing.dedup` → `douyin-leadgen-activity-102-dedup@0.1.0`。
- `douyin_video_processing.qualification` → `douyin-leadgen-activity-102-qualification@0.1.0`。
- `douyin_video_processing.collection` → `douyin-leadgen-activity-102-collection@0.1.0`。
- `douyin_video_processing.cleanup` → `douyin-leadgen-activity-102-cleanup@0.1.0`。

Activity方法、支持文件或合同改变时，更新对应方法版本、所有消费者清单、本工作流Skill与Commander Skill版本；纯代码内部兼容优化用明确兼容评估绑定前后代码集合。先跑 `npm run leadgen:methods:check`，再做相应独立验收。方法配套完成不表示单Activity执行权交接已经接通。

## 复用已有Skill

按 [复用来源与校验值](references/reuse-map.json) 加载 `social-video-qualifier`、`social-comment-lead-collector` 和 `douyin-phone-runtime` 的适用操作。复用视频深链、录音/ASR工件核验、评论区读取、原生评论人身份和部分成果保存；不重新发明这些动作。

旧Skill不能直接作为本版完整入口：保留当前公司的原资格政策及正式录音覆盖验收，不因旧文档的“已设置3倍速”回显就推断实际播放速度；无数字不当0；连续无新增不当真实页尾；累计计数/屏号不当稳定游标；5条采样和深采分别记。旧n8n写入围栏、原始池和阶段身份只在实际调用器提供兼容协议时采用，否则使用当前正式队列/事务/原生证据接口，不能自行伪造fence。

先按 reuse-map 的 `sha256` 核对旧 `SKILL.md` 字节后读取。`path` 只表示当前MMV已核安装位置，不保证其他宿主存在；缺失或不同只能从记录的固定 `repo` / `revision` / `source_path` 读取同字节参考，仍不可读则阻断对应接手。参考说明不等于已部署可执行工具，实际执行仍核本次正式冻结包。

## 调用范围与当前接口

阅读 [当前正式调用映射](references/runtime-calls.json)。`mode=workflow` 执行本流程全部合同；只有现有整段代码满足本轮目标时才使用其中完整入口，不把旧Code成功计成新版新增要求已完成。`mode=activity` 只执行任务指定、已冻结的 Activity；缺合法单步入口、写入授权或执行权交接时报告具体缺口，不用 `leadgen-activity.sh` 冒充单步入口，也不绕过冻结绑定直调裸队列。来源已变更须重新固定与验证，不能沿用旧元数据。

101引用的共享preflight/cleanup只执行对应设备动作，不进入102业务；以本次冻结Workflow的实际共享Activity引用核对范围。预检/收尾只有同任务受托执行权才可操作，不能顺手搜索或领取视频。

## 输入与交付

输入真实任务/运行身份、公司配置版本、host/profile/serial/目标账号、可验证的101来源、策略 ordinary/deep/auto、视频范围、采样或尽量采集目标、完整字段要求、总截止与独立保存/收尾预算。采样条数由任务提供；原授权首轮每合格视频5条仍有效，不能静默扩大成深采。没有正式确认的夜间时窗不自行设置定时器。

输出逐视频资格、判定依据、评论原件及身份来源、实际新增/历史复用/重复数、持久化读回、采集范围、停止原因与清理结果。页面评论总量与已采条数分开；未展开回复不能宣称全量。

## 执行

1. 登记/认领任务，核对公司启用状态、产品/目标客户和原视频资格政策。固定 Skill、已部署代码、配置及输入来源；版本/输入不明先报缺口，不重标旧运行来源。
2. 手机操作使用 `android-publish` 的设备协议，取得中央与本地锁；核对 profile、serial、实际账号和空闲通话状态。103 不在本机等待它占锁执行。
3. 从授权范围选择待处理视频，验证真实101 run、视频ID、公司、业务线、来源证据及PG行。优先复用正式队列领取与租约，排除已合法完成、已确认不合格或被有效租约持有的行。同一来源可按原有已发布入口处理；跨批处理须有逐视频来源和持久原子认领支持。缺这些支持时报告具体队列缺口，不能直接删掉原 intake/source 守卫或用“最新目录”代替来源。
4. 普通策略领真实评论数不超过500的视频；深采领超过500的视频；自动策略在范围内补读未知指标并选预算。unknown 不当零。分档由101提供，打开后复核；预检不承担业务分档。没有延长授权不突破原总预算。
5. 用实际视频ID打开并核对当前视频，复用已部署录音/播放核验、转写和原资格判断。没有真实录音或转写证据记 unknown，不伪判合格；缓存判断仅在同公司政策版本与真实身份一致时复用。只有资格合格的视频进入评论采集。
6. 打开评论区，逐屏读取并小批提交。保留正式字段合同要求的正文、时间、地区、评论人稳定身份、主页/视频链接及原生关联证据；只采昵称正文的测速脚本不能冒充完整102。优先真实评论ID去重；缺ID时用视频、稳定评论人、完整正文等组合，说明近似去重局限。
7. 每批提交后读回实际行，分别累计 inserted、history_verified、duplicates、coverage；失败批不计入已提交。优先复用既有事务、评论历史核验和采样读回，不另写一套评分或业务计数。
8. 达到任务采样配额可结束本次采样，标 sampled/quota_reached，不标整条视频采尽。50或500是实现上限/分档边界，命中不等于到底。尽量采集目标下，仅在明确页尾、范围说明和提交读回齐全时标本范围完成；否则 partial，保存累计数和最后成功批次。
9. 业务截止后不再领新视频，留出提交与清理预算。持久记录来源、视频身份、已提交集合、停止原因和恢复入口；关闭App、释放自己的租约和设备锁并读回。

## 原实现的数据外发与调用记录

实际录制音频送阿里云DashScope的Qwen ASR；视频标题、转写和冻结公司资格政策送OpenRouter的Jev及原疑难兜底模型；评论及原生账号证据写原PG，活动证据送原Commander。正常定位使用原生树，实际视觉兜底才外发截图及定位描述。服务/模型以本次冻结代码与已批准配置为准，不在救场中新增外发接收方。密钥不进提示词、正文或回执。逐类保存真实provider/model/response_id、实际调用次数、失败和unknown；以RPC、ASR、视觉及bridge原回执统计，不能用脚本动作数代替模型次数，也不能把缺失回执计为零。

## Commander 与中断恢复

代码为采集主体，Agent/Commander 接收摘要与异常，不把所有评论堆入上下文。代码失败后由 Commander 核对旧执行者、锁及外部结果，再把同一 Activity 交给本 Skill；同一任务目标、身份和截止不变，不现场改代码。

现场仍在：重读当前树并核对视频后续采，不复用旧坐标。现场丢失：重开目标、重扫并按已提交记录去重；累计计数不是可靠位置游标。缺安全执行权交接、结果未知或锁冲突时保留 blocked，不并起第二采集器。失败运行的采样不能兑现配额。

## 验收

核对每条采集的来源/资格/原生身份、PG新增与历史消费读回、采样范围、完成或partial语义、截止与清理。独立核验使用相同业务合同；Code失败与Skill救场分开记录。本版正常模式与跨批深采分别验证，不用一个5条样本代表所有档位。

来源：[今日101/102方案](https://app.notion.com/p/3f9c40c2ba6381dea615c39380c78e66)、[Skill/Code配套规则](https://app.notion.com/p/3f5c40c2ba6381acbad0d31ee3215f92)。

## 单Activity受控接手

当前源码提供 `leadgen-activity-v1`：仅在原冻结run内Code失败与有限安全重试之后，由真实work-commander父会话派官方Skill child，使用原run私有broker逐Activity接手。`activity-skill-tool.mjs` 不是新任务启动器；inspect/受限phone/一次当前slot resume均受同源方法、绑定、资源和截止约束。子会话终态未知保锁，发送未知只读回。最后仍由原独立verify与持久读回决定成功，不以Agent自述或CLI exit0替代验收。当前源码存在不等于实机接手已验收，具体状态查看当前任务事件与发布观测。
