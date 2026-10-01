#!/usr/bin/env bash
# workflow-result.sh — crontab 获客流水线的 WORKER_RESULT 工件写手（基座 1/7）。
# 永远 exit 0，绝不阻塞主流程（照 wall-report.sh 范式）。子命令把导出变量打印到 stdout，调用方 eval。
# 用法:
#   eval "$(workflow-result.sh init <TAG> <profile> <wordfile> <push> <serial> <hostkey>)"
#   eval "$(workflow-result.sh enter)"
#   workflow-result.sh stage <stage> <completed|blocked|failed> <n> <summary> <evidence_json> <metrics_json> [<word>]
#   eval "$(workflow-result.sh finalize)"
#   eval "$(workflow-result.sh gate)"          # 6b133a81: 读本 run 的拦截状态(STOP/新告警),告警只报一次
#   eval "$(workflow-result.sh outreach-run <TAG> <profile> <serial> <hostkey> <summary> <metrics_json>)"  # 触达 tick 进账本
#   workflow-result.sh hash <profile> <wordfile> <push>
# 契约: protocol.md WORKER_RESULT（schema_version=2 / evidence 非空 / metrics 闭集）；判定点 544cd6a3 判据用产物。
set -u
WFR_HOME="${WFR_HOME:-$HOME/.config/zenithjoy}"
WFR_NODE="${WFR_NODE:-/opt/homebrew/bin/node}"
WFR_PRODUCER_FILE="${BASH_SOURCE[0]}"
# 从 bash 正在执行的 inode 复制描述符，禁止部署换路径后误认成新脚本。
WFR_PRODUCER_FD=""
if { exec 9<&255; } 2>/dev/null; then WFR_PRODUCER_FD=/dev/fd/9; fi
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
WFR_PROBE_STAGES="${WFR_PROBE_STAGES-preflight discovery qualification collection scoring delivery outreach cleanup}"
WFR_CHECKS_YAML="${WFR_CHECKS_YAML:-$HOME/bin-harvest/checks/social-keyword-leadgen.yaml}"
# 步骤 DoD 统一裁判(任务 9032cdad,决策 2a60378a):每写出一个活动工件就判 at==该活动 的步骤,结果写进工件 step_dod
# 与 $WFR_RUN_DIR/step-dod.jsonl;sql/http 类随探针 ssh 在 mmv 判(verify-step --steps),其余在本机 step-judge.mjs 判。
# 清单 step-dod.json 由契约生成(scripts/product-map/gen-step-dod.mjs),deploy.sh 下发;缺裁判/清单 → 跳过(不影响采收)。
WFR_STEP_JUDGE="${WFR_STEP_JUDGE:-$HOME/bin-harvest/step-judge.mjs}"
WFR_STEP_SPEC="${WFR_STEP_SPEC:-$HOME/bin-harvest/step-dod.json}"
WFR_EVIDENCE_ROOT="${WFR_EVIDENCE_ROOT:-/Volumes/EvidenceRAM/openclaw-phone/evidence}"
stage_has_probes(){
  if [[ -r "$WFR_CHECKS_YAML" ]]; then grep -qE "^[[:space:]]+stage:[[:space:]]*$1[[:space:]]*$" "$WFR_CHECKS_YAML" 2>/dev/null; return; fi
  [[ " $WFR_PROBE_STAGES " == *" $1 "* ]]
}
# sq: 远端 shell 单引号包裹(内部单引号→'\'')。bash 3.2 的 printf %q 会把中文拆成八进制转义,不用它
sq(){ local q=\' s="$1"; s="${s//$q/$q\\$q$q}"; printf "'%s'" "$s"; }
# probe_stage: stage [word] [metrics_json] → stdout 一行 JSON {probes:[...], gate:{...}|null}(读回失败 probes=[] gate=null),永远 return 0
# 本 stage 不在读回范围 → {"probes":[],"gate":{"verdict":"none",...}}(不拦);读回失败 gate=null → 调用方按 unknown 处理(工件 failed、不停跑)
GATE_NONE='{"verdict":"none","action":"continue","failed":[],"unknown":[],"alert":false}'
probe_stage(){
  local stage="$1" word="${2:-}" metrics="${3:-}" out arr gate rc=0 remote errf
  stage_has_probes "$stage" || { echo "{\"probes\":[],\"gate\":$GATE_NONE,\"steps\":[]}"; return 0; }
  remote="set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; cd $WFR_PROBE_DIR && node verify-step.mjs --stage $(sq "$stage") --run-tag $(sq "${WFR_TAG:-${WFR_RUN_ID#social-keyword-leadgen-crontab-}}") --line-key $(sq "${WFR_PROFILE:-}") --word $(sq "$word")"
  [[ -n "$metrics" ]] && remote="$remote --metrics $(sq "$metrics")"
  remote="$remote --steps"
  errf=$(mktemp 2>/dev/null || echo /dev/null)
  out=$(ssh -o ConnectTimeout=20 -o BatchMode=yes "$WFR_PROBE_HOST" "$remote" 2>"$errf") || rc=$?
  # 远端 stderr(verify-step: 单条 error / ssh 报错)原样透传到本机 stderr → harvest-cron.log 可查
  [[ -s "$errf" ]] && cat "$errf" >&2
  arr=$(printf '%s\n' "$out" | tail -1 | "$WFR_JQ" -c '.probes | select(type=="array")' 2>/dev/null || true)
  local steps
  steps=$(printf '%s\n' "$out" | tail -1 | "$WFR_JQ" -c '.steps | select(type=="array")' 2>/dev/null || true)
  gate=$(printf '%s\n' "$out" | tail -1 | "$WFR_JQ" -c '.gate | select(type=="object")' 2>/dev/null || true)
  if (( rc != 0 )) || [[ -z "$arr" ]]; then
    warn "verify-step via ssh $WFR_PROBE_HOST failed(stage=$stage rc=$rc), probes=[]: $(tail -c 200 "$errf" 2>/dev/null | tr '\n' ' ')$(printf '%s' "$out" | tail -c 200)"
    arr='[]'; gate=''
  fi
  [[ "$errf" != /dev/null ]] && rm -f "$errf"
  printf '{"probes":%s,"gate":%s,"steps":%s}\n' "$arr" "${gate:-null}" "${steps:-[]}"
}
# apply_gate: stage n word artifact gate_json —— 6b133a81 运行时拦截(决策 3240824c⑦ 后置条件默认拦截)。
#   pass → 放行(delivery 额外把 readback_verified 记 1);none → 不动;
#   fail/unknown(gate=null 即读不回) → 工件改 failed(stop_run→stop / 其余→retry)、summary 追加失败探针、账本记 failed;
#   每次不过追加一行 $WFR_RUN_DIR/gate.log;on_fail=stop_run → 写 $WFR_RUN_DIR/STOP(batch2/harvest-cron 据此停后续活动)。
apply_gate(){
  local stage="$1" n="$2" word="$3" f="$4" gate="${5:-null}" hard="${6:-}" verdict action note tmp rec
  [[ "$gate" == null || -z "$gate" ]] && gate='{"verdict":"unknown","action":"fail_stage","failed":[],"unknown":["probe_unreadable"],"alert":false}'
  verdict=$(printf '%s' "$gate" | "$WFR_JQ" -r '.verdict // "unknown"' 2>/dev/null)
  # 9032cdad: hard 步骤 DoD 不过 → 本活动至少判 fail_stage(checkpoint 只记录,不进这里)
  if [[ -n "$hard" && ( "$verdict" == pass || "$verdict" == none ) ]]; then
    gate=$(printf '%s' "$gate" | "$WFR_JQ" -c '.verdict = "fail" | .action = "fail_stage"' 2>/dev/null); verdict=fail
  fi
  tmp="$f.gate.tmp"
  case "$verdict" in
    none) return 0;;
    pass)
      if [[ "$stage" == delivery ]]; then
        "$WFR_JQ" '.metrics.readback_verified = 1' "$f" > "$tmp" 2>/dev/null && mv -f "$tmp" "$f"
      fi
      return 0;;
  esac
  action=$(printf '%s' "$gate" | "$WFR_JQ" -r '.action // "fail_stage"' 2>/dev/null)
  note=$(printf '%s' "$gate" | "$WFR_JQ" -r '"postcondition_failed: " + ((.failed // []) + ((.unknown // []) | map(if . == "probe_unreadable" then . else "unreadable:" + . end)) | join(",")) + " (" + (.action // "fail_stage") + ")"' 2>/dev/null)
  [[ "$verdict" == unknown && "$note" != *probe_unreadable* ]] && note="$note probe_unreadable"
  [[ -n "$hard" ]] && note="$note step_dod_hard_failed: $hard"
  "$WFR_JQ" --arg note "$note" --arg na "$([[ "$action" == stop_run ]] && echo stop || echo retry)" \
    '.status = "failed" | .recommended_next_action = $na | .summary = (.summary + " | " + $note)' "$f" > "$tmp" 2>/dev/null && mv -f "$tmp" "$f"
  if [[ -n "$word" ]]; then led1 set --stage "$stage" --status failed --n "$n" --word "$word" --note "$note" >/dev/null
  else led1 set --stage "$stage" --status failed --n "$n" --note "$note" >/dev/null; fi
  rec=$("$WFR_JQ" -cn --arg st "$stage" --argjson n "$n" --arg w "$word" --argjson g "$gate" '{stage:$st,n:$n,word:$w} + $g' 2>/dev/null)
  [[ -n "$rec" ]] && printf '%s\n' "$rec" >> "${WFR_RUN_DIR:-/nonexistent}/gate.log"
  [[ "$action" == stop_run && -n "$rec" ]] && printf '%s\n' "$rec" > "${WFR_RUN_DIR:-/nonexistent}/STOP"
  warn "stage=$stage n=$n $note"
  return 0
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
      '{task_id:$t,run_id:$r,status:$s,result:{stage:.stage_id,stage_status:.status,metrics:.metrics,evidence:(.evidence+$extra),probes:$probes,source_sha:(.source_sha // null),source_provenance:(.source_provenance // {status:"unknown",reason:"artifact_source_unavailable"})}}' "$f" 2>&1) \
      || { warn "brain callback body build failed (run_id=$run_id): $body"; return 0; }
  else
    # 工件没写成(finalize 的 cleanup 写失败): stage/metrics 取默认, evidence 只剩 extra——终态仍要发,否则 Brain 永远挂 in_progress
    body=$("$WFR_JQ" -cn --arg t "$WFR_BRAIN_TASK_ID" --arg r "$run_id" --arg s "$status" --arg st "$stage" --argjson extra "$extra" --argjson probes "$probes" \
      '{task_id:$t,run_id:$r,status:$s,result:{stage:$st,stage_status:"failed",metrics:{},evidence:$extra,probes:$probes,source_sha:null,source_provenance:{status:"unknown",reason:"artifact_unavailable"}}}' 2>&1) \
      || { warn "brain callback body build failed (run_id=$run_id): $body"; return 0; }
  fi
  out=$(curl -s --connect-timeout 3 -m 8 -w '\n%{http_code}' -X POST "${BRAIN_URL%/}/api/brain/execution-callback" \
        -H "Authorization: Bearer $BRAIN_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d "$body" 2>&1) \
    || { warn "brain callback curl failed (run_id=$run_id): $out"; return 0; }
  code=${out##*$'\n'}
  case "$code" in 2*) ;; *) warn "brain callback HTTP $code (run_id=$run_id): ${out%$'\n'*}";; esac
  return 0
}
# ── span 上报（价值流建模④b，决策 3e867cad）：每个 Backbone Activity 的工件写成后向 Brain 报一条运行记录 ──
# cmd09300230 批 134/134 走兜底重搜跑了 6 小时而结果探针全绿——过程指标（时长/重试/兜底）没人记，这里补。
# 契约 POST /api/brain/spans（数组批量，Bearer 内部 token）；幂等键 (run_id, activity_id, started_at)，所以 started_at
# 取 mark-start 写下的标记（同 stage/n 重发不变），没标记才退回工件 observed_at。上报失败只 warn，绝不影响主流程。
WFR_SPAN_JOURNEY_ID="${WFR_SPAN_JOURNEY_ID:-afa6abca-53c0-4815-8594-b7fb81ca547f}"
span_marker(){ printf '%s' "${WFR_RUN_DIR:-/nonexistent}/span-start.${WFR_ATTEMPT:-a0}.$1.$2"; }
span_mark_start(){ local m; m=$(span_marker "$1" "$2"); [[ -s "$m" ]] || date -u +%Y-%m-%dT%H:%M:%SZ > "$m" 2>/dev/null || warn "span mark-start write failed ($1/$2)"; }
# 活动表一次 GET 缓存进 run 目录；解析 activity_key → "id workflow_id"，取不到留空（evidence 里仍带 activity_key）
span_activity(){
  local cache="${WFR_RUN_DIR:-/nonexistent}/activities.json" out
  if [[ ! -s "$cache" ]]; then
    out=$(curl -s --connect-timeout 3 -m 6 "${BRAIN_URL%/}/api/brain/journey_steps?journey_id=${WFR_SPAN_JOURNEY_ID}&limit=200" 2>/dev/null) || out=""
    printf '%s' "$out" | "$WFR_JQ" -c 'if type=="array" then . else [] end' > "$cache" 2>/dev/null || printf '[]' > "$cache"
  fi
  "$WFR_JQ" -r --arg k "$1" '[.[] | select(.activity_key==$k)] | sort_by(.backbone_version) | last // empty | "\(.id) \(.workflow_id // "")"' "$cache" 2>/dev/null
}
span_post(){ # stage status n artifact_file [word]
  local stage="$1" status="$2" n="$3" f="$4" word="${5:-}"
  if [[ -z "${BRAIN_URL:-}" || -z "${BRAIN_INTERNAL_TOKEN:-}" ]]; then warn "span skipped: missing BRAIN_URL/BRAIN_INTERNAL_TOKEN (stage=$stage)"; return 0; fi
  local started ended ex_kind outcome fallback=false attempts=1 rescan rate act aid wid body out code m
  ended=$("$WFR_JQ" -r '.observed_at // empty' "$f" 2>/dev/null); [[ -n "$ended" ]] || ended=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  m=$(span_marker "$stage" "$n"); if [[ -s "$m" ]]; then started=$(<"$m"); else started="$ended"; fi
  case "$stage" in qualification|scoring) ex_kind=agent;; *) ex_kind=code;; esac
  case "$status" in completed) outcome=pass;; failed) outcome=fail;; blocked) outcome=skipped;; *) outcome=unknown;; esac
  rescan=$("$WFR_JQ" -r '.metrics.rescan_count // 0' "$f" 2>/dev/null); rescan=${rescan%.*}; [[ "$rescan" =~ ^[0-9]+$ ]] || rescan=0
  rate=$("$WFR_JQ" -r '.metrics.rescan_rate // 0' "$f" 2>/dev/null); [[ "$rate" =~ ^[0-9.]+$ ]] || rate=0
  if [[ "$stage" == collection ]] && (( rescan > 0 )); then fallback=true; attempts=$(( rescan + 1 )); fi
  act=$(span_activity "$stage" || true); aid="${act%% *}"; wid="${act#* }"; [[ "$wid" == "$act" ]] && wid=""
  body=$("$WFR_JQ" -cn --arg run "${WFR_RUN_ID:-}__${WFR_ATTEMPT:-a0}" --arg aid "$aid" --arg wid "$wid" --arg st "$started" --arg en "$ended" \
      --argjson source "$("$WFR_JQ" -c '{source_sha:(.source_sha // null),source_provenance:(.source_provenance // {status:"unknown",reason:"artifact_source_unavailable"})}' "$f")" \
      --arg ek "$ex_kind" --arg eid "${WFR_HOSTKEY:-$(hostname -s 2>/dev/null || echo unknown)}" --argjson att "$attempts" --argjson fb "$fallback" \
      --arg oc "$outcome" --arg stage "$stage" --argjson n "$n" --arg w "$word" --arg art "$(basename "$f")" --argjson rc "$rescan" --argjson rr "$rate" \
      '[{run_id:$run, workflow_id:(if $wid=="" then null else $wid end), activity_id:(if $aid=="" then null else $aid end),
         step_id:null, enabler_id:null, started_at:$st, ended_at:$en, executor_kind:$ek, executor_id:$eid,
         attempts:$att, fallback:$fb, outcome:$oc,
         evidence:({activity_key:$stage, stage_attempt:$n, word:$w, artifact:$art, rescan_count:$rc, rescan_rate:$rr} + $source)}]' 2>&1) \
    || { warn "span body build failed (stage=$stage): $body"; return 0; }
  out=$(curl -s --connect-timeout 3 -m 8 -w '\n%{http_code}' -X POST "${BRAIN_URL%/}/api/brain/spans" \
        -H "Authorization: Bearer $BRAIN_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d "$body" 2>&1) \
    || { warn "span curl failed (stage=$stage): $out"; return 0; }
  code=${out##*$'\n'}
  case "$code" in 2*) ;; *) warn "span HTTP $code (stage=$stage): ${out%$'\n'*}";; esac
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
  collection) echo "comments_collected videos_processed cursor_updates rescan_count rescan_rate";;
  scoring) echo "comments_scored strong_intent weak_intent peer irrelevant spam";;
  delivery) echo "leads_written videos_pushed duplicates_skipped readback_verified cursor_updates";;
  outreach) echo "orders_picked messages_sent requeued blocked_orders";;
  cleanup) echo "close_app_attempts lock_released safe_desktop_visible";;
  *) echo "";; esac; }
