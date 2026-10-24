# 微信所属弹窗前台识别修复

Task: c295cede-5b1a-487a-ab0c-174130895716
Parent: b71c6083-634c-4104-ae22-35f50566d0c2
GP-Anchor: line04/cs_shared_binding keep-green

- [x] [BEHAVIOR] 测试先行重现已归属微信菜单的误拒绝，并证明重复正常/Popup焦点不能混过。
- [x] [BEHAVIOR] 只有唯一section、独立parent/session所有权、用户/task/display及top活动一致才识别LauncherUI弹窗。
- [x] [BEHAVIOR] 外国窗口、IME/SystemUI、缺字段、冲突、多义与不可见窗口拒绝。
- [x] [BEHAVIOR] 原controller foreground之外逐字保留；原OEM输入回退、锁主/guard、通话/锁屏/超时回收约束回归。

Test: PYTHONPATH=services/wechat-phone-controller python3 -m unittest discover -s services/wechat-phone-controller/tests -v

仅交付隔离候选，不改正在运行控制器、不修改账号绑定、不操作设备；真实盘点验收归父workflow，不能用夹具替代。
