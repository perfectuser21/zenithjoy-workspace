# SDK31 固定录音运行时

本目录只交付脚本、精确策略、上游补丁和离线测试，不包含二进制。
控制器负责 SDK、真实锁、视频身份、音源、录音 PID、整体截止和终态验收。
helper 不领取、刷新或释放设备锁，不创建 ADB server。

固定对象见 `runtime-policy.json`：官方 scrcpy v5.0.1 commit
`a60891aea193d92e7e5c3942700eca63f9d19a5f`；客户端 SHA256 为
`7c15cbe29c58495b329fcd0737feeb3d10ddbf9d27ff1f6c6438b3c49dc2edb2`；
官方同版 server 为
`764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`。

## 创建独立运行时包

目标父目录须已存在，目标目录须不存在。此操作只复制和校验本地文件，
以原子、禁止覆盖的 rename 发布；不会安装到 Homebrew。

```sh
python3 runtime/build-scrcpy-runtime.py adopt \
  --client /absolute/path/to/approved/scrcpy \
  --server /absolute/path/to/official/scrcpy-server \
  --runtime-root "$HOME/.local/share/zenithjoy/scrcpy-sdk31"
python3 runtime/scrcpy-runtime.py verify \
  --runtime-root "$HOME/.local/share/zenithjoy/scrcpy-sdk31"
```

包中只有 `scrcpy`、`scrcpy-server` 和 `runtime-manifest.json`。
目录/bin/server 权限分别为 555/555/444，重复 adopt 拒绝覆盖。
校验直接依据仓库策略计算实际文件哈希，不信任包内自述。
`verify` 返回 JSON：`verified`、`client_path`、`server_path`、两项 SHA256。
可选 `--client-sha256` 必须等于仓库已经批准的 pin，不能据它启用任意客户端。

## 有界 JAR 上传

```sh
python3 runtime/scrcpy-runtime.py stage-server \
  --runtime-root /absolute/runtime \
  --adb-bin /absolute/adb --adb-port 5041 --serial SERIAL \
  --owner EXACT_OWNER --lock-dir /absolute/SERIAL.lock \
  --evidence-root /absolute/evidence --evidence-id EID --timeout 45
```

helper 每步读回现有 `LOCK_DIR/owner`，只接受 exact owner。
中央租约及本地 guard 仍由调用控制器持有并校验。
每次命令前只读查询既有 ADB smart socket，要求其协议为已核的 41；
本地 `adb version` 也须为 1.0.41，防止 ADB 自行因协议不匹配重启服务。
实际调用固定 `-H 127.0.0.1 -P PORT` 及数字地址 socket，使连接失败时
按 AOSP 的远端连接分支返回错误，不自动启动本地 server。
127.0.0.1 仍指同一个既有本机端口，不创建新桥；不执行 start/kill-server。

接收端使用 `toybox head -c 精确字节数`，无需等待传输通道 EOF。
唯一临时路径通过 `set -C` 禁止覆盖；发布前核 SHA 和字节数；
使用 `ln TEMP /data/local/tmp/scrcpy-server.jar` 无覆盖发布并读回，
只删除自己已确认创建的临时文件。已有正确 server 复用，已有其他内容拒绝替换。

写入前即保存 `EID.server-stage.UUID.json`。
成功 exit 0；明确拒绝 exit 64；超时、终止或无法确认的副作用 exit 75，
`execution_stop_unknown=true`。调用方须保留锁并按原件核查，不能把非零退出当无副作用。
总预算包括全部 ADB 步骤；超时后最多再用 1.5 秒终止自己子进程组。

## scrcpy 的 ADB push shim

实际 scrcpy 客户端由控制器直接启动；`ADB` 仅指向可执行的
`runtime/scrcpy-adb-shim.py`，不改变录音 PID 为另一层 wrapper。
环境变量均以 `ZJ_SCRCPY_` 为前缀：

| 后缀 | 值 |
|---|---|
| RUNTIME_ROOT | 独立包绝对目录 |
| CLIENT_SHA256 | 固定 7c15…；省略时同仓库 pin |
| ADB_BIN / ADB_PORT / SERIAL | 成熟控制器实际绑定的既有通道 |
| OWNER / LOCK_DIR | exact owner 与设备锁绝对目录 |
| EVIDENCE_ROOT / EVIDENCE_ID | 本次原件目录与 ID |
| STAGE_TIMEOUT | 整体上传秒数，默认 45，上限 120 |

shim 只把精确同版 server 的精确目标 push 转为上述 stage。
其余仅允许 scrcpy 必要的 devices、同目标官方 server shell、
`scrcpy_<scid>` forward/reverse。start-server 只查询现有桥，
其他目标、任意文件 push、安装、重启、换钥等命令一律拒绝。
启动客户端时同时设置 `SCRCPY_SERVER_PATH=verify 返回的 server_path`。

SDK31 的控制器应显式选 `--no-video --audio-codec=raw --audio-source=output
--require-audio --no-playback --no-control --record=FILE.wav`，保留外层总截止。
本 helper 不替代真实 WAV、decoded duration/能量及资源恢复验收。

## 从固定上游重建候选

准备一个新的、干净的官方 v5.0.1 checkout 和私有 Meson/Ninja/pkgconf，
复用已安装 FFmpeg/SDL3/libusb 开发文件，不执行全局 brew 升级。
builder 校验 commit、完整 `git archive` SHA256、补丁 SHA、补丁后 recorder SHA
及官方 server SHA，才编译并运行上游测试。

```sh
python3 runtime/build-scrcpy-runtime.py rebuild \
  --source /absolute/fresh-official-v5.0.1-checkout \
  --build-dir /absolute/new-build-dir --server /absolute/official-server \
  --meson /absolute/private/meson --ninja /absolute/private/ninja \
  --pkg-config /absolute/private/pkgconf
```

构建只改变指定的专用 source/build 目录，补丁不碰 Android server。
输出 `candidate-manifest.json`；debug 路径及工具链可能改变客户端字节，
因此重建成功不自动更改已经批准的运行时 pin，也不自动发布包。
新 SHA 必须经独立审查和实机验证后，由正式变更更新仓库策略。

离线回归：

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -W error::ResourceWarning \
  -m unittest discover -s runtime/tests -v
```

测试以本地真实 shell 模拟远端 stdin 不关闭的通道，覆盖固定字节完成、
哈希失败、并发发布、超时 unknown、exact owner、固定 push 及包发布拒覆盖。
不接触手机或真实 ADB server。

官方来源：[构建说明](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/build.md)、
[录音说明](https://github.com/Genymobile/scrcpy/blob/v5.0.1/doc/recording.md)、
[recorder 源码](https://github.com/Genymobile/scrcpy/blob/v5.0.1/app/src/recorder.c)。