# zero_metrics stage → 该 stage 闭集键全 0 的 metrics JSON(补 not_run 工件用)
zero_metrics(){ local k out=""; for k in $(req_keys "$1"); do out="$out${out:+,}\"$k\":0"; done; printf '{%s}' "$out"; }
# judge_steps stage n word artifact remote_steps_json → 调 step-judge.mjs,把 step_dod 写进工件、追加 step-dod.jsonl;
#   stdout 输出 hard 不过的步骤 key(逗号分隔,空=无)。任何失败都只 warn,永不阻塞
judge_steps(){
  local stage="$1" n="$2" word="$3" f="$4" remote="${5:-[]}" out tmp
  [[ -r "$WFR_STEP_JUDGE" && -r "$WFR_STEP_SPEC" ]] || return 0
  out=$("$WFR_NODE" "$WFR_STEP_JUDGE" --spec "$WFR_STEP_SPEC" --stage "$stage" --n "$n" --word "$word" --tag "${WFR_TAG:-}" \
        --metrics-file "$f" --remote "$remote" --evidence-dir "$WFR_EVIDENCE_ROOT/${WFR_PROFILE:-}" \
        --log "${WFR_LOG_FILE:-}" --log-from "${WFR_LOG_FROM:-0}" --tsv "${WFR_TSV:-}" --run-dir "${WFR_RUN_DIR:-}" 2>/dev/null | tail -1)
  printf '%s' "$out" | "$WFR_JQ" -e '.steps | type=="array"' >/dev/null 2>&1 || { warn "step-judge failed(stage=$stage): ${out:0:200}"; return 0; }
  tmp="$f.steps.tmp"
  "$WFR_JQ" --argjson sd "$(printf '%s' "$out" | "$WFR_JQ" -c '.steps')" '.step_dod = $sd' "$f" > "$tmp" 2>/dev/null && mv -f "$tmp" "$f"
  printf '%s' "$out" | "$WFR_JQ" -c --arg run "${WFR_RUN_ID:-}" --arg st "$stage" --argjson n "$n" --arg w "$word" --arg at "$("$WFR_JQ" -r '.observed_at' "$f" 2>/dev/null)" \
    '.steps[] | {run_id:$run, stage:$st, n:$n, word:$w, observed_at:$at} + .' >> "${WFR_RUN_DIR:-/nonexistent}/step-dod.jsonl" 2>/dev/null
  printf '%s' "$out" | "$WFR_JQ" -r '.hard_failed // [] | join(",")' 2>/dev/null
}
# gate_report: 读 $WFR_RUN_DIR 的 STOP 与 gate.log,输出可 eval 的 WFR_GATE_*;告警行按 gate.acked 行号只报一次
gate_report(){
  local dir="${WFR_RUN_DIR:-/nonexistent}" stop=0 stage="" keys="" acked total alert=0 msg=""
  if [[ -s "$dir/STOP" ]]; then
    stop=1
    stage=$("$WFR_JQ" -r '.stage' "$dir/STOP" 2>/dev/null)
    keys=$("$WFR_JQ" -r '(.failed // []) + (.unknown // []) | join(",")' "$dir/STOP" 2>/dev/null)
  fi
  total=0; [[ -f "$dir/gate.log" ]] && total=$(wc -l < "$dir/gate.log" | tr -d ' ')
  acked=$(cat "$dir/gate.acked" 2>/dev/null); [[ "$acked" =~ ^[0-9]+$ ]] || acked=0
  if (( total > acked )); then
    msg=$(tail -n +$((acked + 1)) "$dir/gate.log" | "$WFR_JQ" -r 'select(.alert == true) | .stage + ":" + ((.failed // []) | join(",")) + "(" + .action + ")"' 2>/dev/null | paste -sd' ' - | tr -d "'")
    [[ -n "$msg" ]] && alert=1
    echo "$total" > "$dir/gate.acked" 2>/dev/null
  fi
  echo "WFR_GATE_STOP=$stop"; echo "WFR_GATE_STAGE=$stage"; echo "WFR_GATE_KEYS=$keys"
  echo "WFR_GATE_ALERT=$alert"; echo "WFR_GATE_ALERT_MSG='$msg'"
}
next_action(){ case "$1" in completed) echo accept;; blocked) echo block;; failed) echo retry;; *) echo stop;; esac; }

