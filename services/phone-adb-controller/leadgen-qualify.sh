#!/bin/zsh
set -uo pipefail
exec node "${0:A:h}/leadgen-client.mjs" qualify "$@"
