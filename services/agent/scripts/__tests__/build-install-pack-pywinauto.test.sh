#!/usr/bin/env bash
# TDD — build-install-pack.sh 必须跨平台预装 pywinauto 进 python-embedded/site-packages。
#
# 【根因】原脚本仅靠 `python.exe -m pip install`：embeddable 不自带 pip，且 python.exe 是
# Windows 二进制，macOS/Linux 打包机（含 GHA ubuntu）无法执行 → || true 吞掉 → site-packages
# 空 → 客户端 listen_chat import pywinauto 失败。
#
# 【RED】当前脚本无 get-pip bootstrap、无 `--platform win_amd64` 宿主跨平台下载分支、
# 仍保留误导性「需在 Windows 上运行打包脚本时安装」注释 → 本测试失败。
# 【GREEN】加 uname 分支（Windows: get-pip + pip install；非 Windows: pip --platform win_amd64
# --only-binary 下载 Windows wheel 解压进 site-packages），并去掉重复/误导块 → 通过。
#
# 静态契约测试（不跑真实 ~100MB 下载构建，与 smoke 同策略）。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BUILD_SCRIPT="$(cd "$SCRIPT_DIR/../.." && pwd)/scripts/build-install-pack.sh"

fail() { echo "FAIL: $1"; exit 1; }

test -f "$BUILD_SCRIPT" || fail "build-install-pack.sh not found"

echo "[test] 1: 含 get-pip bootstrap（embeddable 自带无 pip，需先 bootstrap）"
grep -q 'get-pip' "$BUILD_SCRIPT" || fail "缺 get-pip bootstrap"

echo "[test] 2: 含非 Windows 跨平台下载分支（--platform win_amd64）"
grep -q 'platform win_amd64' "$BUILD_SCRIPT" || fail "缺 --platform win_amd64（macOS/Linux 打包机无法 run python.exe）"

echo "[test] 3: 含 OS 分支判断（uname）"
grep -q 'uname' "$BUILD_SCRIPT" || fail "缺 uname OS 分支"

echo "[test] 4: 仍声明安装 pywinauto / pywin32"
grep -q 'pywinauto' "$BUILD_SCRIPT" || fail "缺 pywinauto"
grep -q 'pywin32' "$BUILD_SCRIPT" || fail "缺 pywin32"

echo "[test] 5: 去掉误导性注释（不能再说『需在 Windows 上运行打包脚本时安装』）"
if grep -q '需在 Windows 上运行打包脚本时安装' "$BUILD_SCRIPT"; then
  fail "仍有误导注释——pywinauto 现在跨平台预装，不再依赖 Windows 打包机"
fi

echo "[test] 6: python-embedded 解压去重（embeddable unzip 只一处）"
N=$(grep -cE 'unzip -q .*python-embedded|unzip -q .*PY_CACHE|unzip -q .*PYTHON_EMBED' "$BUILD_SCRIPT" || true)
test "$N" -le 1 || fail "python-embedded 仍有 $N 处重复 unzip（应去重为 1 处）"

echo "[test] OK — build-install-pack 跨平台预装 pywinauto 契约满足"
