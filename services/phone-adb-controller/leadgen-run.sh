#!/bin/zsh
# 四独立流程唯一生产入口。用发布计划冻结整包，再绑定ACK，最后执行冻结字节。
set -euo pipefail
setopt extendedglob
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
(( $# >= 4 && $# <= 5 )) || { print -u2 '用法: leadgen-run.sh FLOW PROFILE SERIAL LINE [RUN_TAG]'; exit 2; }
export WF_ARG_CAP="$1" P="$2" SERIAL="$3" LEADGEN_LINE="$4" WFR_TAG="${5:-new$(date +%m%d%H%M%S)}"
case "$WF_ARG_CAP" in
  douyin_video_discovery|douyin_video_processing|douyin_comment_scoring|douyin_lead_outreach) ;;
  *) print -u2 '拒绝非四新流程入口'; exit 2;;
esac
[[ "$WFR_TAG" == [A-Za-z0-9_-]## ]] || { print -u2 '运行标记无效'; exit 2; }
case "$(hostname -s)" in
  *m4-xian*) export WFR_HOSTKEY=xian-m4;;
  *m1-us*) export WFR_HOSTKEY=xian-m1;;
  aad17-2|r10-7) export WFR_HOSTKEY=mmv;;
  *) print -u2 '执行机未登记'; exit 1;;
