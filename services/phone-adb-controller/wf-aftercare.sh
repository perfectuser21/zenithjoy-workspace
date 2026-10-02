#!/bin/zsh
# 通用协调器在 Cecelia；此处只提供真实收尾上下文，不在 EXIT 等待推理 tick。
escort_aftercare(){
  local id context
  [[ "${WFR_FINALIZE_OK:-0}" == 1 && -n "${WFR_BRAIN_TASK_ID:-}" ]] \
    || { log 'escort售后保留: finalize或Brain任务未确认'; return 0; }
  id=$(escort_by_name "escort-$HOSTKEY-$TAG")
  case "$id" in
    absent|unknown|ambiguous|'') log "escort售后保留: 同名身份未确认($id)"; return 0;;
  esac
  escort_adopt_id "$id" || { log 'escort售后保留: 本地身份回写失败'; return 0; }
  context=$(jq -cn --arg tag "$TAG" --arg host "$HOSTKEY" --arg id "$id" \
    --arg task "$WFR_BRAIN_TASK_ID" --arg idFile "${ESCORT_ID_FILE:-}" \
    --arg executionHost "${COMMANDER_EXECUTION_HOST:-$HOSTKEY}" \
    --arg brainUrl "${COMMANDER_AFTERCARE_BRAIN_URL:-http://localhost:5221}" \
    '{tag:$tag,host:$host,escortId:$id,taskId:$task,finalized:true,
      executionHost:$executionHost,idFile:$idFile,brainUrl:$brainUrl}') \
    || { log 'escort售后保留: 上下文生成失败'; return 0; }
  ssh -o BatchMode=yes -o ConnectTimeout=20 mmv \
    'node "$HOME/.local/share/cecelia/commander-runtime/scripts/commander-aftercare.mjs" --enqueue' \
    <<< "$context" >>${LOG:-/dev/null} 2>&1 \
    && log 'escort售后已交接: 程序等末轮完成后核验注销' \
    || log 'escort售后保留: 协调器不可用，未注销'
  return 0
}
