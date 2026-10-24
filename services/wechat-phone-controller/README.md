# 微信手机控制器：严格应用弹窗归属

本候选保留既有锁、guard、通话、锁屏、超时、输入法恢复及失败不重试协议，只修复微信 LauncherUI 打开 APPLICATION_PANEL 菜单后 `foreground_unknown` 的阻塞。不修改运行中的控制器、设备配置或正式账号绑定。

运行实现完整复制自已冻结底座 `cloud-wechat-cs-20261015/phone-tools/wechat_phone.py`，原 SHA256 为 `3d2f24eaaba65bccd6a9611d794a5bef5c7ffb44cf9e6456bc2920eaeffeafb9`；只有 `Phone.foreground` 方法改变。该服务位于业务仓，非技能正文。

普通前台仍要求唯一 `mCurrentFocus` 和精确包名/组件。PopupWindow 仅当以下全部成立时被识别为微信 LauncherUI：

- 唯一当前 Window token、用户、标题与唯一 Window section 完全相符。
- 弹窗为 APPLICATION_PANEL、附着于唯一微信 LauncherUI BASE_APPLICATION 父窗口，两者有表面、可见、在屏幕上且 ready。
- 两独立窗口 section 的 ownerUID、用户、完整 session、display、rootTask 一致，包均为 `com.tencent.mm`；独立 Session section 的 mPackageName 也一致。
- 同次只读 `dumpsys activity activities` 的唯一 topResumedActivity 与 mFocusedApp 的 ActivityRecord 身份、用户、规范组件、task 一致。

缺失、冲突、多义、外国应用/输入法/SystemUI 窗口均拒绝；不会从相邻窗口借用字段，不会只凭底层 focusedApp 推断当前弹窗。适配器目前刻意只接受 LauncherUI 菜单，未扩大 OEM 输入框回退范围。

CLI 与原底座相同，例如：

```text
python3 wechat_phone.py --serial SERIAL --owner EXACT_OWNER --evidence-dir PRIVATE_DIR foreground
```

本次候选只供获授权的导航盘点隔离验收。未增加 send/reply/publish 操作，但原有通用 tap 可以点击任意坐标，不能把“没有 send API”视为固有阻发能力；调用者须承担当次真实 UI 定位和获授权导航范围，不能无头任意点击；发送或发布仍需独立明确授权与业务验收。本修复不批准无头发送、发布或自动回复。

验证：

```text
PYTHONPATH=services/wechat-phone-controller python3 -m unittest discover -s services/wechat-phone-controller/tests -v
```

测试中的窗口文本是根据真实诊断结构手工构造的无私人会话样本，不含完整窗口原件、账号或会话内容。隔离测试和真实原件只读回放只证明识别机制；实际手机导航与盘点结果由父 workflow 独立记录，不能据此宣称已经真机跑通。
