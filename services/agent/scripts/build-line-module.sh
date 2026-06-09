#!/usr/bin/env bash
# Sprint 06081700 — 构建单个 Line 模块 tar.gz（供 gamma CI matrix 调用）。
# Usage: bash scripts/build-line-module.sh <lineId>   # 例：line04 / line01 / line02 / line05
set -euo pipefail

LINE_ID="${1:?usage: build-line-module.sh <lineId>}"
AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

MODULE_SRC="modules/$LINE_ID"
[ -d "$MODULE_SRC" ] || { echo "[build-module] 模块目录不存在: $MODULE_SRC"; exit 1; }

VERSION=$(node -e "console.log(require('./${MODULE_SRC}/manifest.json').version)")
MANIFEST_LINE_ID=$(node -e "console.log(require('./${MODULE_SRC}/manifest.json').lineId)" 2>/dev/null || echo "$LINE_ID")
OUT_DIR="dist-modules"
BUILD_DIR="build-modules/$LINE_ID"

rm -rf "$BUILD_DIR"
mkdir -p "$OUT_DIR" "$BUILD_DIR"

# 编译该模块的 TS（顶层 *.ts + handlers/*.ts，跳过 __tests__）到纯 JS。
TS_FILES=("$MODULE_SRC"/*.ts)
if compgen -G "$MODULE_SRC/handlers/*.ts" > /dev/null; then
  TS_FILES+=("$MODULE_SRC"/handlers/*.ts)
fi
npx tsc "${TS_FILES[@]}" \
  --outDir "$BUILD_DIR" --rootDir "$MODULE_SRC" \
  --module commonjs --target ES2020 --moduleResolution node \
  --esModuleInterop --skipLibCheck --types node

cp "${MODULE_SRC}/manifest.json" "$BUILD_DIR/"

# line04 特殊：打包 wechat-rpa Python 脚本（listen_chat / send_chat / qr_bind …）。
if [ "$LINE_ID" = "line04" ] && [ -d "wechat-rpa" ]; then
  cp -r wechat-rpa "$BUILD_DIR/"
  # 不打包 Python 缓存 / 测试，瘦身 tar。
  rm -rf "$BUILD_DIR/wechat-rpa/__pycache__" "$BUILD_DIR/wechat-rpa/tests"
fi

tar czf "$OUT_DIR/${MANIFEST_LINE_ID}-v${VERSION}.tar.gz" -C "build-modules/$LINE_ID" .
echo "[build-module] ${MANIFEST_LINE_ID}-v${VERSION}.tar.gz ready (-> $OUT_DIR/)"
