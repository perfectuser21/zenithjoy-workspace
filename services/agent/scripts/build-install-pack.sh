#!/usr/bin/env bash
# Sprint 2.1e — build install pack: pkg .exe + 组装产物 + reproducible tar.gz
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

VERSION=$(node -e "console.log(require('./package.json').version)")
PACK_NAME="zenithjoy-agent-v${VERSION}"
OUT_DIR="dist-installpack"
PACK_DIR="${OUT_DIR}/${PACK_NAME}"

# ── 版本冲突检查 ──────────────────────────────────────────────────────────────
# 防止用相同版本号覆盖已有包（同版本内容不同会导致 sha256 校验混乱）
if [ -f "${OUT_DIR}/${PACK_NAME}.tar.gz" ]; then
    echo "[build] ERROR: ${PACK_NAME}.tar.gz 已存在！"
    echo "[build] 请先在 package.json 里 bump 版本号，再重新 build。"
    exit 1
fi

echo "[build] cleaning ${OUT_DIR}/"
rm -rf "$OUT_DIR"
mkdir -p "$PACK_DIR"

echo "[build] running pkg (npm run package:win)"
npm run package:win 2>&1 | tail -10

if [ ! -f "zenithjoy-agent.exe" ]; then
    echo "ERROR: zenithjoy-agent.exe not produced by pkg"
    exit 1
fi

echo "[build] ensuring ffmpeg Windows binaries..."
# ffmpeg.exe / ffprobe.exe are large binaries — not in git (.gitignore).
# Download from BtbN's GPL build if not already cached in install-pack/.
FFMPEG_ZIP_URL="https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
FFMPEG_TMP="/tmp/ffmpeg-win64-latest.zip"
if [ ! -f "install-pack/ffmpeg.exe" ] || [ ! -f "install-pack/ffprobe.exe" ]; then
    echo "[build] downloading ffmpeg Windows binaries (~90MB)..."
    curl -L --retry 3 -o "$FFMPEG_TMP" "$FFMPEG_ZIP_URL"
    unzip -p "$FFMPEG_TMP" "*/bin/ffmpeg.exe" > install-pack/ffmpeg.exe
    unzip -p "$FFMPEG_TMP" "*/bin/ffprobe.exe" > install-pack/ffprobe.exe
    rm -f "$FFMPEG_TMP"
    echo "[build] ffmpeg binaries cached in install-pack/"
else
    echo "[build] ffmpeg binaries already cached, skipping download"
fi

echo "[build] copying assets to ${PACK_DIR}/"
cp zenithjoy-agent.exe "$PACK_DIR/"
cp install-pack/start.bat "$PACK_DIR/"
cp install-pack/uninstall.bat "$PACK_DIR/"
cp install-pack/.env.template "$PACK_DIR/"
cp "install-pack/README-1分钟跑通.txt" "$PACK_DIR/"
cp install-pack/ffmpeg.exe "$PACK_DIR/"
cp install-pack/ffprobe.exe "$PACK_DIR/"
echo "[build] ffmpeg.exe + ffprobe.exe included in pack"

echo "[build] copying publishers/ (douyin-publisher et al)"
cp -r publishers/ "$PACK_DIR/publishers/"
echo "[build] publishers/ included in pack"

echo "[build] ensuring portable Node.js for Windows..."
# Node.js portable zip from npmmirror (China-friendly CDN).
# Bundled so users with zero Node.js installed can get hyperframes on first run.
NODE_VERSION="22.16.0"
NODE_ZIP_NAME="node-v${NODE_VERSION}-win-x64.zip"
NODE_ZIP_URL="https://registry.npmmirror.com/-/binary/node/v${NODE_VERSION}/${NODE_ZIP_NAME}"
NODE_ZIP_CACHE="install-pack/${NODE_ZIP_NAME}"
if [ ! -f "$NODE_ZIP_CACHE" ]; then
    echo "[build] downloading portable Node.js ${NODE_VERSION} for Windows (~28MB)..."
    curl -L --retry 3 -o "$NODE_ZIP_CACHE" "$NODE_ZIP_URL"
    echo "[build] Node.js zip cached in install-pack/"
