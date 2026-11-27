#!/usr/bin/env bash
set -euo pipefail
# The caller owns a 240s KILL deadline within the original5min step.
# The shared installer refreshes its own isolated Ubuntu indexes.
echo "PREFLIGHT_START agent-media-tools elapsed_s=$SECONDS"
missing=0
for tool in ffmpeg ffprobe; do
  echo "PREFLIGHT_TOOL $tool existing_path=$(command -v "$tool" || echo missing)"
  if ! command -v "$tool" >/dev/null 2>&1; then missing=1; fi
done
if [[ "$missing" == 1 ]]; then
  bash .github/workflows/scripts/prepare-openclaw-os-packages.sh "${RUNNER_TEMP:-/tmp}" /etc/apt/sources.list.d/ubuntu.sources /etc/apt/apt-mirrors.txt ffmpeg
fi
for tool in ffmpeg ffprobe; do
  echo "PREFLIGHT_TOOL $tool path=$(command -v "$tool")"
done
ffmpeg -version
ffprobe -version
echo "PREFLIGHT_DONE agent-media-tools elapsed_s=$SECONDS"
