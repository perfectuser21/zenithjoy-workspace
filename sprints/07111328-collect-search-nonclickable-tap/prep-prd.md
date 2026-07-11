# Bug PrepPRD：抖音采集 NO_SEARCH_INPUT — 搜索入口 ACTION_CLICK 对 clickable=false 节点空操作

## 症状
荣耀 100 真机 Stage1 采集必失败，服务端 error_code=NO_SEARCH_INPUT（任务 6f83b730 / f20b20b1 均复现）。
从未走到取链步（captureShareUrlForCard），更早一步的"打开搜索页"就挂了 → 采不到任何真实 video_id。

## 根因（真机 uiautomator dump 实测确认，Douyin 39.5.0）
`openSearchBar()`（DouyinCollectService.kt:289-295）对 `findNodeByContentDesc(root,"搜索")`
找到的节点调用 `performAction(ACTION_CLICK)`。但真机 dump 证明该"搜索" TextView（resource-id 混淆为 4ty）
**整条无障碍祖先链 clickable 全为 false**（顶层 FrameLayout → … → fl_intput_hint_container → xqi → TextView，
无一 clickable=true）。Android 的 performAction(ACTION_CLICK) 不会冒泡到祖先，对非可点击节点是空操作 →
页面不跳转到搜索输入页 → 之后 `awaitRootInActiveWindow` 抓到的仍是首页 feed（无 EditText）→
`typeKeyword` 的 findFirstEditText 返回 null → finishWithError("NO_SEARCH_INPUT")。
（手动 `input tap 1097 184` 原始坐标注入能成功跳 SearchResultActivity，证明触摸有效、只是无障碍 ACTION_CLICK 无效。）

## 关联上下文
- 相关 Journey/Ability：Line02 智能获客 / 抖音评论区采集（Stage1 搜索→取链）
- 同类已修先例：`triggerSearch()`（同文件 356-380）早已发现"确认按钮及所有祖先 clickable=false，
  必须用 tapNodeCenter 手势坐标"，并已用 `tapNodeCenter` 修复。**同一 bug 在 openSearchBar 第一步没修。**
- 相关历史决策：bug C（share-intent 取真实 video_id，PR#1226/#1227）— 本 bug 是它的前置拦路虎

## 修法
1. companion object 新增纯函数 `mustGestureTap(clickableChain: List<Boolean>): Boolean = clickableChain.none { it }`
   —— 给定目标节点到根的 clickable 链，判定是否必须退回坐标手势点击（整条链无可点击节点时 true）。
2. 新增实例辅助 `clickNodeRobustly(node)`：沿 parent 链收集 clickable；`mustGestureTap` 为 true → `tapNodeCenter(node)`；
   否则对链上最近的可点击节点 performAction(ACTION_CLICK)。
3. `openSearchBar()` 把 `searchBtn.performAction(ACTION_CLICK)` 换成 `clickNodeRobustly(searchBtn)`。
（最小改动，不动 triggerSearch —— 它已用 tapNodeCenter 工作正常。）

## Regression Test 计划
`DouyinCollectServiceStateTest` 新增 `mustGestureTap` 用例（纯函数，JVM 跑，永久留 CI）：
- 全 false 链（本 bug 真机场景）→ true
- 节点自身 clickable → false
- 某祖先 clickable → false
- 空链 → true（防御）

## 守卫（proven-to-fire）
- 逻辑守卫：上面的 mustGestureTap 单测（先写→红→实现→绿，亲眼见红）。
- 环境守卫：服务运行时 finishWithError("NO_SEARCH_INPUT") 上报服务端 error_code（真机断了会红），
  + 真机 E2E 复验（采到 ≥10 位纯数字 video_id 落库）= 环境接缝自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 真机复验：Stage1 不再 NO_SEARCH_INPUT，采到 ≥1 条真实 video_id（≥10 位纯数字）落库
- [ ] 已为本 bug 配 proven-to-fire 守卫（亲眼看它报红过一次）
- [ ] CI 全绿
