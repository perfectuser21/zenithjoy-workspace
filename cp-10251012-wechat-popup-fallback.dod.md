# Android12微信原生菜单重复校验修复

Parent: b71c6083-634c-4104-ae22-35f50566d0c2（已有claimed有头任务）
GP-Anchor: line04/cs_shared_binding keep-green

- [x] [BEHAVIOR] failing commit5ac16819d精确复现合法Android12多屏LauncherUI菜单在旧topResumedActivity重复检查误拒绝。
- [x] [BEHAVIOR] 仅_default_display_focus成功后复用已证明同一focused/resumed身份；保留全部父窗口、附着、UID、Session、task、type、可见性检查。
- [x] [BEHAVIOR] 单屏仍严格要求原topResumed证据；新增13种归属/活动变异及单屏缺证据拒绝；43测试和L3Node桥通过。
- [x] [BEHAVIOR] 独立RPA审查PASS；固定候选531f3e8f交父任务独立实机验收，不操作手机或更改账号/绑定。

Test: node --test services/phone-adb-controller/__tests__/wechat-display-focus.test.mjs
