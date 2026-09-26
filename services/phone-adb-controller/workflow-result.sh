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
# 棒1 回执线(决策 702949b6/280bd091): Brain 凭据照 wall-lib.sh wall_load_env 写法——文件可读才 source,缺了不报错;
# 环境里已有的 BRAIN_URL/BRAIN_INTERNAL_TOKEN 优先(测试注入/临时覆盖),文件只补空位
WFR_BRAIN_ENV="${WFR_BRAIN_ENV:-$HOME/.credentials/brain.env}"
if [[ ( -z "${BRAIN_URL:-}" || -z "${BRAIN_INTERNAL_TOKEN:-}" ) && -r "$WFR_BRAIN_ENV" ]]; then
  _wfr_u="${BRAIN_URL:-}"; _wfr_t="${BRAIN_INTERNAL_TOKEN:-}"
  # shellcheck disable=SC1090
  . "$WFR_BRAIN_ENV"
  [[ -n "$_wfr_u" ]] && BRAIN_URL="$_wfr_u"; [[ -n "$_wfr_t" ]] && BRAIN_INTERNAL_TOKEN="$_wfr_t"
fi
# 棒3b 探针读回(决策 95e29afd): stage 回执前把探针 observed 读回, Brain 只判定。
# 棒3b-2(决策 8f38f5fd): 读回改经 ssh 在 MMV 跑——leadgen PG(zenithjoy 库)只在 MMV 127.0.0.1:5432 监听、飞书凭据
# ~/.openclaw/clawdbot.json 也只在 MMV,执行机(xian-m4/M1)本地跑 verify-step 三条必 error(09-26 实证)。远端命令形状完全照
# batch2.sh:55 推 push-videos.js 的同一条 ssh(别名 mmv 走 tailscale 内网+密钥认证,安全说明见该处)。
# 只对有探针的 stage 起 ssh(discovery/collection 每词一次,不值得);本机有 YAML 按 YAML 判,没有(执行机不再放探针文件)按
# WFR_PROBE_STAGES 兜底闸(与 YAML 的 stage 集合由 checks 单测钉死)。读回失败一律 [] + WFR_WARN,永不阻塞。
WFR_PROBE_HOST="${WFR_PROBE_HOST:-mmv}"
WFR_PROBE_DIR="${WFR_PROBE_DIR:-~/.openclaw/leadgen-scripts}"
WFR_PROBE_STAGES="${WFR_PROBE_STAGES:-delivery scoring}"
WFR_CHECKS_YAML="${WFR_CHECKS_YAML:-$HOME/bin-harvest/checks/social-keyword-leadgen.yaml}"
stage_has_probes(){
  if [[ -r "$WFR_CHECKS_YAML" ]]; then grep -qE "^[[:space:]]+stage:[[:space:]]*$1[[:space:]]*$" "$WFR_CHECKS_YAML" 2>/dev/null; return; fi
  [[ " $WFR_PROBE_STAGES " == *" $1 "* ]]
}
# sq: 远端 shell 单引号包裹(内部单引号→'\'')。bash 3.2 的 printf %q 会把中文拆成八进制转义,不用它
sq(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; printf "'%s'" "$s"; }
# probe_stage: stage [word] → stdout 一个 JSON 数组(读回失败一律 []),永远 return 0
probe_stage(){
  local stage="$1" word="${2:-}" out arr rc=0 remote errf
  stage_has_probes "$stage" || { echo '[]'; return 0; }
  remote="set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd $WFR_PROBE_DIR && node verify-step.mjs --stage $(sq "$stage") --run-tag $(sq "${WFR_TAG:-${WFR_RUN_ID#social-keyword-leadgen-crontab-}}") --line-key $(sq "${WFR_PROFILE:-}") --word $(sq "$word")"
  errf=$(mktemp 2>/dev/null || echo /dev/null)
  out=$(ssh -o ConnectTimeout=20 -o BatchMode=yes "$WFR_PROBE_HOST" "$remote" 2>"$errf") || rc=$?
  # 远端 stderr(verify-step: 单条 error / ssh 报错)原样透传到本机 stderr → harvest-cron.log 可查
  [[ -s "$errf" ]] && cat "$errf" >&2
  arr=$(printf '%s\n' "$out" | tail -1 | "$WFR_JQ" -c '.probes | select(type=="array")' 2>/dev/null || true)
  if (( rc != 0 )) || [[ -z "$arr" ]]; then
    warn "verify-step via ssh $WFR_PROBE_HOST failed(stage=$stage rc=$rc), probes=[]: $(tail -c 200 "$errf" 2>/dev/null | tr '\n' ' ')$(printf '%s' "$out" | tail -c 200)"
    arr='[]'
  fi
  [[ "$errf" != /dev/null ]] && rm -f "$errf"
  printf '%s\n' "$arr"
}
# brain_post: run_id status stage artifact_file extra_evidence_json [probes_json] —— best-effort POST Brain execution-callback。
# 缺 BRAIN_URL/BRAIN_INTERNAL_TOKEN/WFR_BRAIN_TASK_ID 任一 → 记 skipped 返回; curl 失败记 raw 输出; 任何情况 return 0。
# result 直接从校验通过的工件派生({stage,stage_status,metrics,evidence,probes}),Brain 侧 task_runs.result 原样保留。
brain_post(){
  local run_id="$1" status="$2" stage="$3" f="${4:-}" extra="${5:-[]}" probes="${6:-[]}" missing="" body out code
  [[ -n "${BRAIN_URL:-}" ]] || missing="$missing BRAIN_URL"
  [[ -n "${BRAIN_INTERNAL_TOKEN:-}" ]] || missing="$missing BRAIN_INTERNAL_TOKEN"
  [[ -n "${WFR_BRAIN_TASK_ID:-}" ]] || missing="$missing WFR_BRAIN_TASK_ID"
  if [[ -n "$missing" ]]; then warn "brain callback skipped: missing$missing (run_id=$run_id)"; return 0; fi
  if [[ -n "$f" && -s "$f" ]]; then
    body=$("$WFR_JQ" -c --arg t "$WFR_BRAIN_TASK_ID" --arg r "$run_id" --arg s "$status" --argjson extra "$extra" --argjson probes "$probes" \
      '{task_id:$t,run_id:$r,status:$s,result:{stage:.stage_id,stage_status:.status,metrics:.metrics,evidence:(.evidence+$extra),probes:$probes}}' "$f" 2>&1) \
      || { warn "brain callback body build failed (run_id=$run_id): $body"; return 0; }
  else
    # 工件没写成(finalize 的 cleanup 写失败): stage/metrics 取默认, evidence 只剩 extra——终态仍要发,否则 Brain 永远挂 in_progress
    body=$("$WFR_JQ" -cn --arg t "$WFR_BRAIN_TASK_ID" --arg r "$run_id" --arg s "$status" --arg st "$stage" --argjson extra "$extra" --argjson probes "$probes" \
      '{task_id:$t,run_id:$r,status:$s,result:{stage:$st,stage_status:"failed",metrics:{},evidence:$extra,probes:$probes}}' 2>&1) \
      || { warn "brain callback body build failed (run_id=$run_id): $body"; return 0; }
  fi
  out=$(curl -s --connect-timeout 3 -m 8 -w '\n%{http_code}' -X POST "${BRAIN_URL%/}/api/brain/execution-callback" \
        -H "Authorization: Bearer $BRAIN_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d "$body" 2>&1) \
    || { warn "brain callback curl failed (run_id=$run_id): $out"; return 0; }
  code=${out##*$'\n'}
  case "$code" in 2*) ;; *) warn "brain callback HTTP $code (run_id=$run_id): ${out%$'\n'*}";; esac
  return 0
}
# led: 原样透传 stdout，不 tail——供 show（多行美化 JSON，tail -1 会把 JSON 砍成只剩 "}"）
led(){ "$WFR_NODE" "$WFR_LEDGER_MJS" "$@" --run-dir "${WFR_RUN_DIR:-}"; }
# led1: 2>&1 | tail -1——供 init/set/next-attempt（单行 JSON，且吞掉夹杂的 stderr 行）
led1(){ "$WFR_NODE" "$WFR_LEDGER_MJS" "$@" --run-dir "${WFR_RUN_DIR:-}" 2>&1 | tail -1; }
# not_initialized: stage/enter/finalize 在未 eval init 的 shell 里裸调时，set -u 下这几个变量都未定义
not_initialized(){ [[ -z "${WFR_RUN_DIR:-}" || -z "${WFR_ART_DIR:-}" || -z "${WFR_RUN_ID:-}" ]]; }

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
  WFR_LAST_ARTIFACT=""   # 本次写成的工件路径(空=没写成); finalize 据此定终态
  if not_initialized; then warn "called before init"; return 0; fi
  local stage="$1" status="$2" n="$3" summary="$4" evidence="$5" metrics="$6" word="${7:-}"
  local attempt="${WFR_ATTEMPT:-a0}"
  local f="${WFR_ART_DIR:-}/${WFR_RUN_ID:-}__${attempt}.${stage}.${n}.worker-result.json"
  local keys; keys="$COMMON $(req_keys "$stage")"
  # 通用键缺省补 0，阶段键必须由调用方给（缺了校验会拒）
  local body
  body=$("$WFR_JQ" -n --arg run "${WFR_RUN_ID:-}" --arg att "$attempt" --arg st "$stage" --argjson n "$n" \
      --arg hash "${WFR_HASH:-}" --arg status "$status" --arg na "$(next_action "$status")" --arg sum "$summary" \
      --argjson ev "$evidence" --argjson m "$metrics" \
      '{schema_version:2,run_id:$run,attempt_id:$att,stage_id:$st,stage_attempt:$n,task_request_hash:$hash,
        status:$status,recommended_next_action:$na,summary:$sum,evidence:$ev,artifacts:[],
        metrics:({external_interactions:0,business_reads:0,business_writes:0,artifact_writes:0}+$m),
        observed_at:(now|todate)}' 2>&1) || { warn "stage=$stage jq build failed: $body"; return 0; }
  local err
  if ! err=$(printf '%s\n' "$body" > "$f" 2>&1); then warn "stage=$stage write failed errno: $err"; return 0; fi
  [[ -s "$f" ]] || { warn "stage=$stage write produced empty file (errno: $(ls -ld "${WFR_ART_DIR:-}" 2>&1))"; return 0; }
  # 校验：判据用产物（判定点 544cd6a3）；allowed = 通用4键+该阶段闭集键，metrics 多出的自造键一律拒
  local allowed_json; allowed_json=$("$WFR_JQ" -n --arg keys "$keys" '$keys | split(" ")')
  local jqf='.schema_version==2 and (.status|IN("completed","blocked","failed")) and (.recommended_next_action|IN("accept","steer","retry","block","stop")) and (.evidence|type=="array") and ((.status!="completed") or (.evidence|length>=1)) and (((.metrics|keys) - $allowed | length) == 0)'
  for k in $keys; do jqf="$jqf and (.metrics.\"$k\"|type==\"number\")"; done
  if ! "$WFR_JQ" -e --argjson allowed "$allowed_json" "$jqf" "$f" >/dev/null 2>&1; then warn "stage=$stage artifact invalid, removed: $f"; rm -f "$f"; return 0; fi
  if [[ -n "$word" ]]; then led1 set --stage "$stage" --status "$status" --n "$n" --word "$word" --note "$summary" >/dev/null
  else led1 set --stage "$stage" --status "$status" --n "$n" --note "$summary" >/dev/null; fi
  WFR_LAST_ARTIFACT="$f"
  # 回执 Brain(校验通过+记账之后): run_id=RUN__ATTEMPT.stage, 状态 in_progress; cleanup 段由 finalize 发终态,这里不发
  # 探针读回(棒3b)排在校验之后、POST 之前: 工件都没写成的 stage 不值得读回
  if [[ "$stage" != cleanup ]]; then
    local probes; probes=$(probe_stage "$stage" "$word")
    brain_post "${WFR_RUN_ID:-}__${attempt}.${stage}" in_progress "$stage" "$f" '[]' "$probes"
  fi
}

cmd="${1:-}"; shift || true
case "$cmd" in
  hash) echo "WFR_HASH=$(calc_hash "$1" "$2" "$3")";;
  init)
    TAG="$1"; P="$2"; WF="$3"; PUSH="$4"; SERIAL="${5:-}"; HOSTKEY="${6:-}"
    WFR_RUN_ID="social-keyword-leadgen-crontab-$TAG"
    WFR_HASH="$(calc_hash "$P" "$WF" "$PUSH")"
    WFR_RUN_DIR="$WFR_HOME/ledger/$WFR_RUN_ID"; WFR_ART_DIR="$WFR_HOME/workflow-runs"
    WFR_TAG="$TAG"; WFR_PROFILE="$P"   # 棒3b: 探针占位符 $RUN_TAG / $LINE_KEY(经 line-routes routeOf 由 profile 解析)
    mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>/dev/null || warn "mkdir failed errno: $(mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>&1)"
    led1 init --run-id "$WFR_RUN_ID" --hash "$WFR_HASH" --profile "$P" --serial "$SERIAL" --hostkey "$HOSTKEY" >/dev/null
    export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_TAG WFR_PROFILE
    write_stage preflight completed 1 "device+account preflight by harvest-cron" \
      "[{\"type\":\"preflight\",\"serial\":\"$SERIAL\",\"hostkey\":\"$HOSTKEY\"}]" \
      '{"device_verified":1,"account_verified":0,"call_state_idle":1,"lock_acquired":0}'
    write_stage qualification blocked 1 "not_in_profile" '[]' '{"candidates_judged":0,"qualified":0}'
    write_stage scoring blocked 1 "not_in_profile" '[]' '{"comments_scored":0,"strong_intent":0,"weak_intent":0,"peer":0,"irrelevant":0,"spam":0}'
    echo "WFR_RUN_ID=$WFR_RUN_ID"; echo "WFR_HASH=$WFR_HASH"; echo "WFR_RUN_DIR=$WFR_RUN_DIR"; echo "WFR_ART_DIR=$WFR_ART_DIR"
    echo "WFR_TAG=$WFR_TAG"; echo "WFR_PROFILE=$WFR_PROFILE";;
  enter)
    if not_initialized; then
      warn "called before init"
      echo "WFR_ATTEMPT=a1"; echo "WFR_SKIP_WORDS="
    else
      out="$(led1 next-attempt)"
      att="$(printf '%s' "$out" | "$WFR_JQ" -r '.attempt_id // "a1"' 2>/dev/null || echo a1)"
      skip="$(printf '%s' "$out" | "$WFR_JQ" -r '(.skip_words // []) | join("|")' 2>/dev/null || true)"
      echo "WFR_ATTEMPT=$att"; echo "WFR_SKIP_WORDS=$skip"
    fi;;
  stage) write_stage "$@";;
  finalize)
    if not_initialized; then
      warn "called before init"
      echo "WFR_FINALIZE_OK=0"; echo "WFR_FINALIZE_MSG=not_initialized"
    else
      write_stage cleanup completed 1 "finalize by harvest-cron trap" '[{"type":"log","ref":"harvest-cron.log"}]' '{"close_app_attempts":0,"lock_released":1,"safe_desktop_visible":0}'
      n_files=$(ls "${WFR_ART_DIR:-}"/"${WFR_RUN_ID:-}"__*.worker-result.json 2>/dev/null | wc -l | tr -d ' ' || true)
      book="$(led show)"
      n_stages=$(printf '%s' "$book" | "$WFR_JQ" '[.stages[] | select(.status!="pending")] | length' 2>/dev/null || echo 0)
      n_items=$(printf '%s' "$book" | "$WFR_JQ" '[.stages[].items[]?] | length' 2>/dev/null || echo 0)
      if [[ -n "${WFR_SCP_TARGET:-}" ]]; then
        scp -q -o ConnectTimeout=20 "${WFR_ART_DIR:-}"/"${WFR_RUN_ID:-}"__*.worker-result.json "$WFR_SCP_TARGET" 2>/dev/null || warn "scp to MMV failed; artifacts kept locally"
      fi
      # 判据用产物(判定点 544cd6a3): 每条成功 write_stage 同时产 1 文件 + 1 账本 items 条目，
      # 故正常应有 n_files >= n_items。终审 C2 实证: 工件目录若从起跑前就不可写，write_stage
      # 全程写不进文件、也就全程没调 led1 set，n_files 与 n_stages 会一起停在 0，旧判据
      # n_files>=n_stages 在 0>=0 时假绿 OK=1；改用 n_items(而非 n_stages) 且要求其 >0 堵死这条假绿。
      if (( n_items > 0 && n_files >= n_items )); then ok=1; msg="artifacts=$n_files stages=$n_stages items=$n_items"
      else ok=0; msg="artifact_count_mismatch files=$n_files items=$n_items stages=$n_stages"; fi
      echo "WFR_FINALIZE_OK=$ok"; echo "WFR_FINALIZE_MSG=$msg"
      # 终态回执: cleanup 工件写成且自检过 → completed, 否则 failed; run_id 用 cleanup 段规则; evidence 追加自检结果
      if [[ -n "${WFR_LAST_ARTIFACT:-}" && "$ok" == 1 ]]; then final=completed; else final=failed; fi
      extra=$("$WFR_JQ" -cn --argjson ok "$ok" --arg msg "$msg" '[{type:"finalize",ok:$ok,msg:$msg}]')
      brain_post "${WFR_RUN_ID:-}__${WFR_ATTEMPT:-a0}.cleanup" "$final" cleanup "${WFR_LAST_ARTIFACT:-}" "$extra"
    fi;;
  *) warn "unknown subcommand: $cmd";;
esac
exit 0
