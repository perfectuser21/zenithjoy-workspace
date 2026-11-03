#!/usr/bin/env bash
# Prepare private employee instances only. API activation remains in the admitted
# HK API publisher, whose retained release includes this immutable overlay.
set -Eeuo pipefail
umask 077
ACTION=${1:-}
SHA=${2:-}
[[ ( "$ACTION" == prepare || "$ACTION" == prepare-staging ) && "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'usage: prepare FULL_SHA | prepare-staging FULL_SHA' >&2; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Production preparation requires the deployment owner' >&2; exit 1; }
REPO=/opt/zenithjoy/repo
RELEASES=/opt/zenithjoy/prod-api/releases
ROSTER=/opt/zenithjoy/prod-api/video-tools-roster.json
SERVICE=zenithjoy-api-prod
LOCK=/opt/zenithjoy/prod-api/release.lock
ENVIRONMENT=production
if [[ "$ACTION" == prepare-staging ]]; then
  RELEASES=/opt/zenithjoy/staging-api/releases
  ROSTER=/opt/zenithjoy/staging-api/video-tools-roster.json
  SERVICE=zenithjoy-api-staging
  LOCK=/opt/zenithjoy/staging-api/deploy.lock
  ENVIRONMENT=staging
fi
STAGING=/opt/zenithjoy/creative-canvas-staging/releases
mkdir -p "$RELEASES"
exec 9>"$LOCK"
flock -n 9 || { echo 'Another production publisher owns the host lock' >&2; exit 1; }
REMOTE_MAIN=$(flock "$REPO/.git/hk-source-fetch.lock" sh -c 'git -C "$1" fetch origin main && git -C "$1" rev-parse FETCH_HEAD' _ "$REPO")
[[ "$REMOTE_MAIN" =~ ^[a-f0-9]{40}$ ]]
git -C "$REPO" merge-base --is-ancestor "$SHA" "$REMOTE_MAIN"
SOURCE="$RELEASES/$SHA/source"
if [[ ! -f "$SOURCE/deploy/docker-compose.prod-api.yml" ]]; then
  TEMP=$(mktemp -d "$RELEASES/source.XXXXXX")
  trap 'rm -rf "$TEMP"' EXIT
  git -C "$REPO" archive "$SHA" | tar -x -C "$TEMP"
  test -f "$TEMP/scripts/deploy/video-tools-release.mjs"
  mkdir -p "$RELEASES/$SHA"
  mv "$TEMP" "$SOURCE"
  trap - EXIT
fi
git -C "$REPO" show "$SHA:scripts/deploy/video-tools-release.mjs" | cmp - "$SOURCE/scripts/deploy/video-tools-release.mjs"
# Promote the exact canvas image already exercised in staging. Do not rebuild
# production or use a mutable image tag as the identity.
IMAGE=$(python3 - "$STAGING/$SHA/receipt.json" "$SHA" <<'PY'
import json,sys,re
r=json.load(open(sys.argv[1])); assert r['sha']==sys.argv[2] and r['health']=='healthy', 'same-source canvas staging receipt missing'
assert re.fullmatch('sha256:[a-f0-9]{64}',r['image_id']), 'immutable canvas image missing'
print(r['image_id'])
PY
)
[[ $(docker image inspect "$IMAGE" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$SHA" ]]
if [[ "$ENVIRONMENT" == production ]]; then
  # This entry provisions a first private capability only. Updating a live
  # ComfyUI version needs a separate queue/instance/API recovery transaction.
  docker inspect "$SERVICE" | python3 -c '
import json,sys
c=json.load(sys.stdin)[0];e=dict(s.split("=",1) for s in c["Config"]["Env"] if "=" in s)
assert not json.loads(e.get("CREATIVE_CANVAS_INSTANCES","{}")), "production canvas version changes require a separate maintenance transaction; ordinary API releases inherit the active private configuration"
'
fi
EXTRA=()
if [[ "$ACTION" == prepare-staging ]]; then
  BASELINE="$RELEASES/$SHA/video-tools-baseline.json"
  if [[ ! -e "$BASELINE" ]]; then
    docker inspect "$SERVICE" | python3 -c '
import sys,json,os,subprocess,hashlib,re,urllib.parse
c=json.load(sys.stdin)[0]; e=dict(s.split("=",1) for s in c["Config"]["Env"] if "=" in s)
keys=["STAFF_EMAILS","CREATIVE_CANVAS_INSTANCES","CREATIVE_CANVAS_SERVICE_TOKENS","CREATIVE_CANVAS_ALLOWED_ORIGINS"]
baseline={"environment":{k:e[k] for k in keys if k in e},"networks":list(c["NetworkSettings"]["Networks"]),"stopped_handoffs":{}}
roster=json.load(open(sys.argv[2])); instances=json.loads(e.get("CREATIVE_CANVAS_INSTANCES","{}")); tokens=json.loads(e.get("CREATIVE_CANVAS_SERVICE_TOKENS","{}"))
for user in roster["users"]:
    if user["id"] not in instances: continue
    name=urllib.parse.urlparse(instances[user["id"]]).hostname
    old=json.loads(subprocess.check_output(["docker","inspect",name],text=True))[0]
    labels=old["Config"]["Labels"]; sha=labels.get("org.opencontainers.image.revision","")
    key=hashlib.sha256(json.dumps(user["id"],separators=(",",":")).encode()).hexdigest()[:20]
    expected="zj-canvas-stage-"+sha[:12]+"-"+key
    oldenv=dict(s.split("=",1) for s in old["Config"]["Env"] if "=" in s)
    assert re.fullmatch("[a-f0-9]{40}",sha) and name==expected and labels.get("com.zenithjoy.canvas.employee")==user["id"], "existing mapping is not this managed employee"
    assert labels.get("com.docker.compose.project")=="zenithjoy-canvases-staging-"+sha[:12], "existing employee canvas has unknown owner"
    assert oldenv.get("ZENITHJOY_CANVAS_TOKEN")==tokens.get(user["id"]), "existing instance token differs"
    assert any(m.get("Destination")=="/data" and m.get("Name")=="zj-canvas-stage-user-"+key+"-data" for m in old.get("Mounts",[])), "existing data ownership differs"
    assert old["State"]["Running"] is False, "existing employee canvas still runs; obtain a stopped-instance maintenance handoff first"
    baseline["stopped_handoffs"][user["id"]]={"instance":instances[user["id"]],"token":tokens[user["id"]]}
with open(sys.argv[1],"x") as f: json.dump(baseline,f)
' "$BASELINE" "$ROSTER"
  fi
  EXTRA=("$BASELINE")
fi
python3 - "$ROSTER" "$ENVIRONMENT" <<'PY'
import json,sys
assert json.load(open(sys.argv[1])).get('environment','production')==sys.argv[2], 'roster environment differs from target'
PY
node "$SOURCE/scripts/deploy/video-tools-release.mjs" prepare "$RELEASES" "$ROSTER" "$SHA" "$IMAGE" "${EXTRA[@]}"
# Verify exact registered identities and employee membership using a read-only
# transaction in the existing production service. No session/token is selected.
# Pipe only public identities; the private roster is never sent to the API.
python3 - "$RELEASES/$SHA/canvas-plan.json" <<'PY' | docker exec -i "$SERVICE" node -e '
const {Client}=require("pg");let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",async()=>{const e=process.env,c=new Client({host:e.DATABASE_HOST,port:Number(e.DATABASE_PORT||5432),database:e.DATABASE_NAME,user:e.DATABASE_USER,password:e.DATABASE_PASSWORD});try{const plan=JSON.parse(text),users=plan.users,staff=new Set((e.STAFF_EMAILS||"").split(",").map(x=>x.trim().toLowerCase()));if(plan.environment!==process.argv[1])throw Error("Target environment differs");if(e.DATABASE_NAME!==(plan.environment==="staging"?"zenithjoy_staging":"zenithjoy"))throw Error("Target database differs");await c.connect();await c.query("BEGIN READ ONLY");for(const u of users){if(plan.environment==="production"&&!staff.has(u.email))throw Error("Employee is not enabled in production staff directory");const r=await c.query("SELECT id,email FROM zenithjoy.\"user\" WHERE id=$1 AND lower(email)=$2",[u.id,u.email]);if(r.rowCount!==1)throw Error("Employee identity differs from target registry");}await c.query("ROLLBACK");console.log(JSON.stringify({registered_employees_verified:users.length}));}catch(error){console.error("Target employee verification failed");process.exitCode=1;}finally{await c.end();}});' "$ENVIRONMENT"
import json,sys
p=json.load(open(sys.argv[1]));print(json.dumps({'users':p['users'],'environment':p['environment']}))
PY
PROJECT="zenithjoy-canvases-$ENVIRONMENT-${SHA:0:12}"
COMPOSE="$RELEASES/$SHA/canvas-compose.json"
docker compose -p "$PROJECT" -f "$COMPOSE" config -q
# Never take over an unrelated existing container. The generated service names
# are revision-specific; persistent employee volumes have stable identities.
python3 - "$COMPOSE" "$PROJECT" <<'PY'
import json,sys,subprocess
d=json.load(open(sys.argv[1])); project=sys.argv[2]
for value in d['services'].values():
    p=subprocess.run(['docker','inspect',value['container_name']],capture_output=True,text=True)
    if p.returncode==0:
        c=json.loads(p.stdout)[0]
        assert c['Config']['Labels'].get('com.docker.compose.project')==project, 'canvas container belongs to another project'
# An old version may still own this employee's persistent data or queue. Refuse
# an overlapping rollout rather than stopping it or mounting its live volume.
ids=subprocess.check_output(['docker','ps','-q'],text=True).split()
current=json.loads(subprocess.check_output(['docker','inspect',*ids],text=True)) if ids else []
for value in d['services'].values():
    volume=value['volumes'][0].split(':')[0]
    for c in current:
        if any(m.get('Name')==volume for m in c.get('Mounts',[])):
            assert c['Name'].lstrip('/')==value['container_name'], 'another active canvas owns employee volume; require a quiescent maintenance handoff'
PY
docker compose -p "$PROJECT" -f "$COMPOSE" up -d --no-build --pull never
for ((i=0;i<40;i++)); do
  if node "$SOURCE/scripts/deploy/video-tools-release.mjs" verify-instances "$RELEASES/$SHA/canvas-plan.json" >/dev/null 2>&1; then
    echo "Private $ENVIRONMENT canvases prepared at $SHA; API activation has not run"
    exit 0
  fi
  sleep 5
done
echo 'Private canvas health failed; API unchanged, preserve private data and inspect this release' >&2
exit 1
