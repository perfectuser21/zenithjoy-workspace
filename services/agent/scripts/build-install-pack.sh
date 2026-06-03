#!/usr/bin/env bash
# Sprint 2.1e — build install pack: pkg .exe + 组装产物 + reproducible tar.gz
set -euo pipefail

AGENT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$AGENT_DIR"

# ── Args: --dry-run (CI 静态验证，不下载二进制) / --out <dir> (自定义输出目录) ──
DRY_RUN=false
CUSTOM_OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --out) CUSTOM_OUT="$2"; shift ;;
    *) ;;
  esac
  shift
done

VERSION=$(node -e "console.log(require('./package.json').version)")
PACK_NAME="zenithjoy-agent-v${VERSION}"
OUT_DIR="dist-installpack"
if [ -n "$CUSTOM_OUT" ]; then
  PACK_DIR="$CUSTOM_OUT"
else
  PACK_DIR="${OUT_DIR}/${PACK_NAME}"
fi

# ── 版本冲突检查（dry-run 跳过）──────────────────────────────────────────────────
if [ "$DRY_RUN" = false ] && [ -f "${OUT_DIR}/${PACK_NAME}.tar.gz" ]; then
    echo "[build] ERROR: ${PACK_NAME}.tar.gz 已存在！"
    echo "[build] 请先在 package.json 里 bump 版本号，再重新 build。"
    exit 1
fi

echo "[build] cleaning and preparing ${PACK_DIR}/"
if [ "$DRY_RUN" = false ]; then
  rm -rf "$OUT_DIR"
fi
mkdir -p "$PACK_DIR"

