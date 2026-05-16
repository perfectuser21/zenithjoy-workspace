#!/usr/bin/env bash
# Sprint 2.1e — build install pack: pkg .exe + 组装产物 + reproducible tar.gz
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

VERSION=$(node -e "console.log(require('./package.json').version)")
PACK_NAME="zenithjoy-agent-v${VERSION}"
OUT_DIR="dist-installpack"
PACK_DIR="${OUT_DIR}/${PACK_NAME}"

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
cat > "${OUT_DIR}/manifest.json" <<JSON
{
  "version": "${VERSION}",
  "sha256": "${SHA}",
  "download_url": "/download/${PACK_NAME}.tar.gz",
  "size": ${SIZE},
  "build_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
JSON

echo "[build] OK — ${TAR_NAME} (${SIZE} bytes)"
ls -la "${OUT_DIR}/"
