---
name: douyin-leadgen-activity-102-qualification
description: 交出有证据的视频资格结论。用于核对目标视频、录音转写并按公司政策判断资格或接手同一 Activity；不执行整个工作流。
metadata:
  version: 0.1.3
  activity_ref: douyin_video_processing.qualification
  activity_version: 3.2.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出有证据的视频资格结论

仅执行 `douyin_video_processing.qualification`。业务合同版本为 `3.2.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `qualification` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Video`：`line_key`、`video_id`、`video_url`、`title`、`comment_count`、`judgment_status`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输出 `Video`：`judgment_status`、`judgment_reason`、`transcript`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 用真实视频ID进入详情，核对当前页面确为本轮目标；前台、包UID和播放器归属均留原证。 MMV显式开启设备执行的qualification，在原预检已核公司与账号后，先续期并精确核当前run锁，确认本profile不存在活跃或无法确定的受管录音，再经同owner关闭抖音并直接打开本VID；随后重新取真实分享链接核本VID。该开页边界不猜SDK，不改变M4、identity或collection路径，也不把多音轨改判成可录。
2. 先实读Android SDK原件；SDK≥33仅选同版3.3.4日志刷新补丁固定客户端与对应server，保留原playback音源、audio-dup、require-audio、Matroska与原编解码选择；不得使用SDK31包或旧brew录制绕过就绪门禁。两类SDK都须成对验client/server固定SHA、同owner有界无覆盖server准备，首末保存同一runtime原件名与SHA，停止后fresh SDK须与启动原件一致。SDK31仅在本run显式设备owner核验、已验收补丁客户端与server精确SHA校验及有界无覆盖jar准备成功后，使用独立output音源、no-video、raw PCM与WAV；这是已核的显式策略，不是失败后自动回退。SDK32、未知SDK、未安装runtime或校验不符保持unsupported/pending。SDK31必须保存私有runtime原件与SHA，起止client/server/原件名及SHA一致，停止后实解码唯一pcm_s16le音轨且无视频轨，必须decoder退出0、真实样本数/采样率/解码秒数达到本次请求80%、私有解码原件SHA及退出后原生恢复原件供queue/Workflow独立核验；首末原生音轨归属、无其他started媒体和退出恢复仍须成立。模式、SDK、required、实际音轨数量及SDK原件名/SHA必须进入本轮proof，起止两端一致，并由qualification独立核验。复用已部署录制与音轨核验方法，分别核对实际媒体音量、native播放/静音状态、真实录像及音轨。设置回显不能代替实际读回；轨道started但标记muted不能直接放行。
3. 播放控件仅从本次完整新树定位：本包、唯一“播放视频，按钮”或“暂停视频，按钮”、enabled/clickable及合法屏幕bounds；不依赖混淆resource-id，也不凭文案决定播放阶段，动作前后都须原生音轨核验。仅当本包UID/详情前台、唯一started音轨且静音原因只有streamVolume/portVolume、没有受管活录制时，按键紧前必须fresh核同包唯一stream/port候选；若已started则不按键，未知或外来轨道立即拒绝。允许一次已核正数音量→邻近非零档→原档刷新；UP已提交但读回未知/不符时只允许绝对恢复明确非零原档并读回，仍保失败，不起录；每次读回必须成立，恢复后fresh唯一started且muted none才启动录制。未知/外UID/共享UID/解析失败/多音轨不能借恢复放行。录制停止后另存退出后原生恢复证据，持续失败保pending，不重启或kill未知进程。
4. SDK/模式未知、require-audio缺失、音轨不符或捕获静音属于捕获/合同能力缺口，不以UI点击、音量循环或Skill重试放行。倍速设置、录制启动或停止失败时保留最早stderr、exit code、阶段和已有证据。proof中media_volume=null只表示未记录，不能据此推断音量0，或把native音轨首错改写成音量失败。
5. 核对真实采集媒体时长、实际播放速度、提取音频和转写证据，只有达到当前正式合同才调用原公司资格政策。缺真实音频/转写记unknown，不伪造合格。playback_dup被App opt-out、缺音轨或录音静音只证明捕获未知，保持pending，不能借此把原视频内容判rejected；不使用标题或旧ASR兜底。
6. 缓存结论仅在同视频身份、同公司和政策版本均相符时复用。逐VID交付matched/rejected/unknown和证据；仅合格视频交给评论采集。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。单Activity接手入口为原run的 `activity-skill-tool.mjs <broker-request.json> inspect|phone|resume`；只能使用本次持久handoff给出的冻结路径，不能自己建request、换run或直接启动Workflow。源码接线与Skill实机接手验收分别记证据，当前方法仍 awaiting-real-run。

## 本方法的真实接手入口

Code失败、分类与有限安全重试后，由原run的handoff broker持有同一Activity闭包、身份、资源和截止。真实work-commander父会话经官方sessions_spawn派本Skill子会话；先核原request/nonce及自己的绑定。只调用本次给出的工具路径：`inspect`读取实际进度；`phone`经stdin JSON `{command,args}`仅读证或受控归位；必要时 `resume`仅继续当前slot的成熟Code一次。不得构造新Workflow、改源码/策略/账号/暂停或另取/释放锁。

`send_dm`失败一律readback_only，不能resume或点击发送；没有确定发送证据保持unknown。Skill交付不直接写成功，原进程按原verify/Step/PG读回独立裁判。子会话终态未知保留资源，不能清场干扰未知执行者。没有正式已绑定子会话或source/method/预算不符即blocked。