# ── dry-run 模式：创建 stub 结构供 CI 静态验证（--dry-run --out <dir> 用）────────
if [ "$DRY_RUN" = true ]; then
  echo "[build-dryrun] 创建 python-embedded + wechat-rpa stub 结构..."

  # Python embeddable stub（正式模式见下方 Python embeddable 下载段）
  mkdir -p "${PACK_DIR}/python-embedded/Lib/site-packages"
  printf '# dry-run stub: python-embedded/python.exe\n' > "${PACK_DIR}/python-embedded/python.exe"
  echo "import site" > "${PACK_DIR}/python-embedded/python311._pth"
  echo "[build-dryrun] python-embedded/ stub 创建完成"

  # wechat-rpa 脚本拷贝
  mkdir -p "${PACK_DIR}/wechat-rpa"
  cp wechat-rpa/listen_chat.py "${PACK_DIR}/wechat-rpa/"
  cp wechat-rpa/send_chat.py "${PACK_DIR}/wechat-rpa/"
  for f in wechat-rpa/*.py; do cp "$f" "${PACK_DIR}/wechat-rpa/" 2>/dev/null || true; done
  echo "[build-dryrun] wechat-rpa/*.py 拷贝完成"

  # 文本资产（start.bat 含讲述人解锁命令）
  cp install-pack/start.bat "${PACK_DIR}/"
  cp install-pack/.env.template "${PACK_DIR}/" 2>/dev/null || true
  echo "[build-dryrun] start.bat + 文本资产拷贝完成"

  echo "[build-dryrun] PACK_DIR=${PACK_DIR} 内容: $(ls ${PACK_DIR}/)"
  echo "[build-dryrun] ✅ dry-run 验证结构就绪"
  exit 0
fi

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
# 进程守护：watchdog 崩溃自愈循环 + 开机自启注册脚本
cp install-pack/listener-watchdog.bat "$PACK_DIR/"
cp install-pack/install-autostart.ps1 "$PACK_DIR/"
cp install-pack/.env.template "$PACK_DIR/"
cp "install-pack/README-1分钟跑通.txt" "$PACK_DIR/"
cp install-pack/ffmpeg.exe "$PACK_DIR/"
cp install-pack/ffprobe.exe "$PACK_DIR/"
echo "[build] ffmpeg.exe + ffprobe.exe included in pack"

echo "[build] bundling Python 3.11 embeddable AMD64 (wechat-rpa 零依赖 Python 运行时)..."
# ── Python 3.11 embeddable + pywinauto/pywin32（R1/R2/R3 mitigation）────────────
PYTHON_VERSION="3.11.9"
PYTHON_EMBED_URL="https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip"
# SHA256 from python.org/downloads/release/python-3119/ — Windows embeddable (64-bit)
# 生产部署前必须从官网核对此值：export PYTHON_EMBED_SHA256=<real_hash>
PYTHON_EMBED_SHA256="${PYTHON_EMBED_SHA256:-0000000000000000000000000000000000000000000000000000000000000000}"
PYTHON_EMBED_CACHE="install-pack/python-${PYTHON_VERSION}-embed-amd64.zip"
PYTHON_EMBED_DIR="${PACK_DIR}/python-embedded"

if [ "$PYTHON_EMBED_SHA256" = "0000000000000000000000000000000000000000000000000000000000000000" ]; then
  echo "[build] WARN: PYTHON_EMBED_SHA256 未设置（使用 0 占位）— 正式发布前必须设置真实哈希"
  echo "[build]       https://www.python.org/downloads/release/python-3119/"
fi

if [ ! -f "$PYTHON_EMBED_CACHE" ]; then
  echo "[build] downloading Python ${PYTHON_VERSION} embeddable AMD64..."
  curl -L --retry 3 -o "$PYTHON_EMBED_CACHE" "$PYTHON_EMBED_URL"
fi
if [ "$PYTHON_EMBED_SHA256" != "0000000000000000000000000000000000000000000000000000000000000000" ]; then
  echo "${PYTHON_EMBED_SHA256}  ${PYTHON_EMBED_CACHE}" | shasum -a 256 --check || {
    echo "ERROR: Python embeddable SHA256 校验失败，请重新下载或更新 PYTHON_EMBED_SHA256"
    exit 1
  }
fi
mkdir -p "$PYTHON_EMBED_DIR"
unzip -q "$PYTHON_EMBED_CACHE" -d "$PYTHON_EMBED_DIR/"

# R1 mitigation: python311._pth 启用 import site（embeddable 默认禁用，导致 pip 包不可见）
PTH_FILE="${PYTHON_EMBED_DIR}/python311._pth"
if [ -f "$PTH_FILE" ]; then
  if grep -q "^#import site" "$PTH_FILE" 2>/dev/null; then
    perl -i -pe 's/^#import site/import site/' "$PTH_FILE"
  elif ! grep -q "^import site" "$PTH_FILE" 2>/dev/null; then
    echo "import site" >> "$PTH_FILE"
  fi
fi
# R2 mitigation: 把 pywinauto/pywin32/requests 装进 embedded 内部 site-packages（不污染系统 Python）。
# 跨平台关键：embeddable 不自带 pip；且 python.exe 是 Windows 二进制，macOS/Linux 打包机无法执行
# （原来 `python.exe -m pip install || true` 在非 Windows 静默失败 → site-packages 空 → 客户端炸）。
#   - Windows 打包机：embedded python.exe 先 get-pip bootstrap，再 pip install（真装）。
#   - macOS/Linux 打包机（含 GHA ubuntu / 本地 mac）：用宿主 python3 -m pip --platform win_amd64
#     --only-binary=:all: --target 把 Windows wheel 下载解压进 site-packages（纯下载解压，不执行 exe）。
SITE_PKGS="${PYTHON_EMBED_DIR}/Lib/site-packages"
mkdir -p "$SITE_PKGS"
WHEEL_PKGS="pywinauto pywin32 comtypes six requests"
GETPIP_URL="https://bootstrap.pypa.io/get-pip.py"
HOST_PY="${HOST_PYTHON:-python3}"

install_embedded_pkgs() {
  case "$(uname -s)" in
    *NT*|*MINGW*|*MSYS*|*CYGWIN*)
      # Windows 打包机：embeddable bootstrap pip 后真装
      curl -L --retry 3 -o "${PYTHON_EMBED_DIR}/get-pip.py" "$GETPIP_URL" || return 1
      "${PYTHON_EMBED_DIR}/python.exe" "${PYTHON_EMBED_DIR}/get-pip.py" --target "$SITE_PKGS" || return 1
      "${PYTHON_EMBED_DIR}/python.exe" -m pip install --target "$SITE_PKGS" $WHEEL_PKGS || return 1
      ;;
    *)
      # macOS/Linux 打包机：宿主 pip 跨平台下载 Windows wheel（cp311 / win_amd64）到 target
      "$HOST_PY" -m pip install \
        --target "$SITE_PKGS" \
        --platform win_amd64 \
        --python-version 3.11 \
        --implementation cp \
        --only-binary=:all: \
        --upgrade \
        $WHEEL_PKGS || return 1
      ;;
  esac
}

if install_embedded_pkgs; then
  echo "[build] python-embedded site-packages 已装 pywinauto + pywin32 + requests"
else
  echo "[build] WARN: pywinauto 预装失败（检查打包机网络/pip）— Windows runner 重打包可补装"
fi

# 验证 wheel 真落地 site-packages（跨平台都能查目录，不执行 Windows exe）
if [ -d "$SITE_PKGS/pywinauto" ]; then
  echo "[build] verified: site-packages/pywinauto/ 存在"
else
  echo "[build] WARN: site-packages/pywinauto/ 缺失 — 客户端 listen_chat 真模式将降级"
fi

# ── wechat-rpa 脚本打包 ──────────────────────────────────────────────────────────
echo "[build] copying wechat-rpa/*.py scripts..."
mkdir -p "${PACK_DIR}/wechat-rpa"
cp wechat-rpa/*.py "${PACK_DIR}/wechat-rpa/"
echo "[build] wechat-rpa scripts bundled: $(ls ${PACK_DIR}/wechat-rpa/)"

echo "[build] copying publishers/ (douyin-publisher et al)"
cp -r publishers/ "$PACK_DIR/publishers/"
echo "[build] publishers/ included in pack"

echo "[build] copying playwright-core npm package (pure JS, required by publisher scripts)"
# Publisher .cjs scripts run as external node processes — they cannot reach into the pkg
# virtual FS. playwright-core must exist on the real filesystem at <agent-dir>/node_modules/.
# Only copy JS files (lib/**/*.js + index.js) — browser binaries are in playwright-browsers/.
mkdir -p "$PACK_DIR/node_modules/playwright-core"
cp node_modules/playwright-core/package.json "$PACK_DIR/node_modules/playwright-core/"
cp node_modules/playwright-core/index.js "$PACK_DIR/node_modules/playwright-core/" 2>/dev/null || true
cp node_modules/playwright-core/browsers.json "$PACK_DIR/node_modules/playwright-core/" 2>/dev/null || true
cp -r node_modules/playwright-core/lib "$PACK_DIR/node_modules/playwright-core/" 2>/dev/null || true
echo "[build] playwright-core JS library included (browser binaries in playwright-browsers/)"

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

