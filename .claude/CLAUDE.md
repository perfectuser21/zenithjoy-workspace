# ZenithJoy 开发指南

## 项目概述

你正在开发 ZenithJoy 工作空间，这是 ZenithJoy 公司的核心业务平台。

---

## ⚡ 第零纪律：Walking Skeleton 优先（CRITICAL）

**产品的颗粒度是"用户路径（Journey）"，不是 feature 列表**。本 repo 已建立 walking skeleton 作战图，所有开发对照它推进。

### Path 作战图（Notion）

| Path | 类型 | Maturity | Notion |
|---|---|---|---|
| Path 1 客户首次成功 | user_facing | not_started | [Notion](https://www.notion.so/358c40c2ba6381b2a6eacd288cf82f29) |
| Path 2 客户智能获客 | user_facing | not_started | [Notion](https://www.notion.so/35ac40c2ba6381ed8df4f3fa0b64f5bf) |
| Path 4 客户私域 AI 接管 | user_facing | not_started | [Notion](https://www.notion.so/AI-35ac40c2ba6381afaf97e3bc8e3b0fb4) |

**Path 2 的步骤**（2026-07-07 用户更正：整条**去飞书、改本地**；decision 431acd2c）：
1. 注册客户端自动 ✅ done
2. 装客户端 ✅ done
3. **Android 端 Agent 连中台**（安卓独立一条，**不复用 Path 1**——Path 1 是另一套；需单独确认）
4. ~~绑客户飞书企业~~ **已删除（过时）**
5. 系统自动建 **3 张本地表**（获客画像 / 对标视频 / Lead）落**本地中台 DB**（不再是飞书 Bitable）
6. 客户在**我们本地界面/dashboard** 填获客画像（行业/关键词/钩子）+ 手填对标视频 URL（不再是飞书）
7. 手机端登录 **2-3 个抖音小号**（`agent_platform_sessions` 加 `role` `main`/`burner` 物理隔离）+ 中台**检测登录态**（`DeviceAccountScanService` 读抖音「切换账号」面板，真机待调通）
8. 评论区挖客闭环：读对标视频 → 抓 5 条评论 → 抖音号公开回评+私信带**企微号** → 企微 webhook 收加好友 → AI 首答 → 写**本地 Lead 表**

> **微信通道分工**：Path 2 走**企微**（官方 API，处理陌生流量首答 + 写本地 Lead 表）；Path 4 走**个人微信**（PoC `wechat_bot.py`/`wechat_rpa.py` 已在 xian-pc 桌面验证 wxauto4+pyautogui 跑通，Lead 自验扫码绑普通号）。两条通道互不冲突，不要混用。
> **第一刀只 1-3 个抖音小号 + 1 个对标视频 URL + 1 条评论触达**。加厚到多视频矩阵 + 自动选词必须有真实封号/限流证据驱动。
> **已验证**：第 7 步 warmup 关注 + 私信触达（Android agent）真机跑通（PR #1147）；账号登录检测（第 7 步）代码在但真机未验。

**Path 1 的 6 步**（在 `.github/workflows/scripts/smoke/golden-path-1-smoke.sh`）：
1. 注册自动登录（含 free license）
2. 装客户端 + Agent 自动连中台
3. 画像诊断（行业/受众/风格 3 字段）
4. 扫码绑定抖音主号（Agent 弹登录窗，session 存本地）
5. AI 生成 1 条内容（接 Claude API）
6. 中台派任务 + dryrun 发布 + 回执

**Path 4 的 6 步**（smoke 文件待建：`.github/workflows/scripts/smoke/golden-path-4-smoke.sh`；机器分工：**xian-rog = Lead 自检机**（所有 sprint 验证装这里），**xian-pc = 产品形态客户机样本**（将来真客户的 worker，PoC 也在这台上）：
1. 中台扫码绑**个微干净测试号**（客户 PC 上的 NodeJS Agent 启动 PC 微信客户端弹码，复用 Path 1 zenithjoy-agent 协议，扩展 `wechat-rpa` handler spawn Python 子进程）
2. 飞书 Bitable 自动建 3 张表：**客户档案**（手填客户名单 SSOT，AI 只对名单内动手）/ **营销画像**（行业/受众/钩子）/ **内容排期**（草稿审核台）
3. 名单内客户**私聊进来** → DeepSeek (via OpenRouter) 拼对话历史写回复草稿 → 写飞书"互动记录"表（待审，AI 不直接发）
4. 中台定时触发"今日朋友圈" → DeepSeek 拼营销画像写文案草稿 → 写飞书"内容排期"表（待审）
5. 用户在飞书审批 → 批准后系统 spawn `wechat_rpa.py` 真发（私聊指定客户 / 朋友圈**分组可见**），强制频控（≤1 圈/24h、≤2 私聊/分钟、≤50 私聊/天/号、单次操作间隔 ≥1s）
6. 发布回执（成功/失败 + 原因）回写飞书"内容排期"+"互动记录"表

> **个微 + LLM agent 通道纪律**：thin 阶段 = PoC 当底（xian-pc 桌面 `wechat_bot.py`/`wechat_rpa.py` 已验证 wxauto4+pyautogui） + A 路线护栏（飞书审核台，AI 草稿不自动发）。MiniMax PoC key 不入 git，sprint 1 第一刀切 OpenRouter DeepSeek（已就绪 `~/.credentials/openrouter.env`）。
> **第一刀只 1 个干净测试号 + 1 个客户名单 + 1 种主动动作（朋友圈每日 1 条）**。私聊只**被动回**，不主动发起新会话。多号矩阵 + 主动 outreach + 完全自主 AI agent 加厚阶段才上，必须有真实业务证据驱动。

### 4 条铁律（违反 = PR 被拒）

1. **每个 PR 必须推进 `golden-path-1-smoke.sh` 至少多过一关**。PR 描述强制声明：「本 PR 把 Path X 的 Step Y 从 ❌/🔴 推到 ✅」。
2. **多 Path 可并行启 sprint，但每个 sprint 必须显式声明推进哪条 Path 的哪些 Step**。Path 1 必须保持推进态势（不允许停滞 ≥2 周），Path 2/4 启 sprint 不阻塞 Path 1。新加 feature 的想法对照各 Path 步骤检查 — 不在任何 Path 上 → backlog。
3. **新 Feature 默认 thin**。要建 medium/thick 必须通过 `/dev` 路径C 走 harness 加厚流程（含 `replaces_old_thin` 删旧文件证据）。
4. **加厚是"先减肥再增肌"**：升级 thickness 必须两段式 commit：`commit 1 删旧 mock/hardcode` → `commit 2 写新实现`。改名 `_legacy` / TODO 注释不算删除。

### 调用 harness-planner 前必填 4 问

```
□ 1. 本 sprint 推进哪条 Journey？（名 + Notion URL + 当前 Maturity）
□ 2. 涉及几个角色？多角色必须拆多个 sprint，CI/部署 = 独立 dev_pipeline Journey
□ 3. 推进哪些 Feature？(每个 Feature 标 Journey Step N + thickness from→to)
□ 4. Feature 0 端到端 smoke = golden-path-1-smoke.sh 跑到 Step <K>，FAIL = 整 sprint FAIL
```

不填齐 4 问，**禁止启动 harness-planner**。

### 触发 /dev 路径C 的场景

任何"我想做 X 功能"、"加个 feature"、"feature 该多厚"、"开 sprint" 等问题 — 走 `/dev` 路径C（Harness），强制 anchor 到 4 条 Journey 上。

---

## 开发原则

### 1. 代码质量
- 所有代码必须通过 ESLint 和 TypeScript 检查
- 保持代码简洁、可读、可维护
- 遵循 DRY（Don't Repeat Yourself）原则
- 使用有意义的变量名和函数名

### 2. 安全第一
- 永远不要在代码中硬编码敏感信息
- 使用环境变量管理配置
- 所有 API 端点必须有适当的认证和授权
- 定期更新依赖以修复安全漏洞

### 3. 性能优化
- 避免不必要的重新渲染
- 使用懒加载和代码分割
- 优化数据库查询
- 实施适当的缓存策略

## 项目结构

```
zenithjoy/
├── workspace/          # 主工作空间前端
│   ├── src/
│   ├── public/
│   └── package.json
├── creator/           # 内容创作系统
│   ├── frontend/
│   ├── backend/
│   └── docker-compose.yml
├── geoai/            # 地理 AI 系统
│   ├── api/
│   ├── models/
│   └── utils/
├── workflows/        # 自动化工作流
│   ├── n8n/
│   └── custom/
└── JNSY-Label/      # 标签管理系统
    ├── server/
    └── client/
```

## 开发工作流

### 1. 功能开发
```bash
# 1. 从 develop 创建功能分支
git checkout develop
git pull origin develop
git checkout -b feature/your-feature-name

# 2. 开发和提交
git add .
git commit -m "feat: your feature description"

# 3. 推送并创建 PR
git push origin feature/your-feature-name
# 在 GitHub 上创建 PR 到 develop
```

### 2. Bug 修复
```bash
# 紧急修复走 hotfix 分支
git checkout main
git checkout -b hotfix/bug-description

# 修复后合并到 main 和 develop
```

### 3. 代码审查
- 所有代码必须经过 PR 审查
- 至少需要一个审查者批准
- CI 检查必须全部通过

## API 规范

### RESTful 设计
```
GET    /api/resources     # 获取列表
GET    /api/resources/:id # 获取单个
POST   /api/resources     # 创建
PUT    /api/resources/:id # 更新
DELETE /api/resources/:id # 删除
```

### 响应格式
```json
{
  "success": true,
  "data": {},
  "message": "操作成功",
  "timestamp": "2026-02-15T12:00:00Z"
}
```

### 错误处理
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {}
  },
  "timestamp": "2026-02-15T12:00:00Z"
}
```

## 数据库规范

### 命名约定
- 表名: 小写，复数形式，下划线分隔
- 字段名: 小写，下划线分隔
- 索引名: idx_表名_字段名

### 必要字段
每个表都应包含:
- id: 主键
- created_at: 创建时间
- updated_at: 更新时间
- deleted_at: 软删除时间（如需要）

## 前端规范

### 组件设计
- 使用函数组件和 Hooks
- 组件职责单一
- 使用 TypeScript 定义 Props
- 提供默认 Props 值

### 状态管理
- 本地状态使用 useState/useReducer
- 全局状态使用 Context API 或状态管理库
- 异步数据使用 React Query 或 SWR

### 样式规范
- 使用 CSS Modules 或 styled-components
- 遵循 BEM 命名规范
- 响应式设计优先
- 支持暗色模式

## E2E-First 开发规则（CRITICAL）

**核心原则：先定义"完成"长什么样子，再写实现。**

### ZenithJoy 的 E2E 分层

| 功能类型 | E2E 形式 | 存放位置 |
|---------|---------|--------|
| API 新端点 | curl smoke test | `.github/workflows/scripts/smoke/<feature>-smoke.sh` |
| Dashboard 新页面/交互 | Playwright test | `apps/dashboard/e2e/<feature>.spec.ts` |
| Worker 新行为 | curl + API 验证 smoke | `.github/workflows/scripts/smoke/<feature>-smoke.sh` |
| Python 服务新逻辑 | pytest E2E | `services/<name>/tests/e2e/test_<feature>.py` |

### 开发顺序（强制，不得跳过）

```
commit-1：写失败的 E2E/smoke test（定义"什么叫完成"）
commit-2：写实现，让 E2E 通过，同时包含 unit tests
```

**第一个 commit 必须是 E2E/smoke，不是 unit test，不是实现。**
违反顺序 → CI `lint-tdd-commit-order` 拦截 → 无法合并。

### 什么算合格的 E2E/smoke

- smoke.sh：含 `curl`/`psql`/`node` 真实链路调用，≥5 行实质内容，不是 `exit 0` 占位
- Playwright：`.spec.ts`，测真实浏览器行为，不是 mock
- pytest E2E：调真实 API endpoint，不是 mock

### 违反会怎样

- `lint-feature-has-smoke`：feat: PR 改了 `apps/*/src/` 但没有 smoke.sh → CI 失败
- `lint-tdd-commit-order`：src 文件比 test 文件先出现在 commit 历史 → CI 失败

## 测试要求

### 测试层级（按写作顺序）
1. **E2E / smoke test**：先写，定义验收条件
2. **集成测试**：模块边界验证
3. **单元测试**：函数级别，与实现同步写

### 测试覆盖率
- 目标覆盖率: 80%
- 关键业务逻辑: 100%
- 新功能必须先有 E2E，再有实现

## 部署流程

### 环境管理
- 开发环境: develop 分支自动部署
- 测试环境: release/* 分支
- 生产环境: main 分支，需手动确认

### 部署检查清单
- [ ] 代码审查通过
- [ ] 所有测试通过
- [ ] 文档更新完成
- [ ] 数据库迁移准备就绪
- [ ] 回滚方案准备

## 监控和日志

### 日志级别
- ERROR: 错误信息
- WARN: 警告信息
- INFO: 一般信息
- DEBUG: 调试信息

### 监控指标
- 应用性能 (APM)
- 错误率和错误类型
- API 响应时间
- 数据库查询性能

## 常见问题

### Q: 如何处理敏感配置？
A: 使用 .env 文件，确保在 .gitignore 中，提供 .env.example

### Q: 如何处理大文件？
A: 使用 NAS 存储，数据库只存储文件路径

### Q: 如何优化性能？
A: 使用缓存、CDN、代码分割、懒加载等技术

## 联系方式

- 项目负责人: Perfect21
- 技术支持: 通过 Cecelia 系统
- 紧急联系: 查看团队文档

---

最后更新: 2026-02-15
版本: 1.0.0