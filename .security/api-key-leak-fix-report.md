# API Key 泄露安全漏洞修复报告

**报告时间**: 2026-02-13
**处理人**: 安全修复专家
**优先级**: 🔴🔴🔴 P0 - 极高危
**状态**: ⚠️ 本地修复完成，等待 Key 轮换

## 🚨 漏洞概述

ToAPI 视频生成服务的 API Key **已泄露到 GitHub 公开仓库历史中**。

### 泄露的敏感信息

```
VITE_TOAPIS_API_KEY=sk-ccsVuyLUFAIMALCrfm5rBqZZCJf5CKAOdIdUYzOOcm3sPQhO
```

**泄露位置**:
- 仓库：`https://github.com/perfectuser21/zenithjoy-workspace.git`
- 文件：`apps/dashboard/.env.production`
- Commits（已推送到 GitHub develop 分支）：
  - `f5d5241` - "fix: 修复 AI 视频生成 API 认证问题" (2026-02-12 11:03:34)
  - `35dd0b3` - "fix: add ToAPI API key to production env" (2026-02-12 11:53:49)

### 风险评估

| 项目 | 状态 | 影响 |
|------|------|------|
| **Git 历史泄露** | ✅ 已确认 | 高 |
| **GitHub 公开** | 🔴 **已确认** | **极高** |
| **第三方访问** | ⚠️ 可能 | 未知 |
| **Key 使用范围** | ToAPI 视频生成 | 中 |
| **财务影响** | ⚠️ 潜在成本风险 | 待评估 |

**🔴 紧急警告**：任何访问 GitHub 仓库的人都可以从历史中提取此 Key。

## ✅ 已完成的修复措施（本地）

### 1. 移除敏感信息
- ✅ 从 `.env.production` 删除明文 API Key
- ✅ 改为注释形式：`# VITE_TOAPIS_API_KEY=`
- ✅ 从 Git 追踪中移除：`git rm --cached`

### 2. 加固 .gitignore
添加规则到 `apps/dashboard/.gitignore`：
```gitignore
.env.production
.env.development
```

验证结果：
```bash
$ git check-ignore -v apps/dashboard/.env.production
apps/dashboard/.gitignore:14:.env.production
```
✅ `.gitignore` 规则生效

### 3. 凭据安全存储
- ✅ 创建 `~/.credentials/toapi.env`
- ✅ 设置严格权限 `chmod 600`
- ✅ 记录泄露事件和轮换标记

### 4. 暂存修复 Commit
```bash
$ git status
Changes to be committed:
  deleted:    apps/dashboard/.env.production
  modified:   apps/dashboard/.gitignore
```

## 🔴 **必须立即执行的操作**

### 1. 轮换 API Key（最高优先级，15分钟内完成）

**操作步骤**：
```bash
# 1. 登录 ToAPI 平台
open https://toapis.com/dashboard

# 2. 撤销旧 Key
# Key ID: sk-ccsVuyLUFAIMALCrfm5rBqZZCJf5CKAOdIdUYzOOcm3sPQhO
# 点击 "Revoke" 或 "Delete"

# 3. 生成新 Key
# 点击 "Create API Key"
# 复制新 Key

# 4. 更新本地凭据
vi ~/.credentials/toapi.env
# 替换为新 Key

# 5. 更新生产环境
# 方式 A: 直接在香港 VPS 上设置环境变量
ssh hk
export VITE_TOAPIS_API_KEY="新-Key"
docker restart autopilot-prod

# 方式 B: 通过 Cloudflare Tunnel 环境变量（推荐）
# 在 Cloudflare Dashboard 设置环境变量
```

### 2. 提交修复 Commit

```bash
cd /home/xx/perfect21/zenithjoy/workspace

# 提交 .gitignore 修复
git add apps/dashboard/.gitignore
git commit -m "security: 防止 .env 文件被提交

- 添加 .env.production 和 .env.development 到 .gitignore
- 从 Git 追踪中移除 .env.production
- 修复 ToAPI API Key 泄露问题（Key 已轮换）

Security-Fix: API Key Leak
Severity: Critical
Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"

# 推送修复
git push origin develop
```

### 3. 清理 Git 历史（可选，但推荐）

由于 Key 已公开，清理历史的意义有限，但仍建议执行：

