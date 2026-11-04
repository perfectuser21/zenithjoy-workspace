#!/usr/bin/env bash
# Real build metadata -> isolated app process -> HTTP -> deployment assertion.
# This process serves app.ts only: it does not start production schedulers/workers.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
API_DIR="$ROOT/apps/api"
PROBE_DIR="$(mktemp -d)"
APP_PID=""
cleanup() {
  if [[ -n "$APP_PID" ]]; then kill "$APP_PID" 2>/dev/null || true; wait "$APP_PID" 2>/dev/null || true; fi
  rm -rf "$PROBE_DIR"
}
trap cleanup EXIT
source "$ROOT/.github/workflows/scripts/deploy-lib.sh"
KNOWN_SHA="$(git -C "$ROOT" rev-parse HEAD)"
(cd "$API_DIR" && BUILD_SHA="$KNOWN_SHA" npm run build > "$PROBE_DIR/build.log" 2>&1) || { cat "$PROBE_DIR/build.log"; exit 1; }
node -e 'const fs=require("fs");if(JSON.parse(fs.readFileSync(process.argv[1])).sha!==process.argv[2])process.exit(1)' "$API_DIR/dist/build-info.json" "$KNOWN_SHA"
cat > "$PROBE_DIR/serve.cjs" <<'JS'
const fs=require('node:fs');
const http=require('node:http');
const app=require(process.env.SMOKE_API_APP).default;
const server=http.createServer(app);
server.listen(0,'127.0.0.1',()=>fs.writeFileSync(process.env.SMOKE_PORT_FILE,String(server.address().port)));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
JS
# No metadata override in the child: the HTTP SHA must come from the built JSON.
env -u BUILD_SHA -u BUILD_VERSION -u BUILD_TIME -u DATABASE_URL \
  NODE_ENV=test DATABASE_HOST=127.0.0.1 DATABASE_PORT=1 DATABASE_NAME=probe_no_database \
  SMOKE_API_APP="$API_DIR/dist/app.js" SMOKE_PORT_FILE="$PROBE_DIR/port" \
  node "$PROBE_DIR/serve.cjs" > "$PROBE_DIR/process.log" 2>&1 &
APP_PID=$!
for _ in $(seq 1 100); do
  kill -0 "$APP_PID" 2>/dev/null || { cat "$PROBE_DIR/process.log"; exit 1; }
  [[ -s "$PROBE_DIR/port" ]] && break
  sleep 0.1
done
[[ -s "$PROBE_DIR/port" ]] || { cat "$PROBE_DIR/process.log"; exit 1; }
BASE="http://127.0.0.1:$(cat "$PROBE_DIR/port")"
curl --fail --silent --show-error --max-time 5 "$BASE/health" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);if(d.status!=="ok"||d.build.sha!==process.argv[1])process.exit(1)})' "$KNOWN_SHA"
assert_version "$BASE" "$KNOWN_SHA"
if assert_version "$BASE" "wrong0000feedface"; then echo 'FAIL: mismatched running SHA passed'; exit 1; fi
kill -0 "$APP_PID"
echo 'PASS: real build metadata and isolated process SHA; wrong SHA rejected'
