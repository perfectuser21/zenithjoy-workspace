#!/usr/bin/env bash
set -euo pipefail
# One caller-owned 240s KILL boundary covers all acquisition and readbacks.
# Keep the original packages and existing signed-source/equal-plan installer.
echo "PREFLIGHT_START api-media-tools elapsed_s=$SECONDS"
cjk_font_ready() {
  local family font_file
  family=$(fc-match --format='%{family}' 'Noto Sans CJK SC:lang=zh-cn') || return 1
  font_file=$(fc-match --format='%{file}' 'Noto Sans CJK SC:lang=zh-cn') || return 1
  echo "PREFLIGHT_FONT family=$family file=$font_file"
  [[ "$family" == *'Noto Sans CJK SC'* && -s "$font_file" ]]
}
missing=0
for tool in ffmpeg ffprobe fc-match; do
  echo "PREFLIGHT_TOOL $tool existing_path=$(command -v "$tool" || echo missing)"
  if ! command -v "$tool" >/dev/null 2>&1; then missing=1; fi
done
if ! command -v fc-match >/dev/null 2>&1 || ! cjk_font_ready; then missing=1; fi
if [[ "$missing" == 1 ]]; then
  echo "PREFLIGHT_START api-media-original-index elapsed_s=$SECONDS"
  sudo apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o APT::Update::Error-Mode=any update
  echo "PREFLIGHT_DONE api-media-original-index elapsed_s=$SECONDS"
  bash .github/workflows/scripts/prepare-openclaw-os-packages.sh "${RUNNER_TEMP:-/tmp}" /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt ffmpeg fontconfig fonts-noto-cjk
fi
for tool in ffmpeg ffprobe fc-match; do
  echo "PREFLIGHT_TOOL $tool path=$(command -v "$tool")"
done
ffmpeg -version
ffprobe -version
fc-match --version
cjk_font_ready
echo "PREFLIGHT_DONE api-media-tools elapsed_s=$SECONDS"
