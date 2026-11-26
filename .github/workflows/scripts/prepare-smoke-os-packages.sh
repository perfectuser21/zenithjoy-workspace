#!/usr/bin/env bash
set -euo pipefail
# One caller-owned 300s deadline covers signed index refresh and installation.
echo "PREFLIGHT_START smoke-os-packages elapsed_s=$SECONDS"
packages=(zsh python3 jq libxml2-utils fontconfig fonts-noto-cjk postgresql)
for tool in ffmpeg zsh python3 jq xmllint; do
  echo "PREFLIGHT_TOOL $tool existing_path=$(command -v "$tool" || echo missing)"
done
# Preserve original capability installation, including already installed packages.
if ! command -v ffmpeg >/dev/null 2>&1; then packages+=(ffmpeg); fi
# APT's _apt sandbox needs to traverse the path to its mirror cache.
bash .github/workflows/scripts/prepare-openclaw-os-packages.sh --runner-sources /tmp /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt "${packages[@]}"
for tool in ffmpeg zsh python3 jq xmllint; do
  echo "PREFLIGHT_TOOL $tool path=$(command -v "$tool")"
done
ffmpeg -version
zsh --version
python3 --version
jq --version
xmllint --version
echo "PREFLIGHT_DONE smoke-os-packages elapsed_s=$SECONDS"
