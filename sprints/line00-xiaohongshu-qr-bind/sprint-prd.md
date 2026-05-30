# Sprint PRD

## 产品目标

运营员当前无法通过 Dashboard 绑定小红书账号，因为 Agent 的登录检测 cookie 名写错、Chrome 端口也指向了抖音实例。本次修复让运营员能正常完成小红书扫码绑定，并将 session 存入 `XIAOHONGSHU_COOKIES` GitHub Secret，供日常巡检使用。

## 功能清单

- [ ] Feature 1: 小红书扫码绑定正常检测登录 — Agent 在扫码完成后能正确识别 `galaxy_creator_session_info` cookie，判定登录成功
- [ ] Feature 2: Agent 连接正确的小红书 Chrome 实例 — spawn 时使用 19224 端口而非抖音的 19222，避免 CDP 连错浏览器
- [ ] Feature 3: 单元测试覆盖小红书场景 — 针对小红书的 cookie 名和端口注入有明确断言，不退化到抖音测试

## 验收标准（用户视角）

### Feature 1
- 运营员扫码登录小红书后，系统能识别登录成功，继续上传 cookies 到中台
- 当 `webId` cookie 出现但 `galaxy_creator_session_info` 未出现时，系统不误判为已登录

### Feature 2
- Agent spawn 时自动使用 `ZENITHJOY_CHROME_DEBUG_PORT=19224`（小红书专用），不影响抖音的 19222
- 其余 7 个平台的端口行为不受影响

### Feature 3
- 新增测试：小红书 cookie 名断言（`galaxy_creator_session_info` 返回 true，`webId` 返回 false）
- 新增测试：CDP 端口注入断言（xiaohongshu spawn 时 env 含 `ZENITHJOY_CHROME_DEBUG_PORT=19224`）
- 所有现有测试继续通过

## 不在范围内

- Dashboard UI 变更
- `check-health.js` 修改（已正确使用 `galaxy_creator_session_info`）
- 其他平台（抖音、快手等）的 cookie 或端口改动
- GitHub Secret 写入逻辑（上传 API 已存在，本次不改）