echo "[build] bundling Playwright Chromium Headless Shell for Windows..."
# Playwright headless launches use chromium-headless-shell, not the full Chrome for Testing.
# Expected path: playwright-browsers/chromium_headless_shell-<rev>/chrome-headless-shell-win64/chrome-headless-shell.exe
PW_HS_REV=$(node -e "
const b = require('./node_modules/playwright-core/browsers.json');
const ch = b.browsers.find(x => x.name === 'chromium-headless-shell');
console.log(ch.revision);
")
PW_HS_VER=$(node -e "
const b = require('./node_modules/playwright-core/browsers.json');
const ch = b.browsers.find(x => x.name === 'chromium-headless-shell');
console.log(ch.browserVersion || ch.revision);
")
HS_ZIP_URL="https://cdn.playwright.dev/builds/cft/${PW_HS_VER}/win64/chrome-headless-shell-win64.zip"
HS_ZIP_CACHE="install-pack/chromium-headless-shell-win64-${PW_HS_REV}.zip"
HS_DEST_DIR="$PACK_DIR/playwright-browsers/chromium_headless_shell-${PW_HS_REV}"
if [ ! -f "$HS_ZIP_CACHE" ]; then
    echo "[build] downloading Playwright Chromium Headless Shell ${PW_HS_VER} (rev ${PW_HS_REV}, ~60MB)..."
    curl -L --retry 3 -o "$HS_ZIP_CACHE" "$HS_ZIP_URL"
    echo "[build] Playwright Chromium Headless Shell cached in install-pack/"
else
    echo "[build] Playwright Chromium Headless Shell already cached (rev ${PW_HS_REV}), skipping download"
fi
mkdir -p "$HS_DEST_DIR"
unzip -q "$HS_ZIP_CACHE" -d "$HS_DEST_DIR/"
echo "[build] playwright-browsers/chromium_headless_shell-${PW_HS_REV}/ bundled"

# （python-embedded + pywinauto 预装 + wechat-rpa 脚本拷贝已在上方统一处理，去除重复块）

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
