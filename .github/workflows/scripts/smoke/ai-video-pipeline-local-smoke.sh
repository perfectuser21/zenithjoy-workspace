#!/usr/bin/env bash
# Real mounted API contract, limited to an explicitly disposable loopback fixture.
set -euo pipefail
[ "${SMOKE_SCRATCH_API:-}" = 1 ] || { echo 'FAIL: scratch API authorization required' >&2; exit 1; }
BASE_URL="${BASE_URL:-${API_BASE:-}}"
node - "$BASE_URL" <<'JS'
try{
 const u=new URL(process.argv[2]||'invalid:');
 if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid origin');
}catch{console.error('FAIL: explicit loopback scratch API origin required');process.exit(1);}
JS
BASE_URL="${BASE_URL%/}"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
AUTH=()
if [ -n "${LICENSE:-}" ]; then AUTH=(-H "Authorization: Bearer $LICENSE"); fi
request() {
  local expected=$1 output=$2; shift 2
  local code
  code=$(curl --noproxy '*' -sS --max-time 20 -o "$output" -w '%{http_code}' "${AUTH[@]}" "$@")
  [ "$code" = "$expected" ] || { echo "FAIL: local pipeline expected HTTP $expected, got $code" >&2; exit 1; }
}
request 201 "$TMP/create.json" -X POST "$BASE_URL/api/ai-video-pipeline" -H 'Content-Type: application/json' \
  -d '{"local_path":"/tmp/ci-pipeline-input.mp4","topic":"isolated CI contract","original_script":"CI source script","target_aspect":"9:16"}'
JOB_ID=$(node - "$TMP/create.json" <<'JS'
const assert=require('node:assert/strict'),d=JSON.parse(require('node:fs').readFileSync(process.argv[2]));
assert.deepEqual(Object.keys(d),['job']);assert.match(d.job.id,/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
assert.equal(d.job.status,'pending');assert.equal(d.job.original_script,'CI source script');assert.equal(d.job.target_aspect,'9:16');assert.equal(d.job.detected_aspect,null);process.stdout.write(d.job.id);
JS
)
request 200 "$TMP/get.json" "$BASE_URL/api/ai-video-pipeline/$JOB_ID"
node - "$TMP/get.json" "$JOB_ID" <<'JS'
const a=require('node:assert/strict'),d=JSON.parse(require('node:fs').readFileSync(process.argv[2]));
a.equal(d.id,process.argv[3]);a.equal(d.status,'pending');a.equal(d.original_script,'CI source script');a.equal(d.target_aspect,'9:16');a.equal(d.detected_aspect,null);
JS
request 400 "$TMP/missing.json" -X POST "$BASE_URL/api/ai-video-pipeline" -H 'Content-Type: application/json' -d '{"topic":"missing local path"}'
node - "$TMP/missing.json" <<'JS'
require('node:assert/strict').equal(JSON.parse(require('node:fs').readFileSync(process.argv[2])).error,'local_path required');
JS
request 200 "$TMP/complete.json" -X PUT "$BASE_URL/api/ai-video-pipeline/$JOB_ID/complete" -H 'Content-Type: application/json' -d '{"output_dir":"/tmp/ci-pipeline-output"}'
request 200 "$TMP/persisted.json" "$BASE_URL/api/ai-video-pipeline/$JOB_ID"
node - "$TMP/complete.json" "$TMP/persisted.json" "$JOB_ID" <<'JS'
const a=require('node:assert/strict'),fs=require('node:fs');
for(const file of process.argv.slice(2,4)){const d=JSON.parse(fs.readFileSync(file));a.equal(d.id,process.argv[4]);a.equal(d.status,'completed');a.equal(d.progress,100);a.equal(d.output_dir,'/tmp/ci-pipeline-output');}
JS
request 404 "$TMP/unknown.json" "$BASE_URL/api/ai-video-pipeline/00000000-0000-4000-8000-000000000000"
node - "$TMP/unknown.json" <<'JS'
require('node:assert/strict').equal(JSON.parse(require('node:fs').readFileSync(process.argv[2])).error,'job not found');
JS
echo 'PASS: disposable local pipeline create/get/validation/completion persistence/unknown-ID contracts'
