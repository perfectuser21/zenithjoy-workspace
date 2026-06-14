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
# build-modules 保留完整 wechat-rpa（含 tests/），CI sync-check 用 diff -r 比对源码。
# tar 时用 --exclude 排除测试/缓存，生产包不含测试代码。
if [ "$LINE_ID" = "line04" ] && [ -d "wechat-rpa" ]; then
  rsync -a --delete wechat-rpa/ "$BUILD_DIR/wechat-rpa/"
fi

# 临时目录排除 tests/__pycache__ 再打包（兼容 macOS BSD tar 和 Linux GNU tar）。
TAR_STAGE=$(mktemp -d)
cp -r "build-modules/$LINE_ID/." "$TAR_STAGE/"
find "$TAR_STAGE" -name "__pycache__" -type d -exec rm -rf {} + 2>/dev/null || true
find "$TAR_STAGE" -name ".pytest_cache" -type d -exec rm -rf {} + 2>/dev/null || true
rm -rf "$TAR_STAGE/wechat-rpa/tests"
tar czf "$OUT_DIR/${MANIFEST_LINE_ID}-v${VERSION}.tar.gz" -C "$TAR_STAGE" .
rm -rf "$TAR_STAGE"
echo "[build-module] ${MANIFEST_LINE_ID}-v${VERSION}.tar.gz ready (-> $OUT_DIR/)"
