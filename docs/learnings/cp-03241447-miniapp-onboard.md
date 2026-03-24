# Learning: miniapp-onboard

## 背景
将微信小程序（Coze-AI-Assistant）从 zip 包迁移进 ZenithJoy monorepo。

## 关键学习

### monorepo workspaces 与 lock 文件
- 根 `package.json` 使用 `"workspaces": ["apps/*"]`，新增 `apps/miniapp` 后必须跑根目录 `npm install` 更新 `package-lock.json`
- 遗漏 lock 文件更新 → L3 CI（Security Audit）报 `npm ci` 失败

### 微信小程序迁移清单
- `project.private.config.json` 含敏感信息（密钥ID），必须加入 .gitignore 并不提交
- 原项目嵌套了重复目录（`Coze-AI-Assistant/Coze-AI-Assistant/`），rsync 时需手动清理

## 结果
PR #88 合并，`apps/miniapp` 正式进入 monorepo，与 `apps/geoai` 平级。
