# Sprint PRD — Agent 安装包内置 Python-embedded + wechat-rpa（零依赖安装 v1.1.78）

## OKR 对齐

- **对应 KR**：Path 4 — 客户私域 AI 接管
- **当前进度**：Step 1（扫码绑个微 + NodeJS Agent 启动）thin → medium
- **本次推进预期**：客户解压安装包双击 start.bat 即可完成 Python 环境 + wechat-rpa 启动，无需手动装任何依赖

## 背景

当前 zenithjoy-agent 安装包要求客户本机已装 Python 3，导致 Path 4 Step 1 落地摩擦极大。本 sprint 把 Python 3.11 embeddable（含 pywinauto、pywin32）和 wechat-rpa 脚本打包进安装包，start.bat 自动完成讲述人解锁，实现客户零依赖体验。

## Golden Path（核心场景）

用户从 **[下载 zenithjoy-agent-v1.1.78.zip]** → 经过 **[解压 → 双击 start.bat]** → 到达 **[微信监听自动启动]**

具体：
1. 客户解压安装包到任意目录，目录内含 `python-embedded/python.exe`
2. 双击 `start.bat` → PowerShell 自动开关讲述人（≈2 秒）→ WeChat UIAutomation 解锁
3. Agent 启动时检测 `./python-embedded/python.exe`，存在则用内置 Python 启动 `listen_chat.py`
4. 微信 4.0 已登录 → 监听开始 → 控制台出现「listen_chat.py 已自启」

## 边界情况

- 微信未登录：listen_chat.py 等待窗口出现，不崩溃
- `python-embedded/python.exe` 不存在（旧版或非 Windows）：handler 回退到系统 `python3`
- 讲述人进程已存在：`Stop-Process -ErrorAction SilentlyContinue`，不报错

## 范围限定

**在范围内**：
- `build-install-pack.sh` 加入 Python 3.11 embeddable 下载 + pip 安装 pywinauto/pywin32/requests + 拷贝 `wechat-rpa/*.py`
- `install-pack/start.bat` 加入讲述人解锁 PowerShell 一句命令
- `src/handlers/wechat-rpa.ts` handler 改用 `python-embedded/python.exe` 优先逻辑
- 版本号打包为 v1.1.78

**不在范围内**：
- COS 上传 CI 自动化（手动触发打包脚本即可）
- 多个微信号矩阵
- 讲述人永久解锁方案（方案选型未定）

## 假设

- [ASSUMPTION: Python 3.11.9 embeddable AMD64 官方包含 pip boostrap，修改 python311._pth 即可启用 site-packages]
- [ASSUMPTION: CI smoke 只做静态内容验证，不真启 WeChat 进程]
- [ASSUMPTION: wechat-rpa 目录至少含 listen_chat.py + send_chat.py，其余 .py 一并打包]

## 预期受影响文件

- `services/agent/scripts/build-install-pack.sh`：加 Python embeddable 下载/解压/pip install + wechat-rpa 拷贝步骤
- `services/agent/install-pack/start.bat`：加讲述人解锁 PowerShell 命令
- `services/agent/src/handlers/wechat-rpa.ts`：spawn 前检测 `python-embedded/python.exe` 优先使用
- `.github/workflows/scripts/smoke/agent-python-embedded-smoke.sh`（新建）：CI 静态验证安装包内容

## E2E 验收

```bash
# smoke: 静态验证安装包内容（windows_cloud / Linux CI 均可跑）
set -e
PACK_DIR=$(mktemp -d)
# 触发打包
bash services/agent/scripts/build-install-pack.sh --dry-run --out "$PACK_DIR"
# 1. 验证 python-embedded/python.exe 存在
[ -f "$PACK_DIR/python-embedded/python.exe" ] \
  || { echo "FAIL: python-embedded/python.exe 缺失"; exit 1; }
# 2. 验证 wechat-rpa 脚本存在
[ -f "$PACK_DIR/wechat-rpa/listen_chat.py" ] \
  || { echo "FAIL: listen_chat.py 缺失"; exit 1; }
[ -f "$PACK_DIR/wechat-rpa/send_chat.py" ] \
  || { echo "FAIL: send_chat.py 缺失"; exit 1; }
# 3. 验证 start.bat 含讲述人解锁命令
grep -q "Start-Process Narrator" "$PACK_DIR/start.bat" \
  || { echo "FAIL: start.bat 缺讲述人解锁命令"; exit 1; }
# 4. 验证版本号
grep -q "1.1.78" "$PACK_DIR/start.bat" \
  || grep -rq "1.1.78" "$PACK_DIR/package.json" \
  || { echo "FAIL: 版本号 1.1.78 未找到"; exit 1; }
echo "✅ agent-python-embedded smoke 验证通过"
```

## journey_type: user_facing
## journey_type_reason: 客户安装体验改善，直接影响 Path 4 Step 1 落地质量
## target_environment: windows_cloud
## target_environment_reason: 安装包为 Windows 目标，smoke 走 GitHub Actions windows-latest 静态验证打包内容
## journey_id: Line04-客户私域AI接管
## step_id: L04-S1（扫码绑个微 + NodeJS Agent 启动，thin→medium）

{"verdict":"DONE","sprint_dir":"sprints/06031608-agent-python-embedded"}