esac
if [[ "$WFR_HOSTKEY" == mmv ]]; then
  if [[ "$WF_ARG_CAP" == douyin_comment_scoring && "$P" == mmv-scoring && "$SERIAL" == none ]]; then
    : # 原独立评分身份不依赖手机registry或ADB。
  elif [[ "${LEADGEN_MMV_DEVICE_RUNTIME:-}" == 1 && "$WF_ARG_CAP" != douyin_comment_scoring ]]; then
    [[ "$P" == [A-Za-z0-9_.-]## && "$P" != mmv-scoring && "$SERIAL" == [A-Za-z0-9_.:-]## && "$SERIAL" != none ]] || { print -u2 'MMV_DEVICE_REGISTRY_INVALID: 手机身份必须显式且精确'; exit 1; }
    export DOUYIN_PHONE_REGISTRY="${DOUYIN_PHONE_REGISTRY:-$HOME/.config/openclaw/douyin-phone-profiles.tsv}"
    [[ "$DOUYIN_PHONE_REGISTRY" == /* && -f "$DOUYIN_PHONE_REGISTRY" && -r "$DOUYIN_PHONE_REGISTRY" ]] || { print -u2 'MMV_DEVICE_REGISTRY_INVALID: 当前registry不可读'; exit 1; }
    # 手机入口不为legacy空enabled猜启用；匹配profile和serial均须在当前表唯一。
    /usr/bin/awk -F'\t' -v profile="$P" -v serial="$SERIAL" '
      {sub(/\r$/, "")}
      $1=="profile" || $1=="#profile" {
        if(header){bad=1;next}
        header=1;columns=NF
        for(i=1;i<=NF;i++){name=$i;sub(/^#/,"",name);if(name==""||seen[name]++)bad=1;c[name]=i}
        if(c["profile"]!=1||!c["serial"]||!c["enabled"])bad=1
        next
      }
      /^#/ || /^[ \t]*$/ {next}
      !header {bad=1;next}
      {
        if(NF!=columns){bad=1;next}
        for(i=1;i<=NF;i++)gsub(/^[ \t]+|[ \t]+$/, "", $i)
        if($(c["profile"])==profile)profiles++
        if($(c["serial"])==serial)serials++
        if($(c["profile"])==profile&&$(c["serial"])==serial&&$(c["enabled"])=="true")enabled++
      }
      END {if(bad||!header||profiles!=1||serials!=1||enabled!=1)exit 1}
    ' "$DOUYIN_PHONE_REGISTRY" || { print -u2 'MMV_DEVICE_REGISTRY_BINDING_INVALID: profile/serial须唯一精确enabled'; exit 1; }
    [[ "${DOUYIN_ADB_PORT:-}" == <-> ]] && (( DOUYIN_ADB_PORT >= 1 && DOUYIN_ADB_PORT <= 65535 )) || { print -u2 'MMV_DEVICE_ADB_ROUTE_INVALID: 缺有效显式既有端口'; exit 1; }
    [[ "${ADB_SERVER_SOCKET:-}" == "tcp:localhost:$DOUYIN_ADB_PORT" || "${ADB_SERVER_SOCKET:-}" == "tcp:127.0.0.1:$DOUYIN_ADB_PORT" ]] || { print -u2 'MMV_DEVICE_ADB_ROUTE_INVALID: socket与本机既有端口不一致'; exit 1; }
    # 只读smart-socket，不调用adb及其可能自动start-server的客户端路径。
    node --input-type=module - "$DOUYIN_ADB_PORT" <<'NODE' || { print -u2 'MMV_DEVICE_ADB_UNAVAILABLE: 既有ADB服务不可确认'; exit 1; }
import net from 'node:net';
const socket=net.createConnection({host:'127.0.0.1',port:Number(process.argv[2])});
let bytes=Buffer.alloc(0),done=false;
const timer=setTimeout(()=>finish(false),1500);
function finish(ok){if(done)return;done=true;clearTimeout(timer);socket.destroy();process.exitCode=ok?0:1;}
socket.on('connect',()=>socket.write('000chost:version'));
socket.on('error',()=>finish(false));
socket.on('end',()=>finish(false));
socket.on('data',chunk=>{
  bytes=Buffer.concat([bytes,chunk]);
  if(bytes.length>64)return finish(false);
  if(bytes.length<8)return;
  const length=bytes.subarray(4,8).toString();
  if(bytes.subarray(0,4).toString()!=='OKAY'||!/^\d{4}$/.test(length))return finish(false);
  const n=Number.parseInt(length,16);if(n<1||n>16)return finish(false);
  if(bytes.length<8+n)return;
  const version=bytes.subarray(8,8+n).toString();
  finish(/^[0-9a-fA-F]+$/.test(version)&&Number.parseInt(version,16)===41);
});
NODE
  else
    print -u2 'MMV只执行独立评论评分，禁止借用手机身份'; exit 1
  fi
  export LEADGEN_LOCAL_RPC=1
  export NODE_PATH="$HOME/.openclaw/leadgen-scripts/node_modules:$HOME/.openclaw/node_modules${NODE_PATH:+:$NODE_PATH}"
  if [[ -r "$HOME/.credentials/zenithjoy-db.env" ]]; then set -a; source "$HOME/.credentials/zenithjoy-db.env"; set +a; fi
elif [[ "$WF_ARG_CAP" == douyin_comment_scoring ]]; then
  print -u2 '独立评论评分必须在MMV运行'; exit 1
fi
export WF_HOME="${0:A:h}" WF_DEPLOYMENT_ROOT="${0:A:h}"
export WFR_RUN_ID="$WF_ARG_CAP-$WFR_TAG"
export WFR_RUN_DIR="${WFR_HOME:-$HOME/.config/zenithjoy}/ledger/$WFR_RUN_ID"
requested_brain_url="${BRAIN_URL:-}"
if [[ -r "$HOME/.credentials/brain.env" ]]; then
  set -a; source "$HOME/.credentials/brain.env"; set +a
fi
if [[ -n "$requested_brain_url" ]]; then export BRAIN_URL="$requested_brain_url"; fi
export WF_PLAN_PATH="$WF_HOME/plans/$WF_ARG_CAP.plan"
[[ -r "$WF_PLAN_PATH" ]] || { print -u2 '正式发布计划缺失'; exit 1; }
source "$WF_PLAN_PATH"
[[ "${WF_RUNNER:-}" == leadgen-workflow.mjs && -z "${WF_MISSING:-}" ]] || { print -u2 '计划缺正式实现'; exit 1; }
export WF_BRAIN_WORKFLOW WF_CONTRACT_RAW_SHA256 WF_ACTIVITY_REFS WF_STEP_SPEC
node "$WF_HOME/runtime-receipts.mjs" prepare
# 从此不再执行部署目录中的业务代码。
export WF_HOME="$WFR_RUN_DIR/runtime"
source "$WFR_RUN_DIR/workflow.plan"
export WF_RUNNER WF_BRAIN_WORKFLOW WF_CONTRACT_RAW_SHA256 WF_ACTIVITY_REFS WF_STEP_SPEC
bound="$(node "$WF_HOME/runtime-receipts.mjs" bind-run)"
eval "$bound"
export WFR_ATTEMPT WFR_SKIP_WORDS
export WF_RUN_START_TS="$(date +%s)" WF_RUN_MAX_SECONDS="${WF_RUN_MAX_SECONDS:-1800}"
export WF_STOP_FILE="$HOME/wf-runs/$WFR_TAG.stop"
print -r -- "WF_RUN_STARTED tag=$WFR_TAG flow=$WF_ARG_CAP"
exec node "$WF_HOME/leadgen-workflow.mjs"
