---
name: douyin-leadgen-104
description: 执行已授权抖音获客104线索触达与写回，核对公司、发送账号、原生目标身份及批准话术。用于独立消费合格队列或代码异常接手；结果未知先读回，同一动作不重复发送。
metadata:
  version: 0.2.3
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/douyin-leadgen-104/references/reuse-map.json
    - services/phone-adb-controller/skills/douyin-leadgen-104/references/runtime-calls.json
    - services/phone-adb-controller/skills/douyin-leadgen-104/references/activity-methods.json
---

# 104 · 线索触达与写回

首版可加载 Skill，本版发送及异常接手验收待执行。仅在本任务已获授权的公司、账号、对象、话术和额度内执行，已有会话授权持续有效，无须重复索要。

## Activity 方法配套

本工作流的方法依赖真身见[Activity方法清单](references/activity-methods.json)。执行指定Activity时，按本轮冻结 `activities[].implementations` 的真实name/version/source/digest及execution_path加载对应独立Skill；不能把本工作流Skill当作每个Activity的同一份方法。

- `douyin_lead_outreach.preflight` → `douyin-leadgen-activity-104-preflight@0.1.1`。
- `douyin_lead_outreach.send_dm` → `douyin-leadgen-activity-104-send-dm@0.1.1`。
- `douyin_lead_outreach.write_back` → `douyin-leadgen-activity-104-write-back@0.1.1`。
- `douyin_lead_outreach.cleanup` → `douyin-leadgen-activity-104-cleanup@0.1.1`。

Activity方法、支持文件或合同改变时，更新对应方法版本、所有消费者清单、本工作流Skill与Commander Skill版本；纯代码内部兼容优化用明确兼容评估绑定前后代码集合。先跑 `npm run leadgen:methods:check`，再做相应独立验收。方法配套完成不表示单Activity执行权交接已经接通。

## 复用已有Skill

按 [复用来源与校验值](references/reuse-map.json) 加载 `social-lead-outreach` 和 `douyin-phone-runtime` 的精确发送账号/目标/正文、单次发送、气泡核验与清理方法，复用当前canonical队列、prepared防重复和原行写回。

旧Skill的“本run先有delivery工件”、V4画布身份、旧claim表和写入fence不自动适用于本版独立104。使用当前已发布领取/准备/写回协议；不能复制旧claim另开第二发送路径，也不能绕过现有暂停。代码接手Skill必须共享持久动作身份与执行权，这份文件没有自动安装该接缝。

先按 reuse-map 的 `sha256` 核对旧 `SKILL.md` 字节后读取。`path` 只表示当前MMV已核安装位置，不保证其他宿主存在；缺失或不同只能从记录的固定 `repo` / `revision` / `source_path` 读取同字节参考，仍不可读则阻断对应接手。参考说明不等于已部署可执行工具，实际执行仍核本次正式冻结包。

## 调用范围与当前接口

阅读 [当前正式调用映射](references/runtime-calls.json)。`mode=workflow` 执行本流程全部合同；只有现有整段代码满足本轮目标时才使用其中完整入口，不把旧Code成功计成新版新增要求已完成。`mode=activity` 只执行任务指定、已冻结的 Activity；缺合法单步入口、写入授权或执行权交接时报告具体缺口，不用 `leadgen-activity.sh` 冒充单步入口，也不绕过冻结绑定直调裸队列。来源已变更须重新固定与验证，不能沿用旧元数据。

## 输入与输出

输入真实task_id/run_id、公司/业务线与配置版本、host/profile/serial/发送账号、允许的目标范围、批准话术/模板引用、数量/期限及现行限额。默认独立消费该公司已交付、资格合格的canonical订单队列，不要求103运行号，也不等待整批103。

输出订单与目标稳定ID、发送账号、批准话术引用、发送前后原生证据、实际发送/限制/未知状态、原行写回与读回、清理结果。空队列、暂停、限额、账号阻断分别记，不能算发送成功。

## 执行

