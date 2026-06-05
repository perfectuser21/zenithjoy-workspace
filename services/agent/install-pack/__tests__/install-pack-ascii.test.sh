#!/usr/bin/env bash
# install-pack-ascii.test.sh — 防打包坑回归：
#   1) install-pack/ 下不准有非 ASCII 文件名（中文名在 .tar 里编码坏 → Windows 解压中断 → 包不全）
#   2) start.bat 必须纯 ASCII + 无 UTF-8 BOM（BOM 会破坏 @echo off；中文行 cmd 解析不稳 → 满屏 not recognized）
# Windows 客户机用任意工具解压 + cmd 解析 .bat 都不出错。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

PACK=services/agent/install-pack
FAIL=0

echo "=== 1: install-pack 顶层无非 ASCII 文件名 ==="
BAD=$(ls "$PACK" | perl -ne 'print if /[^\x00-\x7F]/' || true)
if [ -n "$BAD" ]; then
  echo "FAIL: 发现非 ASCII 文件名（会导致 Windows tar 解压中断）:"; echo "$BAD"; FAIL=1
else
  echo "  PASS 无非 ASCII 文件名"
fi

echo "=== 2: start.bat 无 UTF-8 BOM ==="
BOM=$(head -c3 "$PACK/start.bat" | xxd -p)
if [ "$BOM" = "efbbbf" ]; then
  echo "FAIL: start.bat 带 UTF-8 BOM（会破坏 @echo off）"; FAIL=1
else
  echo "  PASS 无 BOM"
fi

echo "=== 3: start.bat 纯 ASCII（无中文/全角字符，cmd 解析才稳）==="
NONASCII=$(perl -ne 'print "$.: $_" if /[^\x00-\x7F]/' "$PACK/start.bat" || true)
if [ -n "$NONASCII" ]; then
  echo "FAIL: start.bat 含非 ASCII 字符（cmd 可能拆行误执行）:"; echo "$NONASCII" | head; FAIL=1
else
  echo "  PASS start.bat 纯 ASCII"
fi

echo "=== 4: README 已是 ASCII 名（README.txt）==="
if [ -f "$PACK/README.txt" ]; then
  echo "  PASS README.txt 存在"
else
  echo "FAIL: README.txt 不存在（应已从中文名改为 ASCII）"; FAIL=1
fi

if [ "$FAIL" = "1" ]; then
  echo ""; echo "install-pack-ascii: FAILED"; exit 1
fi
echo ""; echo "install-pack-ascii: ALL PASS"
