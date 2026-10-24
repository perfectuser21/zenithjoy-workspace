# 微信手机控制器：严格应用弹窗与默认显示屏归属

本候选保留既有锁、guard、通话、锁屏、超时、输入法恢复及失败不重试协议，支持严格微信 LauncherUI APPLICATION_PANEL 菜单归属，以及已证实的空闲安装器辅助显示屏。部署和手机业务验收分别留证；不修改设备配置或正式账号绑定。

运行实现原始底座为已冻结的 `cloud-wechat-cs-20261015/phone-tools/wechat_phone.py`，原 SHA256 为 `3d2f24eaaba65bccd6a9611d794a5bef5c7ffb44cf9e6456bc2920eaeffeafb9`。后续适配仅涉及前台归属判断，锁和动作接口不变。该服务位于业务仓，非技能正文。

单屏普通前台仍要求唯一 `mCurrentFocus` 和精确包名/组件。PopupWindow 仅当以下全部成立时被识别为微信 LauncherUI：

- 唯一当前 Window token、用户、标题与唯一 Window section 完全相符。
- 弹窗为 APPLICATION_PANEL、附着于唯一微信 LauncherUI BASE_APPLICATION 父窗口，两者有表面、可见、在屏幕上且 ready。
- 两独立窗口 section 的 ownerUID、用户、完整 session、display、rootTask 一致，包均为 `com.tencent.mm`；独立 Session section 的 mPackageName 也一致。
- 同次只读 `dumpsys activity activities` 的唯一 topResumedActivity 与 mFocusedApp 的 ActivityRecord 身份、用户、规范组件、task 一致。

缺失、冲突、多义、外国应用/输入法/SystemUI 窗口均拒绝；不会从相邻窗口借用字段，不会只凭底层 focusedApp 推断当前弹窗。适配器目前刻意只接受 LauncherUI 菜单，未扩大 OEM 输入框回退范围。

多屏适配只接受 `mTopFocusedDisplayId=0`，因为现有输入和截图均面向默认显示屏。额外显示屏必须各自明确为 1x1、rootTasks=0、focus/app 均为 null；未知、缺字段、其他分辨率或有任务/焦点的显示屏均拒绝，不按显示屏输出顺序猜测主屏。主屏还必须有唯一可见微信窗口，且窗口 UID、Session、任务、用户、独立 Session 包名与当前主屏的 PreferredTopFocusableRootTask 一致。同次独立活动快照必须确认同一 ActivityRecord：支持唯一 `topResumedActivity`；Android 12 支持默认 Display/RootTask 内 `mResumedActivity`、同屏 Resumed 汇总与 Supervisor focusedRootTask 联合证明。畸形同名字段或未知 Display 记录不能被后面的合法值覆盖。

该适配不会关闭辅助显示屏，不会让微信变成 Pad，也不修改微信 APK/数据。Android 12 的原有单屏弹窗 topResumedActivity 限制未扩大；缺少其原有证据时仍拒绝。原生扫码页是否真的以平板副设备登录，由手机端登录确认和同时在线验收决定。

CLI 与原底座相同，例如：

```text
python3 wechat_phone.py --serial SERIAL --owner EXACT_OWNER --evidence-dir PRIVATE_DIR foreground
```

本次候选只供获授权的导航盘点隔离验收。未增加 send/reply/publish 操作，但原有通用 tap 可以点击任意坐标，不能把“没有 send API”视为固有阻发能力；调用者须承担当次真实 UI 定位和获授权导航范围，不能无头任意点击；发送或发布仍需独立明确授权与业务验收。本修复不批准无头发送、发布或自动回复。

验证：

```text
PYTHONPATH=services/wechat-phone-controller python3 -m unittest discover -s services/wechat-phone-controller/tests -v
node --test services/phone-adb-controller/__tests__/wechat-display-focus.test.mjs
```

测试中的窗口文本是根据真实诊断结构手工构造的无私人会话样本，不含完整窗口原件、账号或会话内容。Node 测试入口位于现有 L3 CI 自动运行的测试集合，调用完整 stdlib 回归集；测试与诊断均不连接手机。隔离测试和真实原件只读回放只证明识别机制；实际手机导航与盘点结果由父 workflow 独立记录，不能据此宣称平板登录已跑通。

### 可重复原生二维码入口 CLI

`python3 wechat_pad_login.py status` 仅显示本地工具状态，不调用 ADB/Brain、不占锁。`probe` 自持并释放本次双租约和公共锁，只读核验前台、APK及稳定成对MMKV。`open` 在相同核验后至多打开一次原生二维码页：

```sh
python3 services/wechat-phone-controller/wechat_pad_login.py open
```

工具固定当前云手机和实例，加载已发布2fa控制器及现有连接配置；不使用配置中的业务账号字段，不写租户/CRM绑定、微信数据、全局显示或凭据。已登录LauncherUI返回NOOP；已有二维码页只采证，不重复请求；未知前台、版本漂移、锁冲突或校验失败直接停止。二维码图片和回执在`~/.local/state/zenithjoy/wechat-pad-login/<唯一owner>/`，权限私有，释放结果分别读回，清理未确认不报成功。

`Repairer`使用官方MMKV v5元数据实际长度、CRC和追加记录的最后有效值；要求完整的`AssistInTablet_Int=1`与`Inner_Version_Int=1`，不能把字符串或字节搜索当typed int。冷启动时Repairer异步初始化及进程缓存意味着磁盘值不保证运行时`B=true`。原生二维码入口会调用`s7.b(0)`重新计算设备类型，但本工具不读取进程内存/协议流量，因此输出`runtime_wire_type=unobserved`、`requires_user_pad_confirmation=true`。用户须在手机确认页核实Pad设备类型后自行确认；页面显示二维码不代表登录、资格或同时在线已通过。工具不输入账号、不点击认证、不绕过服务器结果，也不改变旧账号绑定。

安装应由审核者将同一固定候选复制至不可变本地release路径并用`~/.local/bin/wechat-pad-login` shim调用，再独立实机验证；工作树测试通过不等于已部署。重复调用每次自建资源，不读取旧诊断state.json或硬编码PID。

前台前提：当前云手机须已在微信已识别登录页或二维码页；桌面、未知弹窗（含更多菜单）会拒绝，先由人恢复正常微信页面。工具不会自动清菜单或模拟返回。二维码过期/获取失败仅报告需人工刷新，不会自动换码。
