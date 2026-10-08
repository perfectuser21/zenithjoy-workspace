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
  aad17-2) export WFR_HOSTKEY=mmv;;
  *) print -u2 '执行机未登记'; exit 1;;
esac
if [[ "$WFR_HOSTKEY" == mmv ]]; then
  [[ "$WF_ARG_CAP" == douyin_comment_scoring && "$P" == mmv-scoring && "$SERIAL" == none ]] || { print -u2 'MMV只执行独立评论评分，禁止借用手机身份'; exit 1; }
  export LEADGEN_LOCAL_RPC=1
  export NODE_PATH="$HOME/.openclaw/leadgen-scripts/node_modules:$HOME/.openclaw/node_modules${NODE_PATH:+:$NODE_PATH}"
  if [[ -r "$HOME/.credentials/zenithjoy-db.env" ]]; then set -a; source "$HOME/.credentials/zenithjoy-db.env"; set +a; fi
elif [[ "$WF_ARG_CAP" == douyin_comment_scoring ]]; then
  print -u2 '独立评论评分必须在MMV运行'; exit 1
fi
export WF_HOME="${0:A:h}" WF_DEPLOYMENT_ROOT="${0:A:h}"
export WFR_RUN_ID="$WF_ARG_CAP-$WFR_TAG"
export WFR_RUN_DIR="${WFR_HOME:-$HOME/.config/zenithjoy}/ledger/$WFR_RUN_ID"
if [[ -r "$HOME/.credentials/brain.env" ]]; then
  set -a; source "$HOME/.credentials/brain.env"; set +a
fi
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