```bash
# 安装 git-filter-repo
pip3 install git-filter-repo

# 备份仓库
cd /tmp
git clone --mirror https://github.com/perfectuser21/zenithjoy-workspace.git
cd zenithjoy-workspace.git

# 从所有历史中删除文件
git filter-repo --path apps/dashboard/.env.production --invert-paths --force

# 强制推送（⚠️ 需要团队协调）
git push origin --force --all
git push origin --force --tags

# ⚠️ 所有协作者需要重新 clone 仓库
```

**团队协调**：
- [ ] 通知所有开发者
- [ ] 等待所有人确认本地工作已保存
- [ ] 执行强制推送
- [ ] 要求所有人重新 clone

### 4. 安全审计

检查是否有其他泄露：
```bash
cd /home/xx/perfect21/zenithjoy/workspace

# 搜索其他可能的敏感信息
git log -p --all | grep -iE "api[_-]?key|secret|password|token" | grep -v "VITE_TOAPIS" | head -50

# 检查当前工作区
grep -rI "sk-" apps/ --exclude-dir=node_modules --exclude-dir=dist

# 检查飞书凭据
git log -p --all | grep -E "cli_a9cfdbab|ou_d3df5bb2"
```

## 📊 影响评估

### 潜在风险

1. **未授权视频生成**
   - 第三方可能使用泄露的 Key 生成视频
   - 产生额外的 ToAPI 费用

2. **数据泄露**
   - 可能查看账户使用记录
   - 可能获取生成的视频内容

3. **服务中断**
   - 恶意用户耗尽配额
   - 导致正常服务不可用

### 缓解措施

- [x] 本地移除明文 Key
- [x] 加固 .gitignore
- [x] 安全存储凭据
- [ ] **轮换 API Key（阻塞项）**
- [ ] 提交修复 commit
- [ ] 监控 ToAPI 使用量
- [ ] 设置费用告警

## 🔍 根因分析

### 为什么会泄露？

1. **操作失误**：
   - 直接在 `.env.production` 文件中写入 API Key
   - 未检查 `.gitignore` 规则

2. **.gitignore 不完整**：
   - 原规则：`.env`, `.env.local`, `.env.*.local`
   - 未覆盖：`.env.production`, `.env.development`

3. **缺少预防机制**：
   - 无 Pre-commit Hook 检测敏感信息
   - 无 CI/CD Secret Scanning
   - 无定期安全审计

### 正确的做法

#### 开发环境
```bash
# apps/dashboard/.env.development (不提交，在 .gitignore 中)
VITE_TOAPIS_API_KEY=dev-key-here
```

#### 生产环境（推荐方案）

**方案 A：环境变量注入（最安全）**
```bash
# 在部署脚本中注入
source ~/.credentials/toapi.env
export VITE_TOAPIS_API_KEY=$TOAPI_API_KEY

# 或使用 CI/CD Secrets
# GitHub Actions: ${{ secrets.TOAPI_API_KEY }}
```

**方案 B：模板文件（可提交）**
```bash
# apps/dashboard/.env.production.template
# ToAPI API Key (视频生成) - 从环境变量读取
# VITE_TOAPIS_API_KEY=

# 部署时复制并填充
cp .env.production.template .env.production
echo "VITE_TOAPIS_API_KEY=$TOAPI_API_KEY" >> .env.production
```

## 📋 长期预防措施

### 技术措施

1. **Pre-commit Hook**
```bash
# .husky/pre-commit
#!/bin/sh
# 检测敏感信息
if git diff --cached | grep -iE "api[_-]?key|secret|password.*="; then
  echo "❌ 检测到敏感信息，提交被阻止"
  exit 1
fi
```

2. **CI/CD Secret Scanning**
```yaml
# .github/workflows/security.yml
- name: Secret Scanning
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
```

3. **定期 Key 轮换**
   - 每 90 天自动轮换
   - 使用 Key 管理服务（如 Vault）

### 流程措施

1. **团队培训**
   - 凭据管理最佳实践
   - `.env` 文件安全规范
   - Git 历史清理方法

2. **代码审查清单**
   - [ ] 检查 `.env` 文件
   - [ ] 验证 `.gitignore` 规则
   - [ ] 确认无硬编码密钥

3. **安全审计**
   - 每月一次 Git 历史扫描
   - 每季度一次全面安全评估

## 📞 后续跟进

### 待办事项