# 每份新工件验证本 producer 与部署来源清单；回执与 spans 只传播工件固化的来源。
producer_source(){
  local out helper="$(dirname "$WFR_PRODUCER_FILE")/workflow-source.mjs"
  [[ -n "$WFR_PRODUCER_FD" ]] && out=$("$WFR_NODE" "$helper" read "$WFR_PRODUCER_FILE" /dev/stdin <&9 2>/dev/null) || out=''
  printf '%s' "$out" | "$WFR_JQ" -e 'type=="object" and has("source_sha") and (.source_provenance|type=="object")' >/dev/null 2>&1 \
    || out='{"source_sha":null,"source_provenance":{"status":"unknown","reason":"source_reader_unavailable"}}'
  printf '%s' "$out"
}

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
      --argjson ev "$evidence" --argjson m "$metrics" --argjson source "$(producer_source)" \
      '{schema_version:2,run_id:$run,attempt_id:$att,stage_id:$st,stage_attempt:$n,task_request_hash:$hash,
        status:$status,recommended_next_action:$na,summary:$sum,evidence:$ev,artifacts:[],
        metrics:({external_interactions:0,business_reads:0,business_writes:0,artifact_writes:0}+$m),
        observed_at:(now|todate)} + $source' 2>&1) || { warn "stage=$stage jq build failed: $body"; return 0; }
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
  # 探针读回(棒3b)排在校验之后、POST 之前: 工件都没写成的 stage 不值得读回。
  # 6b133a81: 每个 stage 一律读回(含 blocked——没跑到的阶段在收工时补 not_run 工件,读的是收工那刻的真实数据),
  # 读回同时按 expect 判定并拦截(apply_gate),回执 Brain 的是拦截之后的工件。cleanup 段由 finalize 发终态,这里不发。
  local pr probes gate
  pr=$(probe_stage "$stage" "$word" "$("$WFR_JQ" -c '.metrics' "$f" 2>/dev/null)")
  probes=$(printf '%s' "$pr" | "$WFR_JQ" -c '.probes // []' 2>/dev/null); [[ -n "$probes" ]] || probes='[]'
  gate=$(printf '%s' "$pr" | "$WFR_JQ" -c '.gate' 2>/dev/null); [[ -n "$gate" ]] || gate=null
  local hard=""
  [[ "$status" == blocked && "$summary" == not_run* ]] || hard=$(judge_steps "$stage" "$n" "$word" "$f" "$(printf '%s' "$pr" | "$WFR_JQ" -c '.steps // []' 2>/dev/null)")
  apply_gate "$stage" "$n" "$word" "$f" "$gate" "$hard"
  if [[ "$stage" != cleanup ]]; then
    # 每词是独立活动实例：Brain 首条终态不可覆盖，同一 stage/n 重发仍幂等。
    brain_post "${WFR_RUN_ID:-}__${attempt}.${stage}.${n}" in_progress "$stage" "$f" '[]' "$probes"
  fi
  # 拦截后的工件状态就是这条 span 的 outcome（cleanup 也报：它是骨干最后一格）
  span_post "$stage" "$("$WFR_JQ" -r '.status' "$f" 2>/dev/null || echo "$status")" "$n" "$f" "$word"
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
    WFR_HOSTKEY="$HOSTKEY"             # span executor_id：哪台执行机跑的
    mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>/dev/null || warn "mkdir failed errno: $(mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>&1)"
    led1 init --run-id "$WFR_RUN_ID" --hash "$WFR_HASH" --profile "$P" --serial "$SERIAL" --hostkey "$HOSTKEY" >/dev/null
    export WFR_RUN_ID WFR_HASH WFR_RUN_DIR WFR_ART_DIR WFR_TAG WFR_PROFILE WFR_HOSTKEY
    # 6b133a81: preflight 四项指标全部取 harvest-cron.sh 的真实预检结果(DEVICE_VERIFIED=adb get-state 通过 /
    # ACCOUNT_VERIFIED=我页抖音号在注册表 / CALL_STATE_IDLE=mCallState 空闲 / LOCK_ACQUIRED=preflight_lock_acquire 以本批 TAG
    # 拿到设备锁),没读到一律 0——不再写死 1/0。读回 pf_* 探针不过 → stop_run,批次不开采。
    # 不再写 qualification/scoring 的 not_in_profile 占位(开跑时读回是假绿):没跑到的阶段由 finalize 收工时补 not_run 工件并读回。
    write_stage preflight completed 1 "device+account preflight by harvest-cron" \
      "[{\"type\":\"preflight\",\"serial\":\"$SERIAL\",\"hostkey\":\"$HOSTKEY\"}]" \
      "{\"device_verified\":${DEVICE_VERIFIED:-0},\"account_verified\":${ACCOUNT_VERIFIED:-0},\"call_state_idle\":${CALL_STATE_IDLE:-0},\"lock_acquired\":${LOCK_ACQUIRED:-0}}"
    echo "WFR_RUN_ID=$WFR_RUN_ID"; echo "WFR_HASH=$WFR_HASH"; echo "WFR_RUN_DIR=$WFR_RUN_DIR"; echo "WFR_ART_DIR=$WFR_ART_DIR"
    echo "WFR_TAG=$WFR_TAG"; echo "WFR_PROFILE=$WFR_PROFILE"; echo "WFR_HOSTKEY=$WFR_HOSTKEY";;
  mark-start)
    # 记一个活动开始时刻（span started_at 取这里；同 stage/n 已有标记不覆盖，幂等键才稳定）。未 init 直接忽略。
    if not_initialized; then warn "mark-start called before init"; else span_mark_start "$1" "${2:-1}"; fi;;
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
  gate)
    if not_initialized; then echo "WFR_GATE_STOP=0"; echo "WFR_GATE_ALERT=0"; else gate_report; fi;;
  outreach-run)
    # 6b133a81 触达进账本: 每个 tick 一个 run(social-keyword-leadgen-outreach-<TAG>),写 outreach 工件并读回 out_no_stuck_inflight
    TAG="$1"; P="$2"; SERIAL="${3:-}"; HOSTKEY="${4:-}"; SUMMARY="${5:-outreach tick}"; METRICS="${6:-}"
    WFR_RUN_ID="social-keyword-leadgen-outreach-$TAG"; WFR_HASH=""
    WFR_RUN_DIR="$WFR_HOME/ledger/$WFR_RUN_ID"; WFR_ART_DIR="$WFR_HOME/workflow-runs"; WFR_TAG="$TAG"; WFR_PROFILE="$P"; WFR_ATTEMPT=a1
    mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>/dev/null || warn "mkdir failed errno: $(mkdir -p "$WFR_RUN_DIR" "$WFR_ART_DIR" 2>&1)"
    led1 init --run-id "$WFR_RUN_ID" --profile "$P" --serial "$SERIAL" --hostkey "$HOSTKEY" >/dev/null
    write_stage outreach completed 1 "$SUMMARY" '[{"type":"log","ref":"outreach.log"}]' "$METRICS"
    if [[ -n "${WFR_SCP_TARGET:-}" && -n "${WFR_LAST_ARTIFACT:-}" ]]; then
      scp -q -o ConnectTimeout=20 "$WFR_LAST_ARTIFACT" "$WFR_SCP_TARGET" 2>/dev/null || warn "scp to MMV failed; artifact kept locally"
    fi
    echo "WFR_RUN_ID=$WFR_RUN_ID"; gate_report;;
  finalize)
    if not_initialized; then
      warn "called before init"
      echo "WFR_FINALIZE_OK=0"; echo "WFR_FINALIZE_MSG=not_initialized"
    else
      # 6b133a81: 本 attempt 没跑到的阶段(STOP 停跑/PUSH=0/批次早退)补 blocked not_run 工件——收工这一刻读回判探针,
      # 不留"没写工件=没判定"的空洞。cleanup 三项指标全取 harvest-cron.sh run_finalize 的真实结果(close-app / 放锁后
      # lock-status 真读 / return-safe-desktop),没给一律 0。
      for st in discovery qualification collection scoring delivery; do
        [[ -n "$(ls "${WFR_ART_DIR:-}"/"${WFR_RUN_ID:-}__${WFR_ATTEMPT:-a0}.${st}".*.worker-result.json 2>/dev/null)" ]] && continue
        write_stage "$st" blocked 1 "not_run" '[]' "$(zero_metrics "$st")"
      done
      write_stage cleanup completed 1 "finalize by harvest-cron trap" '[{"type":"log","ref":"harvest-cron.log"}]' "{\"close_app_attempts\":${WFR_CLOSE_APP_ATTEMPTS:-0},\"lock_released\":${WFR_LOCK_RELEASED:-0},\"safe_desktop_visible\":${WFR_SAFE_DESKTOP_VISIBLE:-0}}"
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
      # 终态回执: cleanup 工件写成、自检过、没有 stop_run 拦截、cleanup 自身读回通过 → completed,否则 failed
      stopinfo=""
      [[ -s "${WFR_RUN_DIR:-}/STOP" ]] && stopinfo=" gate_stop=$("$WFR_JQ" -r '.stage + ":" + ((.failed // []) | join(","))' "${WFR_RUN_DIR:-}/STOP" 2>/dev/null)"
      if [[ -n "${WFR_LAST_ARTIFACT:-}" && "$ok" == 1 && -z "$stopinfo" ]] \
         && [[ "$("$WFR_JQ" -r '.status' "${WFR_LAST_ARTIFACT:-/nonexistent}" 2>/dev/null)" == completed ]]; then final=completed; else final=failed; fi
      # 7d150e33(阶段1): 整批总时限到点平滑收工(已采落池/放锁/回桌面都做了)——本可 completed 的 run 终态记 partial 并带原因;
      # 有拦截(STOP)/自检不过仍是 failed,原因不覆盖失败
      if [[ "$final" == completed && -n "${WFR_FINAL_REASON:-}" ]]; then final=partial; stopinfo="$stopinfo reason=$WFR_FINAL_REASON"; fi
      msg="$msg$stopinfo"
      echo "WFR_FINALIZE_OK=$ok"; echo "WFR_FINALIZE_MSG='$msg'"; echo "WFR_FINALIZE_FINAL=$final"
      extra=$("$WFR_JQ" -cn --argjson ok "$ok" --arg msg "$msg" '[{type:"finalize",ok:$ok,msg:$msg}]')
      brain_post "${WFR_RUN_ID:-}__${WFR_ATTEMPT:-a0}.cleanup" "$final" cleanup "${WFR_LAST_ARTIFACT:-}" "$extra"
    fi;;
  *) warn "unknown subcommand: $cmd";;
esac
exit 0
