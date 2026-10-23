#!/usr/bin/env bash
set -euo pipefail
# One caller-owned 300s deadline covers original index, signed plan and install.
echo "PREFLIGHT_START smoke-os-packages elapsed_s=$SECONDS"
packages=(zsh python3 jq libxml2-utils)
for tool in ffmpeg zsh python3 jq xmllint; do
  echo "PREFLIGHT_TOOL $tool existing_path=$(command -v "$tool" || echo missing)"
done
# Preserve original capability installation, including already installed packages.
if ! command -v ffmpeg >/dev/null 2>&1; then packages+=(ffmpeg); fi
echo "PREFLIGHT_START smoke-original-index elapsed_s=$SECONDS"
sudo apt-get -o Acquire::Retries=1 -o Acquire::http::Timeout=20 -o Acquire::https::Timeout=20 -o APT::Update::Error-Mode=any update -qq
echo "PREFLIGHT_DONE smoke-original-index elapsed_s=$SECONDS"
bash .github/workflows/scripts/prepare-openclaw-os-packages.sh "${RUNNER_TEMP:-/tmp}" /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt "${packages[@]}"
for tool in ffmpeg zsh python3 jq xmllint; do
  echo "PREFLIGHT_TOOL $tool path=$(command -v "$tool")"
done
ffmpeg -version
zsh --version
python3 --version
jq --version
xmllint --version
echo "PREFLIGHT_DONE smoke-os-packages elapsed_s=$SECONDS"