| 优先级 | 任务 | 负责人 | 截止时间 | 状态 |
|--------|------|--------|----------|------|
| P0 | 轮换 ToAPI API Key | DevOps | 立即（15分钟内） | ⏳ 待执行 |
| P0 | 监控 ToAPI 异常使用 | Security | 1小时内 | ⏳ 待执行 |
| P1 | 提交修复 commit | 安全专家 | 完成 Key 轮换后 | ⏳ 待执行 |
| P1 | 清理 Git 历史 | DevOps | 1天内 | ⏳ 待执行 |
| P2 | 实施 Pre-commit Hook | DevOps | 1周内 | ⏳ 待执行 |
| P2 | 添加 CI Secret Scanning | DevOps | 1周内 | ⏳ 待执行 |
| P3 | 团队安全培训 | Security | 2周内 | ⏳ 待执行 |

### 验收标准

- [ ] ToAPI API Key 已轮换
- [ ] 旧 Key 已撤销（验证无法使用）
- [ ] 生产环境使用新 Key（验证视频生成正常）
- [ ] `.gitignore` 修复已合并到 main
- [ ] 最近 48 小时无异常 ToAPI 使用记录
- [ ] Pre-commit Hook 已部署并测试

## 📚 参考资料

- [GitHub Secret Scanning](https://docs.github.com/en/code-security/secret-scanning)
- [git-filter-repo Documentation](https://github.com/newren/git-filter-repo)
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)

---

## 🎯 更新：后端代理实现完成（2026-02-13 16:30）

### 实现的安全架构

```
前端（不再持有 Key）
    ↓ 调用后端 API
后端（持有 Key）
    ↓ 调用 ToAPI
    ↓ 保存到数据库
ToAPI
```

### 完成的修改

#### 后端（apps/api）
1. **新建** `src/clients/toapi.client.ts` - ToAPI 客户端类（238 行）
   - 封装所有 ToAPI API 调用
   - 从 `process.env.TOAPI_API_KEY` 读取（不是 VITE_）
   - 处理 ToAPI 响应格式和各种 bug

2. **修改** `src/services/ai-video.service.ts`
   - `createGeneration()` 调用 ToAPI 创建任务，获取 ID
   - `getGenerationById()` 从 ToAPI 同步最新状态
   - 自动更新数据库缓存

3. **配置** `.env` 和 `.env.example`
   - 添加 `TOAPI_API_KEY=...`（从 ~/.credentials/toapi.env 读取）

#### 前端（apps/dashboard）
1. **修改** `src/api/ai-video.api.ts`
   - 移除 `id` 字段（由后端生成）
   - 添加 `image_urls` 字段

2. **重构** `src/api/platforms/toapi.ts`（-181 行，+55 行）
   - ❌ 删除 `getApiToken()`（不再需要）
   - ❌ 删除所有直接 ToAPI 调用
   - ✅ 改为调用 `aiVideoApi.createGeneration()`
   - ✅ 改为调用 `aiVideoApi.getGenerationById()`

3. **加固** `.gitignore`
   - 添加 `.env.production` 和 `.env.development`

### 代码统计

```
9 files changed, 350 insertions(+), 226 deletions(-)

核心新增：
- apps/api/src/clients/toapi.client.ts (238 行)
- 后端 ToAPI 集成逻辑 (79 行)

核心简化：
- apps/dashboard/src/api/platforms/toapi.ts (净减少 126 行)
```

### 安全验证

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 前端无 API Key | ✅ 已验证 | getApiToken() 已删除 |
| 后端持有 Key | ✅ 已验证 | process.env.TOAPI_API_KEY |
| .gitignore 保护 | ✅ 已验证 | .env.production 已加入 |
| Git 历史清理 | ⏳ 待执行 | 需轮换 Key 后执行 |
| 功能测试 | ⏳ 待执行 | 需启动服务测试 |

### 待完成（步骤 7）

**功能验证**：
1. 启动后端 API 服务
2. 启动前端开发服务器
3. 在 AI 视频页面生成测试视频
4. 验证后端代理正常工作
5. 验证数据库正确记录

---

**最后更新**: 2026-02-13 16:30
**状态**: ⚠️ 后端代理已实现，等待功能验证和 Key 轮换
**联系人**:
- Security Team: security@zenjoymedia.media
- DevOps: devops@zenjoymedia.media