else
    echo "[build] Node.js zip already cached, skipping download"
fi
cp "$NODE_ZIP_CACHE" "$PACK_DIR/node-win-x64.zip"
echo "[build] node-win-x64.zip included in pack (portable Node.js for hyperframes)"

echo "[build] bundling Playwright Chromium for Windows..."
# Playwright Chromium (Chrome for Testing) — 打进安装包，客户机无需单独安装浏览器。
# PLAYWRIGHT_BROWSERS_PATH 在 start.bat 里指向 playwright-browsers/，
# Playwright 会在 chromium-<rev>/chrome-win64/chrome.exe 找到它。
PW_CHROMIUM_REV=$(node -e "
const b = require('./node_modules/playwright-core/browsers.json');
const ch = b.browsers.find(x => x.name === 'chromium');
console.log(ch.revision);
")
PW_CHROMIUM_VER=$(node -e "
const b = require('./node_modules/playwright-core/browsers.json');
const ch = b.browsers.find(x => x.name === 'chromium');
console.log(ch.browserVersion || ch.revision);
")
CHROMIUM_ZIP_URL="https://cdn.playwright.dev/builds/cft/${PW_CHROMIUM_VER}/win64/chrome-win64.zip"
CHROMIUM_ZIP_CACHE="install-pack/chromium-win64-${PW_CHROMIUM_REV}.zip"
CHROMIUM_DEST_DIR="$PACK_DIR/playwright-browsers/chromium-${PW_CHROMIUM_REV}"
if [ ! -f "$CHROMIUM_ZIP_CACHE" ]; then
    echo "[build] downloading Playwright Chromium ${PW_CHROMIUM_VER} (rev ${PW_CHROMIUM_REV}, ~190MB)..."
    curl -L --retry 3 -o "$CHROMIUM_ZIP_CACHE" "$CHROMIUM_ZIP_URL"
    echo "[build] Playwright Chromium cached in install-pack/"
else
    echo "[build] Playwright Chromium already cached (rev ${PW_CHROMIUM_REV}), skipping download"
fi
mkdir -p "$CHROMIUM_DEST_DIR"
unzip -q "$CHROMIUM_ZIP_CACHE" -d "$CHROMIUM_DEST_DIR/"
echo "[build] playwright-browsers/chromium-${PW_CHROMIUM_REV}/ bundled"

echo "[build] reproducible tar.gz (mtime locked)"
TAR_NAME="${OUT_DIR}/${PACK_NAME}.tar.gz"
find "$PACK_DIR" -exec touch -t 202001010000.00 {} +
# GNU tar supports --sort=name / --owner / --mtime; BSD tar (macOS) does not.
# Detect and use gtar (brew install gnu-tar) if available, otherwise fall back to BSD tar.
if command -v gtar >/dev/null 2>&1; then
    gtar --sort=name \
        --owner=0 --group=0 --numeric-owner \
        --mtime='2020-01-01 00:00:00 UTC' \
        -czf "$TAR_NAME" -C "$OUT_DIR" "$PACK_NAME"
else
    # BSD tar fallback: mtime is already locked via touch above; no --sort (CI uses GNU tar on Linux)
    tar -czf "$TAR_NAME" -C "$OUT_DIR" "$PACK_NAME"
fi

echo "[build] sha256"
shasum -a 256 "$TAR_NAME" | tee "${TAR_NAME}.sha256"

echo "[build] manifest.json"
SIZE=$(wc -c < "$TAR_NAME" | tr -d ' ')
SHA=$(awk '{print $1}' "${TAR_NAME}.sha256")
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "${OUT_DIR}/manifest.json" <<JSON
{
  "version": "${VERSION}",
  "sha256": "${SHA}",
  "download_url": "/download/${PACK_NAME}.tar.gz",
  "size": ${SIZE},
  "build_time": "${BUILD_TIME}"
}
JSON

echo "[build] OK — ${TAR_NAME} (${SIZE} bytes)"
ls -la "${OUT_DIR}/"

# ── Notion 版本记录 ───────────────────────────────────────────────────────────
# 构建成功后自动往 Notion "ZenithJoy Agent 版本更新记录" 数据库写一条记录
NOTION_DB_ID="364c40c2-ba63-8125-8a9a-dbbdc486485b"
NOTION_TOKEN_FILE="${HOME}/.credentials/notion-agent-token"

# 读 token：优先本地缓存，次之从 1Password 拉
if [ -f "$NOTION_TOKEN_FILE" ]; then
    NOTION_TOKEN=$(cat "$NOTION_TOKEN_FILE")
elif command -v op >/dev/null 2>&1; then
    OP_TOKEN_FILE="${HOME}/.credentials/1password.env"
    if [ -f "$OP_TOKEN_FILE" ]; then
        # shellcheck disable=SC1090
        source "$OP_TOKEN_FILE"
        export OP_SERVICE_ACCOUNT_TOKEN
        NOTION_TOKEN=$(op item get "Notion" --vault CS --format json 2>/dev/null \
            | python3 -c "import json,sys; d=json.load(sys.stdin); print(next(f['value'] for f in d['fields'] if f.get('label','').lower()=='credential'))" 2>/dev/null || true)
        # 缓存到本地，下次不用再走 op
        if [ -n "$NOTION_TOKEN" ]; then
            echo "$NOTION_TOKEN" > "$NOTION_TOKEN_FILE"
            chmod 600 "$NOTION_TOKEN_FILE"
        fi
    fi
fi

if [ -z "${NOTION_TOKEN:-}" ]; then
    echo "[notion] WARN: 找不到 Notion token，跳过版本记录推送"
    echo "[notion] 提示：把 token 存到 ~/.credentials/notion-agent-token（chmod 600）"
else
    SIZE_MB=$(python3 -c "print(round($SIZE / 1024 / 1024, 1))")
    # 从 git log 取最近 commit message 作为更新内容
    CHANGES=$(git log --oneline -5 --no-merges 2>/dev/null | sed 's/"/\\"/g' | head -5 | tr '\n' ' ' || echo "v${VERSION} 发布")

    HTTP_STATUS=$(curl -s -o /tmp/notion-push.json -w "%{http_code}" \
        -X POST "https://api.notion.com/v1/pages" \
        -H "Authorization: Bearer $NOTION_TOKEN" \
        -H "Notion-Version: 2022-06-28" \
        -H "Content-Type: application/json" \
        -d "{
            \"parent\": {\"database_id\": \"$NOTION_DB_ID\"},
            \"properties\": {
                \"版本号\": {\"title\": [{\"text\": {\"content\": \"v${VERSION}\"}}]},
                \"发布日期\": {\"date\": {\"start\": \"$(date -u +%Y-%m-%d)\"}},
                \"更新内容\": {\"rich_text\": [{\"text\": {\"content\": \"${CHANGES}\"}}]},
                \"SHA256\": {\"rich_text\": [{\"text\": {\"content\": \"${SHA}\"}}]},
                \"包大小(MB)\": {\"number\": ${SIZE_MB}},
                \"构建时间(UTC)\": {\"rich_text\": [{\"text\": {\"content\": \"${BUILD_TIME}\"}}]}
            }
        }")

    if [ "$HTTP_STATUS" = "200" ]; then
        echo "[notion] ✅ 版本 v${VERSION} 已推送到 Notion 版本记录"
        echo "[notion] 链接: https://www.notion.so/364c40c2ba6381258a9adbbdc486485b"
    else
        echo "[notion] WARN: 推送失败 HTTP $HTTP_STATUS"
        cat /tmp/notion-push.json 2>/dev/null || true
    fi
fi
