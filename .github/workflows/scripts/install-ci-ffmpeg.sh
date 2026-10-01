#!/usr/bin/env bash
set -euo pipefail

# Acquisition limits never interrupt dpkg: acquire first, then install offline.
if ! command -v ffmpeg >/dev/null 2>&1 || ! command -v ffprobe >/dev/null 2>&1; then
  if [[ "${GITHUB_ACTIONS:-}" != true || "$(uname -s)" != Linux ]]; then
    echo 'ffmpeg acquisition requires an Ubuntu GitHub Actions runner' >&2
    exit 1
  fi
  codename=$(lsb_release -cs)
  [[ "$codename" =~ ^[a-z]+$ ]] || { echo 'invalid Ubuntu codename' >&2; exit 1; }
  fetch_dir=$(mktemp -d)
  trap 'rm -rf "$fetch_dir"' EXIT
  apt_transport=(-o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30 -o Acquire::Retries=0 -o APT::Update::Error-Mode=any)

  fetch_packages() {
    sudo timeout --kill-after=10s 120s apt-get "${apt_transport[@]}" "$@" update \
      && sudo timeout --kill-after=10s 180s apt-get "${apt_transport[@]}" "$@" \
        --download-only --no-install-recommends -y install ffmpeg
  }

  # Keep a nonempty array for macOS Bash 3.2's nounset behavior as well.
  sources=(-o APT::Install-Recommends=false)
  if ! fetch_packages; then
    echo 'default APT acquisition failed or exceeded its deadline; using signed official Ubuntu sources' >&2
    cat > "$fetch_dir/official.list" <<EOF
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu $codename main universe
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://archive.ubuntu.com/ubuntu $codename-updates main universe
deb [signed-by=/usr/share/keyrings/ubuntu-archive-keyring.gpg] https://security.ubuntu.com/ubuntu $codename-security main universe
EOF
    sources=(-o "Dir::Etc::sourcelist=$fetch_dir/official.list" -o 'Dir::Etc::sourceparts=-')
    # Only this invocation receives alternate sources; no /etc/apt files change.
    fetch_packages "${sources[@]}"
  fi
  sudo apt-get "${sources[@]}" --no-download --no-install-recommends -y install ffmpeg
fi

# Presence alone is insufficient, and pipefail preserves either tool's failure.
ffmpeg -version > /dev/null
ffprobe -version > /dev/null
