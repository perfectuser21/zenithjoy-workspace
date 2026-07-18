# 设计：机器管理页 / 账号管理页补设备类型(安卓/Windows)展示

## 背景

Path2（客户智能获客）根因排查（decision 8dbe91ee）发现：`MachineManagementPage.tsx`（机器管理页）
和 `AcquisitionAccountsPage.tsx`（账号管理页）完全不区分 Android 手机和 Windows 机器。字段后端
其实都已经存在：`zenithjoy.agents.os_type`（机器级）和 `zenithjoy.agent_platform_sessions.device_type`
（账号会话级，07-06 就为"区分Web小号 vs 安卓设备账号"建好了），只是从未被这两个前端页面查询展示。

## 方案

只做展示层接线，不改任何业务逻辑/查询条件：

1. **机器管理页**：`agent-machines.ts` GET `/machines` 的 SELECT 补 `a.os_type`；`normMachine()` 补
   `os_type` 字段；`Machine` 前端类型加 `os_type: string | null`；`MachineManagementPage.tsx` 在
   "机器"列的 nickname/hostname 旁加一个 `OsBadge` 组件（🖥️ Windows / 📱 安卓 / 💻 其他/未知）。

2. **账号管理页**：`agent-burner.ts` GET `/sessions` 的 SELECT 补 `s.device_type`（同表字段，无需
   join）；`BurnerSession` 前端类型加 `device_type: 'web' | 'android'`；`AcquisitionAccountsPage.tsx`
   在"绑定机器"列旁同样加设备类型图标。

## 为什么不用 device-platform.ts 的 resolveDevicePlatform()

`device-platform.ts` 的 `device_platform` 是从 `agents.capabilities` 派生的判断值，专供派单逻辑内部
使用，historically 曾因 `capabilities` 未随心跳同步 `os_type` 而漂移出过真实生产 bug（PR #1313）。
展示层直接读原始字段（`os_type`/`device_type`）比读一个曾经出过漂移 bug 的派生值更可靠，且这两个
字段本来就是"设备类型"这个概念在各自表里最原始的来源。

## 测试策略

- **integration test**（vitest，走真实 test DB）：
  - `agent-machines.test.ts` 新增用例：插入一条 `os_type='android'` 的 agent，断言 `GET /machines`
    返回体含 `os_type: 'android'`
  - `agent-burner.test.ts`（或对应现有测试文件）新增用例：插入一条 `device_type='android'` 的
    `agent_platform_sessions` 行，断言 `GET /sessions` 返回体含 `device_type: 'android'`
- **无 E2E/Playwright 新增**：这是纯展示字段透传，现有页面级测试（如有）不需要改断言逻辑，只是
  多了一个可选字段；不新增 smoke（不改变任何 Golden Path 步骤的通过/失败判据，只是让已有步骤的
  UI 多显示一个信息）

## 影响范围

新增字段全部是可选/追加，不改变现有 SELECT 的 WHERE 条件、排序、返回的既有字段，不破坏任何现有
调用方。前端两个 interface 新增字段为可选属性风格但本次会直接读取展示，无字段时显示"未知"。
