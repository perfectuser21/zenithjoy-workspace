# Learning: PipelineOutputPage 高级化重设计

**分支**: cp-03310742-dashboard-premium-redesign
**日期**: 2026-03-31
**类型**: fix + feat

---

## 问题根因

### 1. HTTPS Mixed Content（P0）
Brain API 返回图片 URL 为 `http://38.23.47.81:9998/images/xxx.png`，但 Dashboard 部署在 HTTPS 域名下，浏览器强制拦截 HTTP 资源请求，导致所有图片不显示。

**解决**：双层方案
- **nginx 层**：在 hk-vps 的 nginx.conf 新增 `/content-images/` location，通过 Tailscale IP `100.71.151.105:9998` 代理到图片服务器（绕过公网 HTTP）
- **前端层**：`fetchOutput` 中用 `rewriteImageUrl()` 将 `http://38.23.47.81:9998/images/` 替换为 `/content-images/`

**关键陷阱**：nginx.conf 用 `sed -i` 修改后，文件 inode 改变，Docker bind mount 容器仍读旧 inode → 必须 `docker restart autopilot-prod` 才能生效（不是 `nginx -s reload`）。

### 2. Emoji → 彩色圆点
`PLATFORMS` 数组去掉 emoji 字段，改为品牌色 `color` 字段；所有平台列表改用 `<div>` 彩色圆点 + `box-shadow` 光晕效果替代 emoji。

### 3. 默认 tab 改为 generation
从 `useState('summary')` 改为 `useState('generation')`，确保用户打开页面立即看到图片内容而非纯文字统计。

### 4. Hero 封面图
Hero 区域用 flexbox 分左（文字）右（封面图）布局，找 `type === 'cover'` 的图片在右侧展示缩略图，点击可打开灯箱。

---

## 技术要点

| 问题 | 工具 | 关键点 |
|------|------|--------|
| HTTP 图片 on HTTPS | nginx proxy_pass | 走 Tailscale 内网，避免公网 HTTP |
| Docker bind mount | docker restart | sed -i 改变 inode，reload 不够 |
| Mixed Content 前端 | URL rewrite 函数 | 只替换特定 origin，不影响其他 URL |

---

## DoD 验证方式

所有 4 条 DoD 用 `node -e` 直接读文件内容验证，无需启动服务：
- 检查 `content-images` 字符串是否存在
- 检查是否有 emoji（Unicode range `\u{1F300}-\u{1F9FF}`）
- 检查默认 tab 是否为 `'generation'`
- 检查 `requestFullscreen` 是否存在

---

## 部署备注

nginx 代理已提前在 hk-vps 配置并验证（`/content-images/dankoe-cover.png` 返回 `image/png`）。前端代码通过 PR 合并后正常构建部署即可，无需额外 nginx 操作。
