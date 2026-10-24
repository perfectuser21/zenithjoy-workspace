# 可重复微信原生二维码入口

Parent: b71c6083-634c-4104-ae22-35f50566d0c2（已有 claimed 有头任务；子任务路由500，未改 Brain）
GP-Anchor: line04/cs_shared_binding keep-green

- [x] [BEHAVIOR] failing test commit 33f76f79c 在实现前因入口缺失报红。
- [x] [BEHAVIOR] help/status 仅本地，probe 只读；open 只从已识别微信登录页至多一次打开固定原生二维码组件，已有二维码和已登录页不重复请求。
- [x] [BEHAVIOR] 双租约、公共锁、APK固定版本、SDK归属和稳定成对MMKV typed flag/CRC都通过才导航；锁获取歧义和清理无法确认不能报告成功。
- [x] [BEHAVIOR] 未知前台、旗标0、CRC错误、版本漂移、过期/失败二维码拒绝；不写应用配置、凭据、全局显示或生产绑定，不自动认证。
- [x] [BEHAVIOR] 19项CLI测试及23项既有控制器测试通过，Node桥进入现有L3测试集；独立RPA审查通过。
- [x] [BEHAVIOR] 文档明确当前须在微信正常登录页前台；Pad运行时协议类型未观测，用户须核实Pad后自行确认。源码测试不代表部署或登录成功。

Test: node --test services/phone-adb-controller/__tests__/wechat-pad-login.test.mjs

固定候选488a79e23eea202598230d91323d46c45e321a047bed892963cf3d68af9f24ae交父任务独立部署/实机验收；没有上传二维码、账号或原始UI。
