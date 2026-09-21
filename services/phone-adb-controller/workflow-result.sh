#!/usr/bin/env bash
# workflow-result.sh — crontab 获客流水线的 WORKER_RESULT 工件写手（基座 1/7）。
# 永远 exit 0，绝不阻塞主流程（照 wall-report.sh 范式）。子命令把导出变量打印到 stdout，调用方 eval。
# 用法:
#   eval "$(workflow-result.sh init <TAG> <profile> <wordfile> <push> <serial> <hostkey>)"
#   eval "$(workflow-result.sh enter)"
#   workflow-result.sh stage <stage> <completed|blocked|failed> <n> <summary> <evidence_json> <metrics_json> [<word>]
#   eval "$(workflow-result.sh finalize)"
#   workflow-result.sh hash <profile> <wordfile> <push>
# 契约: protocol.md WORKER_RESULT（schema_version=2 / evidence 非空 / metrics 闭集）；判定点 544cd6a3 判据用产物。
set -u
WFR_HOME="${WFR_HOME:-$HOME/.config/zenithjoy}"
WFR_NODE="${WFR_NODE:-/opt/homebrew/bin/node}"
WFR_JQ="${WFR_JQ:-/usr/bin/jq}"
WFR_LEDGER_MJS="${WFR_LEDGER_MJS:-$HOME/bin-harvest/ledger.mjs}"
WFR_SCP_TARGET="${WFR_SCP_TARGET-mmv:/Users/administrator/openclaw-root/workspaces-root/clawd-work-commander/state/workflow-runs/}"
warn(){ echo "WFR_WARN $(date +%m%d-%H:%M:%S) $*" >&2; }
led(){ "$WFR_NODE" "$WFR_LEDGER_MJS" "$@" --run-dir "$WFR_RUN_DIR" 2>&1 | tail -1; }

sha(){ if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -c1-64; else shasum -a 256 | cut -c1-64; fi; }
calc_hash(){ # profile wordfile push —— 不含 TAG、不含 SERIAL（请求身份与设备无关）
  { printf '%s|' "$1"; sort "$2" | grep -v '^$' | paste -sd'|' - ; printf '|six_months|most_liked|unlimited|%s' "$3"; } 2>/dev/null | sha
}

# metrics 闭集（protocol.md「metrics 封闭键集」逐字）
COMMON="external_interactions business_reads business_writes artifact_writes"
req_keys(){ case "$1" in
  preflight) echo "device_verified account_verified call_state_idle lock_acquired";;
  discovery) echo "keywords_processed screens_scanned candidates";;
  qualification) echo "candidates_judged qualified";;
  collection) echo "comments_collected videos_processed cursor_updates";;
  scoring) echo "comments_scored strong_intent weak_intent peer irrelevant spam";;
  delivery) echo "leads_written duplicates_skipped readback_verified cursor_updates";;
  cleanup) echo "close_app_attempts lock_released safe_desktop_visible";;
  *) echo "";; esac; }
next_action(){ case "$1" in completed) echo accept;; blocked) echo block;; failed) echo retry;; *) echo stop;; esac; }

