## 抖音对标账号搜索脚本（2026-04-27）

### 根本原因

需要一个可从命令行直接调用的脚本，连接本机已登录 Chrome，通过抖音内部搜索 API 采集对标账号数据。

### 下次预防

- [x] CDP 连接统一用 `chromium.connectOverCDP`，与现有 publishers 保持一致
- [x] 数据获取走 `page.evaluate` + fetch，不解析 DOM，规避页面结构变动风险
- [x] 纯函数 `parseUser` / `buildSearchUrl` 导出，便于单元测试
- [x] 登录检测走 `/passport/account/info/v2/`，未登录时等待扫码（3 分钟超时）
- [x] 结果写入 `~/.platform-data/douyin-competitor/` JSON 文件
