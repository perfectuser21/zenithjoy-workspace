#!/usr/bin/env bash
# ============================================
# nas-fetch-content.sh — NAS 内容获取脚本
# 作用：通过 content-id 从 NAS 读取内容路径和元数据
# 供 publisher 脚本调用，实现 content-id → NAS 路径的解析
#
# 用法：
#   bash scripts/nas-fetch-content.sh --content-id 2026-03-16-a3f2b1
#   bash scripts/nas-fetch-content.sh --content-id 2026-03-16-a3f2b1 --field nas_path
#   bash scripts/nas-fetch-content.sh --content-id 2026-03-16-a3f2b1 --json
#
# 输出（默认，逐行）：
#   content_id:   2026-03-16-a3f2b1
#   title:        文章标题
#   content_type: long_form_article
#   nas_path:     /volume1/workspace/vault/zenithjoy-creator/content/2026-03-16-a3f2b1
#   exports_dir:  .../exports
#   images_dir:   .../images
#   status:       ready
#
# 输出（--json）：JSON 格式，供脚本解析
# 输出（--field xxx）：只输出指定字段值
# ============================================

set -euo pipefail

NAS_USER="徐啸"
NAS_IP="100.110.241.76"
NAS_BASE="/volume1/workspace/vault/zenithjoy-creator/content"

CONTENT_ID=""
OUTPUT_JSON=false
OUTPUT_FIELD=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --content-id) CONTENT_ID="$2"; shift 2 ;;
        --json)       OUTPUT_JSON=true; shift ;;
        --field)      OUTPUT_FIELD="$2"; shift 2 ;;
        *)
            echo "未知参数: $1" >&2
            echo "用法: $0 --content-id <id> [--json] [--field <field>]" >&2
            exit 1 ;;
    esac
done

if [[ -z "$CONTENT_ID" ]]; then
    echo "缺少 --content-id 参数" >&2
    exit 1
fi

NAS_CONTENT_DIR="${NAS_BASE}/${CONTENT_ID}"
MANIFEST_LOCAL="/tmp/nas-manifest-${CONTENT_ID}.json"

if ! scp -q -o StrictHostKeyChecking=no \
    "${NAS_USER}@${NAS_IP}:${NAS_CONTENT_DIR}/manifest.json" \
    "${MANIFEST_LOCAL}" 2>/dev/null; then
    echo "无法读取 content-id=${CONTENT_ID} 的 manifest" >&2
    echo "NAS 路径: ${NAS_CONTENT_DIR}" >&2
    exit 1
fi

TITLE=$(python3 -c "import json; d=json.load(open('$MANIFEST_LOCAL')); print(d.get('title',''))" 2>/dev/null || echo "")
RAW_TYPE=$(python3 -c "import json; d=json.load(open('$MANIFEST_LOCAL')); print(d.get('content_type',''))" 2>/dev/null || echo "")
STATUS=$(python3 -c "import json; d=json.load(open('$MANIFEST_LOCAL')); s=d.get('status',{}); print(s.get('state','') if isinstance(s,dict) else s)" 2>/dev/null || echo "")

case "$RAW_TYPE" in
    "article"|"deep-post"|"long_form_article") CONTENT_TYPE="long_form_article" ;;
    "image"|"image_text") CONTENT_TYPE="image_text" ;;
    "video") CONTENT_TYPE="video" ;;
    *) CONTENT_TYPE="$RAW_TYPE" ;;
esac

EXPORTS_DIR="${NAS_CONTENT_DIR}/exports"
IMAGES_DIR="${NAS_CONTENT_DIR}/images"
TEXT_DIR="${NAS_CONTENT_DIR}/text"

if [[ "$OUTPUT_JSON" == "true" ]]; then
    python3 - <<PYEOF
import json
print(json.dumps({
    "content_id":   "${CONTENT_ID}",
    "title":        "${TITLE}",
    "content_type": "${CONTENT_TYPE}",
    "status":       "${STATUS}",
    "nas_path":     "${NAS_CONTENT_DIR}",
    "exports_dir":  "${EXPORTS_DIR}",
    "images_dir":   "${IMAGES_DIR}",
    "text_dir":     "${TEXT_DIR}",
    "title_file":   "${EXPORTS_DIR}/title.txt",
    "content_html": "${EXPORTS_DIR}/content.html",
    "cover_image":  "${IMAGES_DIR}/${CONTENT_ID}-cover.png",
}, ensure_ascii=False, indent=2))
PYEOF
elif [[ -n "$OUTPUT_FIELD" ]]; then
    case "$OUTPUT_FIELD" in
        content_id)    echo "$CONTENT_ID" ;;
        title)         echo "$TITLE" ;;
        content_type)  echo "$CONTENT_TYPE" ;;
        status)        echo "$STATUS" ;;
        nas_path)      echo "$NAS_CONTENT_DIR" ;;
        exports_dir)   echo "$EXPORTS_DIR" ;;
        images_dir)    echo "$IMAGES_DIR" ;;
        text_dir)      echo "$TEXT_DIR" ;;
        title_file)    echo "${EXPORTS_DIR}/title.txt" ;;
        content_html)  echo "${EXPORTS_DIR}/content.html" ;;
        cover_image)   echo "${IMAGES_DIR}/${CONTENT_ID}-cover.png" ;;
        *)
            echo "未知字段: $OUTPUT_FIELD" >&2
            echo "可用: content_id title content_type status nas_path exports_dir images_dir text_dir title_file content_html cover_image" >&2
            exit 1 ;;
    esac
else
    echo "content_id:    $CONTENT_ID"
    echo "title:         $TITLE"
    echo "content_type:  $CONTENT_TYPE"
    echo "status:        $STATUS"
    echo "nas_path:      $NAS_CONTENT_DIR"
    echo "exports_dir:   $EXPORTS_DIR"
    echo "images_dir:    $IMAGES_DIR"
    echo "title_file:    ${EXPORTS_DIR}/title.txt"
    echo "content_html:  ${EXPORTS_DIR}/content.html"
    echo "cover_image:   ${IMAGES_DIR}/${CONTENT_ID}-cover.png"
fi

rm -f "$MANIFEST_LOCAL"
