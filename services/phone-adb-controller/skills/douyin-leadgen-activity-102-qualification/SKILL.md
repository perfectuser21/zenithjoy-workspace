---
name: douyin-leadgen-activity-102-qualification
description: 交出有证据的视频资格结论。用于核对目标视频、录音转写并按公司政策判断资格或接手同一 Activity；不执行整个工作流。
metadata:
  version: 0.1.1
  activity_ref: douyin_video_processing.qualification
  activity_version: 3.1.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 交出有证据的视频资格结论

仅执行 `douyin_video_processing.qualification`。业务合同版本为 `3.1.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-102/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_processing.yaml)的 `qualification` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Video`：`line_key`、`video_id`、`video_url`、`title`、`comment_count`、`judgment_status`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输出 `Video`：`judgment_status`、`judgment_reason`、`transcript`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 用真实视频ID进入详情，核对当前页面确为本轮目标；前台、包UID和播放器归属均留原证。
2. 复用已部署录制与音轨核验方法，分别核对实际媒体音量、native播放/静音状态、真实录像及音轨。设置回显不能代替实际读回；轨道started但标记muted不能直接放行。
3. 仅当本包UID/详情前台、唯一started音轨且静音原因只有streamVolume/portVolume、没有受管活录制时，允许一次已核正数音量→邻近非零档→原档刷新；每次读回必须成立，恢复后fresh唯一started且muted none才启动录制。未知/外UID/共享UID/解析失败/多音轨不能借恢复放行。录制停止后另存退出后原生恢复证据，持续失败保pending，不重启或kill未知进程。
4. 录制启动失败时保留最早stderr、exit code、阶段和已有证据。proof中media_volume=null只表示未记录，不能据此推断音量0，或把native音轨首错改写成音量失败。
5. 核对录像时长、实际播放速度、提取音频和转写证据，只有达到当前正式合同才调用原公司资格政策。缺真实音频/转写记unknown，不伪造合格。
6. 缓存结论仅在同视频身份、同公司和政策版本均相符时复用。逐VID交付matched/rejected/unknown和证据；仅合格视频交给评论采集。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-102/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
