# 小改动 PrepPRD：刀B2 D8 视觉接线 —— 搜索结果截图选对行治 NO_MATCH 假负
## 归属 AI on-call 视觉后端安卓段。锚 line02/keyword_acquisition keep-green。
## 改什么
DouyinDmOutreachService 私信搜号 D8：切用户tab后、盲赌 tapTopUserResult 之前，
tryVisionSelectResultRow(截图复用 AgentService.sharedScreenCaptureService→locator-assist
mode=vision_select→match_index)；idx>0 点对应行(0.44w, rowFractionForIndex(idx)h,
荣耀X30实测 row0=0.21h pitch=0.084h)；null/-1/0 退回盲赌第一行。verifyProfileMatchesDouyinId
仍最终闸——最坏等于今天不退化。LocatorAssistClient 加 vision 请求/解析/行坐标(纯逻辑JVM测)。
bump 2.1.42。
## 为什么 目标没排第一时盲赌点错人→误判NO_MATCH(有线索够不着)。视觉纠正点对行=治这个假负。
## 验收 commit RED守卫+纯逻辑测试/Kotlin CI编译/总装真机验NO_MATCH被治
