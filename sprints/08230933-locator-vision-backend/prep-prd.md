# 小改动 PrepPRD：刀B1 视觉后端 —— 截图选结果治 NO_MATCH（Lynx失明页）
## 归属 AI on-call 视觉后端中台段。锚 line02/keyword_acquisition keep-green。
## 改什么
locator-assist 加 mode=vision_select：截图 base64→TOAPIS 通用视觉模型(gemini-2.5-flash-official,
判定链同款,image_url 调法)→答"第几个结果匹配目标抖音号"(match_index,-1=无匹配诚实说不瞎选)。
不查缓存(结果页每次不同)；thinking 模型预算抬到 2000(PR#1684 教训)；fail-open。
病历 mode=vision_select。0823 主理人纠正:用 TOAPIS 通用视觉,不自托管 UI-TARS 不开火山。
安卓 D8 截图接线为 B2。删刀2a 遗留的 UITARS 插座(改走 TOAPIS)。
## 真调实证
真截图(荣耀X30 抖音"美食"用户结果页,Lynx 失明)真调:目标 SHENSHEN20110820→match_index=2 正确;
不存在号→-1。端点全链路含病历落库验过。
## 验收 commit-1测试先行/commit-2转绿+回归+tsc+env-gate/CI全绿
