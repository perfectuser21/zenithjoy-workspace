# 小改动 PrepPRD：机器管理页 / 账号管理页补设备类型(安卓/Windows)展示

**关联 Journey**：客户智能获客路径（Path2，afa6abca-53c0-4815-8594-b7fb81ca547f，skeleton）— 推进 Step 6/7 展示层
**关联决策**：decision 8dbe91ee

## 改什么
1. apps/api/src/routes/agent-machines.ts GET /machines：SELECT 补 a.os_type，normMachine() 补 os_type 字段
2. apps/api/src/routes/agent-burner.ts GET /sessions：SELECT 补 s.device_type（agent_platform_sessions.device_type，07-06 已建好，同表无需 join，一直没接前端）
3. apps/dashboard/src/api/machines.api.ts：Machine 加 os_type: string | null，BurnerSession 加 device_type: 'web' | 'android'
4. MachineManagementPage.tsx：机器列表"机器"列旁加设备类型图标（Windows / 安卓 / 其他）
5. AcquisitionAccountsPage.tsx：interface BurnerSession 补 device_type 字段，"绑定机器"列旁同样加图标

## 为什么改
2026-07-18 排查Path2现状发现这两个页面完全不区分安卓手机和Windows机器（decision 8dbe91ee）。字段后端都已经有，纯粹没人接线到UI。

## 影响范围
纯展示层新增字段，不改现有查询条件/WHERE子句，不影响现有排序/过滤逻辑；两个前端类型是可选新增字段，不破坏现有调用方。

## 验收标准
- [ ] GET /api/agent/machines 返回体含 os_type
- [ ] GET /api/agent/burner/sessions 返回体含 device_type
- [ ] 机器管理页表格能看到设备类型图标区分
- [ ] 账号管理页"绑定机器"列能看到设备类型图标区分
- [ ] CI 全绿
