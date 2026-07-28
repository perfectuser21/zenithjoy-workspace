#!/usr/bin/env bash
# build-install-pack-agent-panel.test.sh — 作战窗刀1装机包接线契约测试
#
# 根因：apps/agent-panel-host(WPF+WebView2原生宿主)在PR#1488落地时代码写完但从未接进
# build-install-pack.sh，装机包实际不含这个东西，客户装了新版Agent也看不到作战窗。
#
# 静态契约测试（不跑真实dotnet publish/vite build，与pywinauto测试同策略——
# WPF只能在Windows打包机build，本测试要能在任意平台的CI上跑，只验证脚本"有没有接线"）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_SCRIPT="$(cd "$SCRIPT_DIR/../.." && pwd)/scripts/build-install-pack.sh"

fail() { echo "FAIL: $1"; exit 1; }

echo "[test] 1: 含 dotnet publish 调用（真实构建原生宿主，不是占位）"
grep -q "dotnet publish.*AgentPanelHost.csproj" "$BUILD_SCRIPT" \
  || fail "未找到 dotnet publish AgentPanelHost.csproj 调用"

echo "[test] 2: self-contained true（客户机不预装.NET Runtime也能跑，铁律不出无依赖的包）"
grep -q "self-contained true" "$BUILD_SCRIPT" \
  || fail "未 self-contained 发布，客户机缺.NET Desktop Runtime会直接跑不起来"

echo "[test] 3: 含 Windows 打包机 OS 分支判断（WPF无法跨平台build，必须显式分支不能裸调用）"
grep -qE 'case "\$\(uname -s\)" in' "$BUILD_SCRIPT" \
  || fail "缺 uname OS 分支判断"

echo "[test] 4: 非Windows打包机路径必须 WARN 而不是静默跳过（防止假装出了完整包）"
AWK_SECTION=$(awk '/作战窗 Agent Panel 刀1 打包/,/^esac$/' "$BUILD_SCRIPT")
echo "$AWK_SECTION" | grep -q "WARN" || fail "非Windows分支缺WARN提示，容易假装打包成功"

echo "[test] 5: 网页内容(apps/agent-panel)构建后落在 exe 同目录的 agent-panel-web/ 子目录"
echo "$AWK_SECTION" | grep -q "agent-panel-web" \
  || fail "未拷贝网页内容到agent-panel-web/（MainWindow.xaml.cs按此相对路径查找index.html）"

echo "[test] 6: dry-run stub 也有作战窗占位（CI dry-run验证结构完整，不遗漏这块）"
grep -q "agent-panel-host/agent-panel-web" "$BUILD_SCRIPT" \
  || fail "dry-run stub 缺 agent-panel-host/agent-panel-web 占位结构"

echo "[test] OK — 作战窗刀1装机包接线契约满足"
