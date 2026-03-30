# Learning: enable-content-factory-flag

### 根本原因
`InstanceContext.tsx` 的 `autopilotConfig.features` 控制侧边栏菜单可见性。
`content-factory` 未加入导致菜单不显示，即使路由和组件都已存在。

### 下次预防
- [ ] 新增菜单路由时，同步在 `autopilotConfig.features` 中添加对应 featureKey
- [ ] 检查清单：navigation.config.ts 加路由 → InstanceContext.tsx 加 flag → 构建验证