# 写一个工件：stage status n summary evidence_json metrics_json [word]
write_stage(){
  local stage="$1" status="$2" n="$3" summary="$4" evidence="$5" metrics="$6" word="${7:-}"
  local attempt="${WFR_ATTEMPT:-a0}"
  local f="$WFR_ART_DIR/${WFR_RUN_ID}__${attempt}.${stage}.${n}.worker-result.json"
  local keys; keys="$COMMON $(req_keys "$stage")"
  # 通用键缺省补 0，阶段键必须由调用方给（缺了校验会拒）
  local body
  body=$("$WFR_JQ" -n --arg run "$WFR_RUN_ID" --arg att "$attempt" --arg st "$stage" --argjson n "$n" \
      --arg hash "$WFR_HASH" --arg status "$status" --arg na "$(next_action "$status")" --arg sum "$summary" \
      --argjson ev "$evidence" --argjson m "$metrics" \
      '{schema_version:2,run_id:$run,attempt_id:$att,stage_id:$st,stage_attempt:$n,task_request_hash:$hash,
        status:$status,recommended_next_action:$na,summary:$sum,evidence:$ev,artifacts:[],
        metrics:({external_interactions:0,business_reads:0,business_writes:0,artifact_writes:0}+$m),
        observed_at:(now|todate)}' 2>&1) || { warn "stage=$stage jq build failed: $body"; return 0; }
  local err
  if ! err=$(printf '%s\n' "$body" > "$f" 2>&1); then warn "stage=$stage write failed errno: $err"; return 0; fi
  [[ -s "$f" ]] || { warn "stage=$stage write produced empty file (errno: $(ls -ld "$WFR_ART_DIR" 2>&1))"; return 0; }
  # 校验：判据用产物（判定点 544cd6a3）
  local jqf='.schema_version==2 and (.status|IN("completed","blocked","failed")) and (.recommended_next_action|IN("accept","steer","retry","block","stop")) and (.evidence|type=="array") and ((.status!="completed") or (.evidence|length>=1))'
  for k in $keys; do jqf="$jqf and (.metrics.\"$k\"|type==\"number\")"; done
  if ! "$WFR_JQ" -e "$jqf" "$f" >/dev/null 2>&1; then warn "stage=$stage artifact invalid, removed: $f"; rm -f "$f"; return 0; fi
  if [[ -n "$word" ]]; then led set --stage "$stage" --status "$status" --n "$n" --word "$word" --note "$summary" >/dev/null
  else led set --stage "$stage" --status "$status" --note "$summary" >/dev/null; fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  hash) echo "WFR_HASH=$(calc_hash "$1" "$2" "$3")";;
  init)
    TAG="$1"; P="$2"; WF="$3"; PUSH="$4"; SERIAL="${5:-}"; HOSTKEY="${6:-}"
    WFR_RUN_ID="social-keyword-leadgen-crontab-$TAG"
    WFR_HASH="$(calc_hash "$P" "$WF" "$PUSH")"
    WFR_RUN_DIR="$WFR_HOME/ledger/$WFR_RUN_ID"; WFR_ART_DIR="$WFR_HOME/workflow-runs"
    mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>/dev/null || warn "mkdir failed errno: $(mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>&1)"
    led init --run-id "$WFR_RUN_ID" --hash "$WFR_HASH" --profile "$P" --serial "$SERIAL" --hostkey "$HOSTKEY" >/dev/null
    export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR
    write_stage preflight completed 1 "device+account preflight by harvest-cron" \
      "[{\"type\":\"preflight\",\"serial\":\"$SERIAL\",\"hostkey\":\"$HOSTKEY\"}]" \
      '{"device_verified":1,"account_verified":0,"call_state_idle":1,"lock_acquired":0}'
    write_stage qualification blocked 1 "not_in_profile" '[]' '{"candidates_judged":0,"qualified":0}'
    write_stage scoring blocked 1 "not_in_profile" '[]' '{"comments_scored":0,"strong_intent":0,"weak_intent":0,"peer":0,"irrelevant":0,"spam":0}'
    echo "WFR_RUN_ID=$WFR_RUN_ID"; echo "WFR_HASH=$WFR_HASH"; echo "WFR_RUN_DIR=$WFR_RUN_DIR"; echo "WFR_ART_DIR=$WFR_ART_DIR";;
  enter)
    out="$(led next-attempt)"
    att="$(printf '%s' "$out" | "$WFR_JQ" -r '.attempt_id // "a1"' 2>/dev/null || echo a1)"
    skip="$(printf '%s' "$out" | "$WFR_JQ" -r '(.skip_words // []) | join("|")' 2>/dev/null || true)"
    echo "WFR_ATTEMPT=$att"; echo "WFR_SKIP_WORDS=$skip";;
  stage) write_stage "$@";;
  finalize)
    write_stage cleanup completed 1 "finalize by harvest-cron trap" '[{"type":"log","ref":"harvest-cron.log"}]' '{"close_app_attempts":0,"lock_released":1,"safe_desktop_visible":0}'
    n_files=$(ls "$WFR_ART_DIR"/"${WFR_RUN_ID}"__*.worker-result.json 2>/dev/null | wc -l | tr -d ' ' || true)
    n_stages=$(led show | "$WFR_JQ" '[.stages[] | select(.status!="pending")] | length' 2>/dev/null || echo 0)
    n_items=$(led show | "$WFR_JQ" '[.stages[].items[]?] | length' 2>/dev/null || echo 0)
    expected=$(( n_stages + n_items ))
    if [[ -n "$WFR_SCP_TARGET" ]]; then
      scp -q -o ConnectTimeout=20 "$WFR_ART_DIR"/"${WFR_RUN_ID}"__*.worker-result.json "$WFR_SCP_TARGET" 2>/dev/null || warn "scp to MMV failed; artifacts kept locally"
    fi
    if (( n_files >= n_stages )); then echo "WFR_FINALIZE_OK=1"; echo "WFR_FINALIZE_MSG=artifacts=$n_files stages=$n_stages items=$n_items"
    else echo "WFR_FINALIZE_OK=0"; echo "WFR_FINALIZE_MSG=artifact_count_mismatch files=$n_files stages=$n_stages expected>=$expected"; fi;;
  *) warn "unknown subcommand: $cmd";;
esac
exit 0
