# Shizuku shell server 存活保障脚本 — 设计（2026-08-15）

## 背景

本 session 已在真机（HONOR 100 / MagicOS，通过 rog 连接）验证 Shizuku shell 权限级
`input tap` 点击注入可行（决策 78bd0467 → 799ad215 → 1fe3c420）。验证用的启动方式是
Shizuku App 内"通过连接电脑启动（使用 adb)"选项给出的命令：

```
adb shell /data/app/~~<hash1>/moe.shizuku.privileged.api-<hash2>==/lib/arm64/libshizuku.so
```

这条命令启动的 `shizuku_server` 以 `shell` UID 运行，但设备重启后进程会消失，必须重新
执行才能恢复（Shizuku 官方文档原话）。本次任务只解决"存活保障"这一件事——给一个可靠、
可脱离真机单测的函数库，不接入生产点击逻辑，不建常驻 60s 轮询 daemon。

范围明确限定为 rog/pc4 常驻测试机队（adb 访问在这两台机器上是常驻的），不覆盖脱离机队
的远程设备。

## 架构

新增两个文件，纯新增、不改动任何现有文件：

```
.github/workflows/scripts/smoke/
├── lib/
│   └── ensure-shizuku-server.sh      # 函数库（新增）
└── ensure-shizuku-server-lib-smoke.sh # 回归测试（新增）
```

风格严格对齐目录内既有的 `dedupe-adb-devices.sh` / `dedupe-adb-devices-lib-smoke.sh`
——同一套"纯函数 + printf fixture + 手写断言"的 bash smoke 测试模式，这个仓库已经在用、
已经跑通过 CI，不引入新框架。

## 组件

### `shizuku_server_alive(ps_output)`

输入：一段文本（`adb shell ps -A` 的输出，作为位置参数传入，如
`shizuku_server_alive "$ps_output"`——跟 `dedupe_adb_devices` 读 stdin 的方式不同，
因为这里是单个标量判定，位置参数比建一条 stdin 管道更直接）。
输出：无 stdout 输出，只用 return code——含有一行进程名是 `shizuku_server` 则 return 0，
否则 return 1。
依赖：无，纯字符串匹配（`grep`）。

### `resolve_shizuku_starter_path(pm_path_output)`

输入：一段文本（`adb shell pm path moe.shizuku.privileged.api` 的输出，可能多行——例如
App 走了 AAB 分包安装时会同时列出 `base.apk` 和若干 `split_config.*.apk`）。
输出：stdout 打印出解析到的 starter 路径（把匹配到的 base.apk 那行路径里的 `/base.apk`
替换成 `/lib/arm64/libshizuku.so`）；解析失败（空输入 / 找不到 base.apk 行）则不输出，
return 1。
依赖：无，纯字符串处理。

### `ensure_shizuku_server(serial)`（胶水函数，不在单测覆盖范围）

依赖真实 `adb` 命令，逻辑：
1. `adb -s "$serial" get-state`，非 `device` 状态 → stderr 报错，return 1（覆盖"设备刚
   重启还没握手成功"这种边界，不能对 offline/unauthorized 状态的设备执行 shell 命令）
2. `adb -s "$serial" shell ps -A` 喂给 `shizuku_server_alive`，存活 → 直接 return 0
3. 不存活 → `adb -s "$serial" shell pm path moe.shizuku.privileged.api` 喂给
   `resolve_shizuku_starter_path`；解析失败（App 未安装等）→ stderr 报错，return 1
4. 解析成功 → `adb -s "$serial" shell "$starter_path"` 执行拉起
5. 二次校验：重新 `adb -s "$serial" shell ps -A` 喂给 `shizuku_server_alive`，仍不存活
   （拉起命令执行了但没起来，如 SELinux 拒绝）→ stderr 报错，return 1；存活则 return 0

这个函数不追加自己的单测（调真实 adb，跟 `dedupe_adb_devices` 的胶水调用方在
`nightly-android-fleet-pc4.yml` 里直接写 bash 内联同理，不额外造一层 mock）。

## 数据流

```
adb shell ps -A ──┐
                   ├─→ shizuku_server_alive() ──alive──→ 结束（return 0）
                   │                        └─not alive─┐
adb shell pm path ─┘                                     ↓
                              resolve_shizuku_starter_path()
                                         │
                              adb shell "$starter_path"（执行拉起）
                                         │
                              二次 adb shell ps -A → shizuku_server_alive()
                                         │
                              alive → return 0 / 仍不 alive → return 1
```

## 错误处理

| 场景 | 处理 |
|---|---|
| 设备 offline/unauthorized | `get-state` 检测，非 `device` 直接报错退出，不往下执行 shell 命令 |
| App 未安装（pm path 空） | `resolve_shizuku_starter_path` 返回空 + return 1，胶水函数报错退出 |
| AAB 分包，pm path 多行 | 精确匹配以 `base.apk` 结尾的行，忽略 split apk 行 |
| 拉起命令执行但没真正起来 | 二次 `ps -A` 校验，不存活则视为失败，不盲目假设"跑了命令=成功" |

## 测试策略

**trivial 档**：`shizuku_server_alive` / `resolve_shizuku_starter_path` 是纯字符串解析
函数，无外部依赖、无真机/网络/异步逻辑，适用同目录 `dedupe-adb-devices-lib-smoke.sh` 已
验证过的手写 bash smoke 测试模式，不需要 E2E/integration 测试框架。`ensure_shizuku_server`
胶水函数依赖真实 adb，不做单测（同 repo 里 adb 胶水调用一律不 mock，直接在真机 CI 里跑）。

测试场景（`ensure-shizuku-server-lib-smoke.sh`）：
- 场景1：`shizuku_server_alive` — ps 输出含 `shizuku_server` 一行 → alive(0)
- 场景2：`shizuku_server_alive` — ps 输出不含 → not alive(1)
- 场景3：`resolve_shizuku_starter_path` — 正常单行 base.apk → 正确替换出 libshizuku.so 路径
- 场景4：`resolve_shizuku_starter_path` — 空输入 → 空输出 + 失败
- 场景5：`resolve_shizuku_starter_path` — 多行含 split_config apk → 仍正确挑出 base.apk 行

## CI 接入

发现该目录的 smoke 脚本受 `ci-smoke-glob-runner.yml` 的"基线棘轮闸"机制管理：
`.github/workflows/scripts/smoke-baseline.txt` 内登记的脚本 = CI 必绿；有配套的
baseline-lint job 强制新脚本必须登记进基线（否则 PR 检查会报错提示登记）。因此本次实现
必须把 `ensure-shizuku-server-lib-smoke.sh` 加进 `smoke-baseline.txt`（照抄
`dedupe-adb-devices-lib-smoke.sh` 那一行的格式），否则新脚本不会被 CI 当作必绿项执行。

## 不包含

- 不建常驻 60s 轮询 watchdog daemon（当前没有生产流程消费 Shizuku，属于过度设计）
- 不修改 `DeviceAccountScanService` 或任何生产点击逻辑
- 不修改 `nightly-android-fleet-pc4.yml` 或任何现有 workflow
