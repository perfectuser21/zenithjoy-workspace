# Bug PrepPRD：私信搜索提交/tab切换靠 ACTION_CLICK 无效(抖音不可点TextView)

## 症状
locate-fix-v1(#1138)后仍 NO_MATCH：搜索没提交出结果(树里只剩搜索框+搜索按钮，无结果tab)，
坐标点无落点。

## 根因(真机dump实锤)
抖音 39.4.0 的"搜索"按钮是 clickable=false 的 TextView(content-desc="搜索")，"用户"tab 同理是
clickable=false Button。无障碍 ACTION_CLICK 对它们静默无效(页面不动)；IME_ENTER 提交也常不触发。
只有坐标点它们的 bounds 中心才生效(同抖音搜索结果行的坐标点法)。

## 修法(真机 proven)
tapNodeCenter(node)=读 getBoundsInScreen 坐标点中心。
- 搜索提交：坐标点"搜索"按钮(content-desc/text)中心，IME_ENTER 兜底。
- 切"用户"tab：坐标点其中心。
- 坐标盲点结果行前加 await+SEARCH_MS 等渲染。

## 真机验收(proven-to-fire)
demo-dm5 outcome=SENT：搜133643315→用户tab→点进伯都呀伯都主页→verifyProfileMatchesDouyinId验证
→点赞热身("你赞了…刚刚")→发私信(蓝色气泡)→回执确认。截图为证。

## 验收标准
- [x] 真机 c/d 全链 SENT(截图证)
- [ ] CI 全绿
