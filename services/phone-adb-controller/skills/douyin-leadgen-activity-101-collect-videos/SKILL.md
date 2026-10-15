---
name: douyin-leadgen-activity-101-collect-videos
description: 按关键词交出筛选后的视频链接。用于采集关键词搜索结果或接手同一视频发现 Activity；不执行整个工作流。
metadata:
  version: 0.1.0
  activity_ref: douyin_video_discovery.collect_videos
  activity_version: 4.0.0
  validation: awaiting-real-run
  support_files:
    - services/phone-adb-controller/skills/leadgen-activity-execution.md
---

# 按关键词交出筛选后的视频链接

仅执行 `douyin_video_discovery.collect_videos`。业务合同版本为 `4.0.0`；方法版本独立记录，不因生成代码而更换Activity身份。

先读取[共同执行与升级约束](../leadgen-activity-execution.md)，再读本轮冻结的[所属工作流Skill](../douyin-leadgen-101/SKILL.md)中与本活动有关的配置、复用来源和授权。输入输出、验收探针以[正式Activity合同](../../../../product-map/contracts/douyin_video_discovery.yaml)的 `collect_videos` 为准；本文件不覆盖该合同或公司政策。

## 输入输出

- 输入 `Keyword`：`line_key`、`word`。
- 输入 `Device`：`serial`、`lock_holder`。
- 输入 `Run`：`run_tag`。
- 输入 `SearchRequest`：`keywords`、`sort`、`time_layer`、`location`、`target_count`、`max_duration_s`。
- 输出 `Video`：`line_key`、`video_id`、`video_url`、`title`、`keyword`、`comment_count`、`harvest_batch`、`author`。
- 输出 `Run`：`status`、`stop_reason`、`all_results_scanned`。

公司、task/run、截止、源码及执行权从本次正式绑定读取。缺字段保持缺失并报告，不从示例或其他租户补。

## 方法

1. 从本任务或该公司已启用配置取关键词、排序、时间与地区条件、数量和截止；记录真实来源。新鲜树确认关键词、视频页签及筛选生效。
2. 逐屏识别真实视频卡片，跳过相关搜索词块、广告和加载占位。点开前刷新树，按当前节点定位，不沿用旧屏坐标。
3. 逐个打开视频、取分享链接并解析真实 video_id，核对当前详情与返回链接身份。复制失败不复用上一条链接，标题相同不直接认定为重复。
4. 按当前公司正式接口小批持久化，并独立读回ID、链接和归属；同真实ID幂等复用另计。101不按业务资格筛掉视频。
5. 真实点赞/评论数保留原值与观测证据；缺值记unknown。现代码未满足指标持久化时保留metrics_persistence_missing，不拿卡片数冒互动指标。
6. 回搜索现场继续剩余卡片，再滑动等待加载。数量、截止、停滞分别记停止原因；“暂无更多，查看所有内容”若未验证后半句含义，不宣称搜尽全部AI视频。

## 代码配套与验收

配套代码取正式合同 `implementation_bindings` 的全部 `kind=code` 项，并按本轮冻结源码校验；由 `leadgen-activity-methods.lock.json` 固定本Skill和代码集合。代码文件存在不代表可由Agent直接调用，公共入口以[当前调用映射](../douyin-leadgen-101/references/runtime-calls.json)为准。

按正式合同的后置探针、原始证据及持久化读回验收；区分Code结果、Skill接手结果和清理结果。当前单Activity公开执行入口尚未提供，本Skill未完成独立实机接手验收，不能把完整 `leadgen-run.sh` 或 `leadgen-activity.sh` 当成单步救场执行。
