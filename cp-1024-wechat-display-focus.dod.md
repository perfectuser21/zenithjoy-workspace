# 微信默认显示屏前台识别修复

Parent: b71c6083-634c-4104-ae22-35f50566d0c2（已有 claimed 有头任务）
GP-Anchor: line04/cs_shared_binding keep-green

新建子任务入口返回 routing_evidence_unavailable；按父任务授权将此隔离修复关联现有任务，不修复或绕过 Brain 路由，不借此宣称父任务完成。

- [x] [BEHAVIOR] failing commit 37abaf41d 重现合法空闲辅助屏误拒绝，非默认主屏应拒绝的旧缺口也报红。
- [x] [BEHAVIOR] 只接受 top-focused 默认显示屏0与窗口、UID、Session、PreferredRootTask、独立活动证据一致的微信页面；其他有任务/焦点、未知或冲突显示屏拒绝。
- [x] [BEHAVIOR] Android12主屏mResumedActivity与同屏Resumed、RootTask和Supervisor focusedRootTask联合校验；畸形重复字段不能被合法字段覆盖。
- [x] [BEHAVIOR] 原有普通前台、LauncherUI所属弹窗、锁主/guard、通话/锁屏、输入法恢复和超时回收回归通过；运行代码改动限于前台判断。
- [x] [BEHAVIOR] 新增Node入口进入现有L3 CI测试集合，完整调用Python安全测试；把旧SDK换回会报红，拒绝只写永不执行的守卫。
- [x] [BEHAVIOR] 独立RPA审查通过；父任务在固定SHA候选、新鲜设备锁和单次原生am start后，已目视及XML确认原机微信扫码页面。没有确认登录，没有平板/同时在线验收。

Test: node --test services/phone-adb-controller/__tests__/wechat-display-focus.test.mjs

仅手工隔离导航验收；不改微信安装包、数据、显示配置或生产绑定，不上传二维码、UI原件或账号信息。正式代码发布与真实平板登录验收分别记录。
