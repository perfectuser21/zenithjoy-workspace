# Bug PrepPRD：抖音私信定位主页在 39.4.0 失效(搜索结果不进无障碍树)

## 症状
真机(Honor 100 / 抖音 39.4.0)触发 dm_outreach，locateProfileBySearch 报 NO_DM_ENTRY，
从未真正打开目标主页。

## 根因(实锤)
uiautomator dump 实测：SearchResultActivity 的搜索结果列表【完全不进无障碍树】(自定义/Lynx
渲染)，树里只有搜索框 EditText + tab 标签。于是：
1. collectAllNodeTexts 拿不到任何结果行文本；matchProfileByDouyinId(搜索结果) 恒 NO_MATCH，
   或反被搜索框回显的裸 id 骗成假 UNIQUE → findNodeByText 点了搜索框自己 → 走到私信步骤 NO_DM_ENTRY。
2. 定位逻辑没切「用户」tab(默认 tab 搜纯数字抖音号结果为空)。
3. DM 入口只按 content-desc "私信" 找，但主页按钮文本是"发私信"。

## 修法(已在真机验证每步可行)
坐标盲点顶部结果进主页(精确抖音号匹配永远排第一)，主页页面【进树】(含 "抖音号：<id>")：
1. 搜索提交后点「用户」tab。
2. dispatchGesture 坐标点顶部结果行。
3. await UserProfileActivity → verifyProfileMatchesDouyinId(主页文本, 目标) 验证点对了人；
   对不上则中止(NO_MATCH)，保证不误发给错的人。
4. DM 入口补按文本"发私信"/"私信"查找。

## Regression Test
verifyProfileMatchesDouyinId 纯函数：认"抖音号：<id>"前缀行=命中，裸 id 回显不命中(搜索框陷阱)，
错 id 不命中。坐标点/tab 切换属真机环境接缝，真机 proven-to-fire 验证(截图为证)。

## 验收标准
- [x] verifyProfileMatchesDouyinId RED→GREEN
- [ ] 真机 c/d：定位到 133643315 主页 + 发私信送达
- [ ] CI 全绿