1. 登记/认领任务，固定实际Skill/代码/公司配置。确认公司已启用，平台账号核验有效且绑定本profile/serial；仅能从该公司批准的话术库取内容，不现场编造测试消息。
2. 取得中央serial租约与本地设备锁；按 `android-publish` 检查在线、通话、账号和现场。共享ADB/网络不重启；其他任务持锁即退让。检查公司现行暂停、限额、冷却和风险状态；Skill接手不能绕过暂停或频控。已有授权的迁移暂停只能走精确、可回读的恢复操作，不能全局删flag。
3. 复用原canonical队列及订单锁领取资格已通过、实际交付已确认的订单。查持久prepared/已发送/历史触达及其他有效执行者，排除已发送和未决目标。未知身份或资格不合格的行不可发。
4. 根据订单原生主页/账号链接进入目标，核对稳定UID/抖音号、订单对应身份和当前发送账号。若链接被App降级为相似账号搜索，必须重新核对目标；仅昵称相似不能放行。
5. 在外部发送前，使用原持久动作身份和prepared记录确认本任务独占执行权；保存目标、发送账号、准确内容、发送前会话证据。Agent与代码共用同一记录。没有可用的持久防重复/交接接口则停在blocked，不另造一套临时状态后发送。
6. 调用已发布发送原语执行一次。点击后核对同一会话、准确内容和新消息证据；已有旧消息不能冒充本轮新增。平台限制/验证码等按现场回报，不自动重试发送。
7. 发送已证实时，使用原写回接口更新原订单并读回。发送结果未知、超时、进程死亡或写回失败时，先查原动作、会话和原行；不能凭退出码或换成Skill再发送一次。结果持续未知则保持未决，保留证据和恢复条件。
8. 到业务截止不再取新单，完成可安全核对的写回和收尾；关闭App、回安全桌面，释放自己的订单/设备锁与中央租约并回读。无法确认旧执行者停止时不强放锁，不启动竞争发送者。

## 原实现的数据外发与调用记录

已核线索身份、原公司策略和活动回执按原实现送OpenRouter资格判定/Commander；发送话术送抖音的已核目标，实际发送结果写回该公司原PG/飞书队列。正常定位使用原生树，实际触发视觉兜底才外发截图及定位描述；不另送音频或改评分。服务/模型以本次冻结代码与已批准配置为准，不在救场中新增外发接收方。密钥不进提示词、正文或回执。逐类保存真实provider/model/response_id、实际调用次数、失败和unknown；以RPC、ASR、视觉及bridge原回执统计，不能用脚本动作数代替模型次数，也不能把缺失回执计为零。

## Commander 接手与验收

Commander 接到异常时先核原动作的外部结果、执行权与剩余期限，再交配套Skill续接。已发未写回只补核验/写回，不能重发；尚未执行的动作须在权限和独占权确认后执行。救场不现场改代码、不换账号绕风控、不扩大名单或额度。

独立核验实际接收者、发送账号、批准内容、恰好一次发送、原行写回及清理；只证明已发送，不推断已送达/已读。Code失败保留，Skill救场结果另记；未决不得记completed。创建本Skill不表示Brain已接入自动触发。

来源：[今日Skill/Code与Commander规则](https://app.notion.com/p/3f5c40c2ba6381acbad0d31ee3215f92)，发送政策继续引用本公司的原批准配置。

## 单Activity受控接手

当前源码提供 `leadgen-activity-v1`：仅在原冻结run内Code失败与有限安全重试之后，由真实work-commander父会话派官方Skill child，使用原run私有broker逐Activity接手。`activity-skill-tool.mjs` 不是新任务启动器；inspect/受限phone/一次当前slot resume均受同源方法、绑定、资源和截止约束。子会话终态未知保锁，发送未知只读回。最后仍由原独立verify与持久读回决定成功，不以Agent自述或CLI exit0替代验收。当前源码存在不等于实机接手已验收，具体状态查看当前任务事件与发布观测。

MMV手机执行按[当前调用映射](references/runtime-calls.json)显式设置 `LEADGEN_MMV_DEVICE_RUNTIME=1`，核本机唯一启用的profile/serial和既有ADB端口。随后仍须原公司冻结资料、verified账号/设备绑定及手机当前账号全部通过；公司draft、缺登记或桥未就绪即停，不借金诺或其他租户配置兜底。该设备入口不扩大本轮输入、预算或发送授权。
