#!/usr/bin/env bash
# Business bootstrap adapter, maintained in zenithjoy-skills/distribution.
set -euo pipefail
root="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
[[ -f "$root/.skills-source.json" ]] || exit 0
python_bin=python3
command -v python3 >/dev/null 2>&1 || python_bin=python
args=(--workspace "$root")
if [[ -n "${SKILLS_SOURCE_DIR:-}" ]]; then args+=(--source "$SKILLS_SOURCE_DIR"); fi
"$python_bin" "$root/scripts/skills-source.py" install "${args[@]}"
"$python_bin" "$root/scripts/skills-source.py" verify "${args[@]}"
