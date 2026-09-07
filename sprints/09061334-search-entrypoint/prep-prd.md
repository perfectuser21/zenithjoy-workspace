# 小改动 PrepPRD：给信号桥补"打开搜索并输入关键词"命令

## 改什么

1. `services/agent-android/app/src/main/kotlin/com/zenithjoy/agent/...`（AgentService.kt 或对应指令处理器）新增指令类型 `open_search`：
   - 用已有无障碍服务（`DouyinCollectService` 等）语义定位搜索入口节点（`contentDescription`/`text` 含"搜索"，而非固定坐标）
   - 对定位到的节点执行 `ACTION_CLICK` 进入搜索页
   - 定位聚焦的搜索输入框节点，用 `AccessibilityNodeInfo.ACTION_SET_TEXT` 写入关键词（原生支持中文/Unicode，不走 adb `input text`）
   - 定位并点击"搜索"提交按钮（或触发 IME 搜索动作）
   - 返回执行结果 + 落盘证据截图路径

2. `scripts/openclaw/adb-controller-bridge.sh` 新增命令：
   ```
   open-search-evidence <keyword> <evidence_id>
   ```
   遵循现有 `*-evidence` 命名风格，把 keyword/evidence_id 转发给中台 `POST /api/devices/:agentId/actions`（走 `phonectl.sh`），拿到结果后落盘截图/UI状态证据。

3. **命令留痕（新增，为将来蒸馏铺路）**：`adb-controller-bridge.sh` 每次任意命令被调用时，追加一行到 `<run_id>.command-trace.jsonl`（命令名、参数、时间戳、结果），供未来跨多次运行对比命令序列稳定性、判断是否可以蒸馏成固定脚本。

## 为什么改

真机验证（run_id `social-keyword-leadgen-20260906043102-lu3rus`）显示：preflight 阶段已 100% 真实通过，discovery 阶段两次 retry 后失败退出，唯一原因是"controller lacks the required open-search entrypoint"——信号桥完全没有"打开搜索输入关键词"这个能力，这是获客流程走到 discovery 阶段的硬阻塞。

## 关联上下文

延续 09-04 sprint"OpenClaw信号桥"三件套 + 本 sprint 已完成的 call_state 修复（PR#1784/#1786）同一条技术债清理路径。无历史决策冲突、无并行任务撞车、无冲突 open PR（已核对）。

## 前置验证（本次真机 adb 探索已确认，非猜测）

- ✅ 搜索图标点击可行：真机 adb 探测确认点击后进入搜索页，输入框自动聚焦、键盘弹出
- ✅ 中文输入必须走无障碍服务：真机验证 `adb shell input text 装修` 直接抛 `NullPointerException`（`InputShellCommand.sendText` 无法编码中文按键），adb 原生方案完全不可行，`ACTION_SET_TEXT` 是唯一可靠路径
- ⚠️ `uiautomator dump` 在动态视频首页无法达到 idle state（skill 文档已预警），命令级语义定位必须走无障碍服务自身查询树，不能依赖系统 uiautomator 命令

## 影响范围

只新增命令，不改动任何已有命令行为；不影响生产 yueshengyun/jinoshengyuan 租户（新命令未接入前对它们零可见）。

## 验收标准

- [ ] 单元测试覆盖：语义定位命中/未命中、中文关键词写入正确性、搜索提交后进入结果页判定、command-trace 追加写入格式正确
- [ ] 真机验证：秦军餐饮测试号上实际搜索"装修"并进入结果页（截图证据）
- [ ] HK-VPS 部署同步（避免此前 call_state 那次"脚本与仓库脱节"重演）
- [ ] CI 全绿
