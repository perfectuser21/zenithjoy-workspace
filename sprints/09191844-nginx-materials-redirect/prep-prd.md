# Bug PrepPRD：nginx /api/materials 无尾斜杠请求被301降级到http，浏览器报Network Error

## 症状
用户访问 https://staging-autopilot.zenjoymedia.media 的素材库页面，报 "Network Error"。

## 根因假设（已通过本地复现证实，非假设）
`materials.api.ts` 的 `listMaterials()` 请求 `GET /api/materials`（无尾斜杠）。
`deploy/nginx.staging.conf`（及生产同款 `deploy/nginx.conf`）只有
`location /api/materials/`（带尾斜杠，为大文件上传超时/体积单独放开），没有
覆盖不带斜杠的精确路径。nginx 对此发出 301 补斜杠重定向，Location 头用
`http://`（该 nginx 层只 `listen 80`，不知道外层是 https）。浏览器把这个
https→http 的跳转当 mixed content 拦截，axios 侧只能看到无信息量的
"Network Error"。

已用 `docker run nginx:1.27-alpine` 加载真实配置文件（proxy_pass 目标换成本机
占位端口做隔离）复现出字节级一致的 301/http 现象；二分（去掉 `/api/materials/`
块后请求改为落到 `/api/` 通用块正常尝试代理，无重定向）确认根因就是
`location /api/materials/` 块本身，与 Express 应用代码无关（另起最小 Express
复现，同样挂法返回 200，排除应用层问题）。

## 关联上下文
- 相关 Journey/Ability：批量混剪（本次会话主线）前端页面依赖的素材库列表 API，属于既有、更早期上线的素材管理功能，非本次混剪新增代码。
- 相关 Issue：无匹配（issues 列表已查，无同类记录）。
- 相关历史决策：无匹配（decisions/match 查询为空）。

## 修法
`deploy/nginx.staging.conf` 和 `deploy/nginx.conf` 各加一条
`location = /api/materials { ... }` 精确匹配块（配置与既有
`location /api/materials/` 相同的大文件超时/体积参数），proxy_pass 到后端
去掉尾斜杠的同名路径。这样带斜杠、不带斜杠、子路径三种请求形态都能正确
命中大文件超时配置并正常代理，不再触发 nginx 自动补斜杠重定向。

## Regression Test 计划
本次改动是纯 nginx 配置文件（无 Node/TS 代码），仓库里没有对 nginx 配置跑
真实容器的 CI 测试基础设施，也没有现成的 nginx-config smoke 测试模式可复用。
守卫形态选择：**环境接缝守卫**（见下方哨兵段），而非逻辑 regression test——
用一个 smoke 脚本在 CI 里用真实 `nginx:1.27-alpine` 容器加载改动后的配置文件，
断言 `GET /api/materials`（无尾斜杠）返回值不是 3xx 重定向到 http，永久留在
CI smoke glob 里跑，防止以后又有人加一条不成对的带斜杠 location 块。

## 验收标准
- [x] 本地 docker nginx 真实配置文件复现问题（3种请求形态均301至http）
- [x] 修复后本地同样容器验证：3种请求形态均改为尝试正常代理（502，因无真实后端，非重定向）
- [ ] 新增 CI smoke 脚本固化此验证，注册进 test-registry.yaml + smoke-baseline.txt
- [ ] CI 全绿
- [ ] 部署到 staging 后用 curl 对真实域名复测确认无重定向
