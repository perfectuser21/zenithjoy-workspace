# wechat-rpa Self-Hosted Runner 路由设计

## 背景与根因

Harness pipeline 对 wechat-rpa sprint 产生假绿的根因链：

1. PrepPRD 未声明 `target_environment`（或默认 `windows_cloud`）
2. Evaluator 触发 `e2e-windows.yml`（`runs-on: windows-latest`，GitHub 云 VM）
3. windows-latest 无微信客户端、无 uiautomation 树
4. 测试只验证 `listen_chat.py --dryrun-print-version`（文件能 import，不验证 RPA 行为）
5. 真实 RPA 行为（发消息/读消息/监听）从未被 CI 验证 → 假绿

## 解决方案：三层护栏

### 层 1：PrepPRD 阶段（最早 — 源头识别）

`~/.claude-account1/skills/dev/SKILL.md` PrepPRD 模板更新：
- `target_environment` 成为 Harness sprint **必填字段**
- AI 检测到以下关键词时自动建议 `windows_wechat`：
  `wechat-rpa / pyautogui / RPA / 个微 / 微信监听 / listen_chat / wxauto`
- 完整可选值：`mac_web | windows_cloud | windows_wechat | linux_server | local_api`

### 层 2：Harness Evaluator 路由（中间 — cecelia）

`packages/workflows/skills/harness-evaluator/SKILL.md` 更新：
- 新增 `windows_wechat` case
- 路由到 `e2e-wechat-rpa.yml`（zenithjoy-workspace repo，self-hosted runner）
- 现有 `windows_cloud` → `e2e-windows.yml` 不变

| target_environment | 触发 workflow | Runner |
|---|---|---|
| `windows_wechat` | `e2e-wechat-rpa.yml` | self-hosted xian-rog |
| `windows_cloud` | `e2e-windows.yml` | windows-latest |
| `mac_web` | `e2e-mac.yml` | macos-latest |

### 层 3：GitHub Actions Workflow（执行层 — zenithjoy）

**改动 A：`wechat-cs-e2e.yml` job2**
- `runs-on: windows-latest` → `runs-on: [self-hosted, wechat-capable]`
- 移除 `actions/setup-python@v5`（xian-rog 已装 Python 3.11 embedded）

**改动 B：`e2e-wechat-rpa.yml`（新建）**
- `runs-on: [self-hosted, wechat-capable]`
- `workflow_dispatch` inputs：`task_id / sprint_dir / pr_branch`
- 执行 `sprint_dir/e2e-verify.ps1`（与 `e2e-windows.yml` 逻辑相同，runner 不同）

## Self-Hosted Runner 规格

| 属性 | 值 |
|---|---|
| 机器 | xian-rog（i9-13980HX 24核，长期开机） |
| Runner 名 | `xian-rog-wechat` |
| Labels | `self-hosted, Windows, X64, wechat-capable` |
| 状态 | online（v2.334.0，Windows Service 运行） |
| 微信版本 | 4.1.8.107（锁版本，保证 uiautomation 可用） |
| Python | 3.11 embedded（已在 `services/agent/install-pack/`） |
| RPA 库 | uiautomation + pyautogui（已装） |

## 产物清单

| 产物 | Repo | 操作 |
|---|---|---|
| `.github/workflows/wechat-cs-e2e.yml` | zenithjoy | 修改 job2 runs-on |
| `.github/workflows/e2e-wechat-rpa.yml` | zenithjoy | 新建 |
| `packages/workflows/skills/harness-evaluator/SKILL.md` | cecelia | 新增 windows_wechat 路由 |
| `~/.claude-account1/skills/dev/SKILL.md` | 本地 skill | 新增 windows_wechat 选项 + RPA 关键词识别 |

## 不包含

- `e2e-windows.yml` 不改（其他非 RPA sprint 继续用）
- Harness Evaluator 自动检测关键词逻辑（由 AI 写 PrepPRD 时人工判断，不做代码自动化）
- xian-rog runner 的环境安装（已完成）
