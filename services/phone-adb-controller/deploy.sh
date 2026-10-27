#!/bin/bash
# deploy.sh —— phone-adb-controller 一键同步脚本(0923补建)
#
# 根因(0923主理人真机复盘炸出来的坑): 这套判定链/采收/触达脚本从来没有自动部署链路——
# GitHub 合并只是更新了"配方书",真正跑在生产上的是 mmv(~/.openclaw/leadgen-scripts/)+
# xian-m4(~/bin-harvest/)两台物理机器上的手工拷贝,每次改代码
# 都要有人记得手动scp到两个地方,漏一个就是"PR里明明改了,机器上还是老样子"。
# apps/api那边早就有 promote-prod-hk.yml 这种自动化,这块从来没建过,退化成靠人肉记忆。
#
# 用法(必须在装了到 mmv/xian-m4 这两个 SSH 别名的机器上跑,比如这台交互机):
#   cd zenithjoy-workspace仓库根目录
#   bash services/phone-adb-controller/deploy.sh
#
# 对账(0929): 部署完/怀疑有机器跑旧版时跑 bash services/phone-adb-controller/drift-check.sh,
#   逐文件比对 origin/main 与两台机器的 md5,有漂移经 Bark 告警(同组当天只告一次)。mmv 上由 launchd 每天
#   北京时间 09:30 自动跑,模板与安装步骤见 launchd/com.zenithjoy.leadgen-drift-check.plist。
#   改了本文件里的数组名/形状 → drift-check.sh 的 parse_array 也要跟着改(解析为空会 exit 2 拒绝假绿)。
#
# 覆盖范围(v1,有意从小做起,见下方"不在本次范围"):
#   *.js  → mmv:~/.openclaw/leadgen-scripts/(判定链+数据层)
#   *.sh  → xian-m4:~/bin-harvest/(四台手机所在的设备/ADB层)
#   cmdr-escort.txt / cmdr-stream.txt → mmv:~/.openclaw/(agent SOP,按绝对路径引用)
#   plans/*.plan → xian-m4:~/bin-harvest/plans/(wf-run.sh 的执行计划,契约生成)
#   MMV_BIN_FILES → mmv:~/bin/(0930 任务 975aa6ec: 分身 watcher escort-claude-escalation.sh + 日志桥活性守卫
#     log-bridge-liveness.sh,两者由 mmv launchd 拉起;watcher 换版自动 kickstart -k,守卫按 StartInterval 自然读新版)
#   常驻 launchd 脚本换版即重载: 执行机 log-stream-push.sh(com.zenithjoy.logstreampush)与 mmv watcher 都是 KeepAlive
#     长驻进程,mv 换 inode 后跑的仍是旧版——md5 变了就 launchctl kickstart -k,否则"部署成功"了生产照旧跑老代码。
#
# 不在本次范围(有意排除,别当成漏了):
#   - *.plist: launchd 安装是一次性动作,不是"同步文件"能表达的操作(模板与安装命令见 launchd/*.plist 头注释与
#     com.zenithjoy.logstreampush.plist)
#   - config/*.json: 可能含机器本地校准过的实验数据,批量覆盖有丢真实调参的风险
#   - __tests__/、*.md、package.json: 不需要跑在生产机上
#
# 每份文件同步后立刻在目标机上跑语法检查(zsh -n / node -c),同步一份验证一份,
# 不是"复制完就算数"——避免把语法错误的半成品扔到生产机上。
#
# 原子替换(0928): 一律先 scp 到同目录临时名 .<文件名>.deploy-new,再 ssh mv -f 到目标名。
# 原因: scp 原地覆盖是"截断后写入同一个 inode",而 zsh 是边读边执行脚本——正在跑的 outreach-tick /
# harvest 批次会读到半截新内容(甚至新旧内容拼接)而炸掉。mv 是换 inode,运行中的进程继续读旧 inode
# 直到自己退出,新一轮才读到新文件。
set -euo pipefail
cd "$(dirname "$0")"
D="."
if [[ "${1:-}" == "--commander-only" ]]; then
  echo "手机发布必须使用已验收候选的完整事务" >&2
  exit 1
fi
# Materialize the pinned skill bundle before copying any runtime documents.
node ../../scripts/ci/implementation-skill-source.mjs --install-regression-skills ../.. >&2
FAILED=0

# push_atomic <本地文件> <host> <远端目录(可含~)> <文件名> [x]
#   先 scp 到同目录临时名,再远端 mv -f 换 inode;带第 5 参 x 时在 mv 之前先 chmod +x(不留"新文件无执行权限"的窗口)。
for _helper in deployment-functions.sh deployment-m4-payload.sh deployment-m4-payload.py; do
  (
    # Match the existing fixed-source readers: ambient Git state is never authority.
    for _git_var in ${!GIT_@}; do unset "$_git_var"; done
    export GIT_NO_REPLACE_OBJECTS=1 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
    git --no-replace-objects -C "$D/../.." show "HEAD:services/phone-adb-controller/$_helper"
  ) | cmp - "$D/$_helper" || { echo "部署helper不属于当前固定源: $_helper" >&2; exit 1; }
done
source "$D/deployment-functions.sh"



MMV_JS_FILES=(
  capture-strategy.mjs
  push-videos.js push-raw-comments.js sort-comments.js sort-comments-lib.js next-outreach.js next-outreach-lib.js
  discovery-cleanup-readback.mjs discovery-metrics.js discovery-metrics-queue.js leadgen-db-lib.js company-config-lib.js company-config-sync-lib.js leadgen-db-connect.js judge-jev.js judge-comment.js judge-video.js
  judge-video-lib.js qualify-video.js transcribe-qwen-audio.js comment-tier-lib.js line-routes.js
  lead-fields-lib.js kpi-gate.js next-keywords.js keyword-enabled-lib.js update-keyword-stats.js keyword-stats-lib.js
  fetch-seen-videos.js fetch-seen-titles.js check-own-account.js dm-daily-cap.js dm-rate-ramp-lib.js
  own-accounts-lib.js push-leads.js update-profile-links.js nickname-match-lib.js
  stats-line.js notify-bark.js push-stats-lib.js
  outreach-order-lock.py queued-recipient-evidence.js judge-recipient.js leadgen-outreach-bridge.js
  queued-comment-history.js leadgen-rpc.mjs leadgen-queue.js producer-pending-claim.js single-video-recovery.js single-video-recovery-authority.js single-video-recovery-0353.js single-video-recovery-0353-authority.js leadgen-policy-review.js leadgen-scoring-handler.mjs commander-model-receipt.mjs activity-commander.mjs commander-owner-state.mjs commander-owner-lock.mjs commander-owner-reconcile.mjs activity-skill-recovery.mjs activity-skill-broker.mjs activity-skill-tool.mjs leadgen-skill-agent.mjs leadgen-client.mjs native-operation-receipt.mjs leadgen-discovery-action.mjs leadgen-discovery.mjs leadgen-phone-action.mjs discovery-phone-scope.mjs collection-phone-scope.mjs collection-leaf-producer.mjs collection-acceptance-probe.mjs commander/wf-agent-handoff.py commander/wf-agent-lib.py
  leadgen-outreach-orders.js
  pg-notion-mirror-lib.js leadgen-notion-mirror.js
  deployment-manifest.mjs deployment-fixed-source.mjs deployment-publish-release.mjs runtime-definition.mjs producer-descriptor.mjs no-comments-evidence.mjs comment-count-evidence.py runtime-host.mjs runtime-release.mjs runtime-binding.mjs runtime-outbox.mjs
)
MMV_TOPLEVEL_FILES=(cmdr-escort.txt cmdr-stream.txt)
# 0930(任务 975aa6ec): mmv 本机 launchd 拉起的两支脚本。escort-claude-escalation.sh 此前列在 DEVICE_SH_FILES 发去执行机
# 的 bin-harvest(那里从来没人跑它),真身一直是 mmv ~/bin/ 的手工拷贝(0916 起没更新过)。
MMV_BIN_FILES=(escort-claude-escalation.sh log-bridge-liveness.sh)

# remote_md5 <host> <远端路径(可含~)> —— 文件不存在打空串;用于"换版才重载 launchd"的判断
remote_md5() { ssh "$1" "if [ -f $2 ]; then if command -v md5 >/dev/null 2>&1; then md5 -q $2; else md5sum $2 | cut -d' ' -f1; fi; fi" 2>/dev/null; }
# kickstart_if_changed <host> <label> <旧md5> <远端路径> —— md5 变了才 launchctl kickstart -k(KeepAlive 长驻进程读的是旧 inode)
kickstart_if_changed() {
  local host="$1" label="$2" before="$3" rpath="$4" after
  [[ -z "${WF_PHONE_TRANSACTION:-}" ]] || return 0 # 协调器整包写完才精确重载。
  after="$(remote_md5 "$host" "$rpath")"
  if [[ "$before" == "$after" ]]; then echo "    · $label 内容未变,不重载"; return 0; fi
  # 10-08: 有意 launchctl disable 的服务(如 mmv 分身 watcher)kickstart 必失败,不能因此卡住 manifest 发布;文件照常换版,启用时自然读新版
  if ssh "$host" "launchctl print-disabled gui/\$(id -u)" 2>/dev/null | grep -qF "\"$label\" => disabled"; then
    echo "    · $label 已被 launchctl disable,不重载(文件已换版)"; return 0
  fi
  if ssh "$host" "launchctl kickstart -k gui/\$(id -u)/$label" 2>/tmp/deploy-err-$$; then
    echo "    🔄 $label 已 kickstart -k(脚本换版)"
  else
    echo "    ❌ $label 重载失败: $(head -2 /tmp/deploy-err-$$)——生产仍在跑旧版,需人工 launchctl kickstart -k"
    FAILED=1
  fi
  rm -f /tmp/deploy-err-$$
}
# 6b133a81: 探针读回+运行时拦截在 mmv 跑(workflow-result.sh probe_stage 经 ssh 调 verify-step.mjs),此前从没进过部署清单——
# 靠 README 里手工 scp,0929 实测 mmv 上的探针 YAML 已落后 main。路径相对本目录,子目录原样落到 leadgen-scripts/ 下。
MMV_PROBE_FILES=(
  config/collection-phone-hosts.json config/own-accounts.json config/leadgen-outreach-rate-ramp.json
  verify-step.mjs checks/probes-lib.js checks/schema.json checks/social-keyword-leadgen.yaml checks/social-benchmark-leadgen.yaml
  step-judge.mjs step-dod.json step-dod-stats.mjs
  checks/douyin-video-discovery.yaml checks/douyin-video-processing.yaml checks/douyin-comment-scoring.yaml checks/douyin-lead-outreach.yaml
  plans/douyin_video_discovery.steps.json plans/douyin_video_processing.steps.json plans/douyin_comment_scoring.steps.json plans/douyin_lead_outreach.steps.json
)
# 设备控制器单独成组: 它必须同时落到**两个**目录,因为两类消费者各指一个——
#   ~/.local/bin/  ← harvest-keyword.sh:7 / outreach-tick.sh / refill-profile-links.sh
#                    的 C= 全部写死这里, 是 cron 真正执行的那份
#   ~/bin-harvest/ ← device-job-claimer.sh 的 PHONE_CTL 默认值指这里
# 0924 血的教训: 只发 bin-harvest 时,PR 合并、deploy.sh 全绿、md5 校验也通过,
# 生产跑的却仍是 ~/.local/bin 的旧版本,音量棘轮修复完全没生效,最后靠人工 scp 才落地。
# 漏任一目录 = 两份副本版本分叉,且部署过程不会报任何错。层26 smoke 守卫盯这件事。
DEVICE_CTL_FILES=(
  phone-lock-lib.sh phone-lock-helper.py adb-existing-route.py adb-managed-client.py adb-host-service.py adb-host-maintenance.py adb-process-observation.py maintenance-task-authority.py locate-element.py douyin-phone-adb clipboard-widget-cancel.py search-video-tab.py text-input-focus.py input-runtime-release.py
  decode-recording.py runtime/scrcpy-runtime.py runtime/scrcpy-adb-shim.py runtime/runtime-policy.json runtime/runtime-policy-sdk33.json
  bypass-report.sh
)
DEVICE_CTL_DIRS=(bin-harvest .local/bin)
DEVICE_SH_FILES=(
  leadgen-run.sh leadgen-activity.sh leadgen-qualify.sh queued-video-lib.sh process-queued-video.sh
  harvest-keyword.sh harvest-keyword-lib.sh batch2.sh harvest-cron.sh wf-run.sh wf-run-lib.sh discover-keyword.sh discovery-v2-lib.sh outreach-tick.sh
  refill-profile-links.sh wall-report.sh wall-lib.sh phone-wall-push.sh
  disk-gateway-guard.sh device-job-claimer.sh log-stream-push.sh
  brain-lock.sh harvest-fallback.sh
  workflow-result.sh discover-benchmark.sh wf-limits.sh install-phone-recovery.sh install-adb-host-service.sh
)
# 0927 棒3b-3: 账本钩子内建进 harvest-cron.sh/batch2.sh,workflow-result.sh 硬依赖 ledger.mjs(node),
# 少了它账本全程 WFR_WARN——单独成组,用 node --check 而不是 zsh -n 验语法。
# 9032cdad: 步骤 DoD 统一裁判在执行机本地判 metric/evidence/log/tsv/ledger 类,清单 step-dod.json 由契约生成(json 用 JSON.parse 验)
# 同一 RPC 源文件在设备冻结、MMV执行；不能依赖未登记的远端副本。
RPC_FILES=(capture-strategy.mjs runtime-definition.mjs producer-descriptor.mjs no-comments-evidence.mjs comment-count-evidence.py runtime-host.mjs runtime-release.mjs runtime-binding.mjs runtime-outbox.mjs commander/AGENTS.md commander/skills/workflow-commander/SKILL.md skills/leadgen-activity-execution.md skills/douyin-leadgen-activity-101-collect-videos/SKILL.md skills/douyin-leadgen-activity-102-preflight/SKILL.md skills/douyin-leadgen-activity-102-dedup/SKILL.md skills/douyin-leadgen-activity-102-qualification/SKILL.md skills/douyin-leadgen-activity-102-collection/SKILL.md skills/douyin-leadgen-activity-102-cleanup/SKILL.md skills/douyin-leadgen-activity-103-scoring/SKILL.md skills/douyin-leadgen-activity-103-mark-leads/SKILL.md skills/douyin-leadgen-activity-104-preflight/SKILL.md skills/douyin-leadgen-activity-104-send-dm/SKILL.md skills/douyin-leadgen-activity-104-write-back/SKILL.md skills/douyin-leadgen-activity-104-cleanup/SKILL.md activity-skill-recovery.mjs activity-skill-broker.mjs activity-skill-tool.mjs leadgen-skill-agent.mjs leadgen-client.mjs native-operation-receipt.mjs leadgen-discovery-action.mjs leadgen-discovery.mjs leadgen-phone-action.mjs discovery-phone-scope.mjs collection-phone-scope.mjs collection-leaf-producer.mjs collection-acceptance-probe.mjs commander/wf-agent-handoff.py commander/wf-agent-lib.py outreach-order-lock.py queued-recipient-evidence.js judge-recipient.js leadgen-outreach-bridge.js lead-fields-lib.js nickname-match-lib.js queued-comment-history.js leadgen-rpc.mjs leadgen-queue.js producer-pending-claim.js single-video-recovery.js single-video-recovery-authority.js single-video-recovery-0353.js single-video-recovery-0353-authority.js leadgen-policy-review.js leadgen-scoring-handler.mjs leadgen-outreach-orders.js next-outreach-lib.js dm-rate-ramp-lib.js config/collection-phone-hosts.json config/own-accounts.json config/leadgen-outreach-rate-ramp.json commander-model-receipt.mjs activity-commander.mjs commander-owner-state.mjs commander-owner-lock.mjs commander-owner-reconcile.mjs discovery-metrics.js discovery-metrics-queue.js leadgen-db-lib.js company-config-lib.js leadgen-db-connect.js judge-video.js judge-video-lib.js judge-jev.js judge-comment.js qualify-video.js transcribe-qwen-audio.js line-routes.js stats-line.js next-keywords.js keyword-enabled-lib.js verify-step.mjs step-judge.mjs checks/probes-lib.js checks/schema.json checks/douyin-video-discovery.yaml checks/douyin-video-processing.yaml checks/douyin-comment-scoring.yaml checks/douyin-lead-outreach.yaml plans/douyin_video_discovery.steps.json plans/douyin_video_processing.steps.json plans/douyin_comment_scoring.steps.json plans/douyin_lead_outreach.steps.json)
DEVICE_NODE_FILES=(discovery-cleanup-readback.mjs capture-strategy.mjs activity-skill-recovery.mjs activity-skill-broker.mjs activity-skill-tool.mjs leadgen-skill-agent.mjs commander/wf-agent-handoff.py commander/wf-agent-lib.py outreach-order-lock.py queued-recipient-evidence.js judge-recipient.js leadgen-outreach-bridge.js lead-fields-lib.js nickname-match-lib.js queued-comment-history.js leadgen-client.mjs native-operation-receipt.mjs leadgen-discovery-action.mjs leadgen-phone-action.mjs discovery-phone-scope.mjs collection-phone-scope.mjs collection-leaf-producer.mjs collection-acceptance-probe.mjs leadgen-workflow.mjs leadgen-handlers.mjs leadgen-video-action.mjs leadgen-outreach.mjs leadgen-outreach-orders.js next-outreach-lib.js dm-rate-ramp-lib.js config/collection-phone-hosts.json config/own-accounts.json config/leadgen-outreach-rate-ramp.json leadgen-discovery.mjs own-accounts-lib.js leadgen-rpc.mjs leadgen-queue.js producer-pending-claim.js single-video-recovery.js single-video-recovery-authority.js single-video-recovery-0353.js single-video-recovery-0353-authority.js leadgen-policy-review.js leadgen-scoring-handler.mjs commander-model-receipt.mjs activity-commander.mjs commander-owner-state.mjs commander-owner-lock.mjs commander-owner-reconcile.mjs discovery-metrics.js discovery-metrics-queue.js leadgen-db-lib.js company-config-lib.js leadgen-db-connect.js judge-video.js judge-video-lib.js judge-jev.js judge-comment.js qualify-video.js transcribe-qwen-audio.js line-routes.js stats-line.js next-keywords.js keyword-enabled-lib.js runtime-host.mjs runtime-definition.mjs producer-descriptor.mjs no-comments-evidence.mjs comment-count-evidence.py runtime-release.mjs runtime-binding.mjs runtime-outbox.mjs runtime-receipts.mjs deployment-manifest.mjs deployment-fixed-source.mjs ledger.mjs step-judge.mjs step-dod.json phone-recovery.mjs notify-bark.js)
# 探针与配套Skill同属需保留嵌套路径的发布文件；设备/MMV均采集实际字节。
DEVICE_RPC_PROBE_FILES=(
  commander/AGENTS.md
  commander/skills/workflow-commander/SKILL.md
  skills/leadgen-activity-execution.md
  skills/douyin-leadgen-101/references/activity-methods.json
  skills/douyin-leadgen-activity-101-collect-videos/SKILL.md
  skills/douyin-leadgen-102/references/activity-methods.json
  skills/douyin-leadgen-activity-102-preflight/SKILL.md
  skills/douyin-leadgen-activity-102-dedup/SKILL.md
  skills/douyin-leadgen-activity-102-qualification/SKILL.md
  skills/douyin-leadgen-activity-102-collection/SKILL.md
  skills/douyin-leadgen-activity-102-cleanup/SKILL.md
  skills/douyin-leadgen-103/references/activity-methods.json
  skills/douyin-leadgen-activity-103-scoring/SKILL.md
  skills/douyin-leadgen-activity-103-mark-leads/SKILL.md
  skills/douyin-leadgen-104/references/activity-methods.json
  skills/douyin-leadgen-activity-104-preflight/SKILL.md
  skills/douyin-leadgen-activity-104-send-dm/SKILL.md
  skills/douyin-leadgen-activity-104-write-back/SKILL.md
  skills/douyin-leadgen-activity-104-cleanup/SKILL.md
  verify-step.mjs checks/probes-lib.js checks/schema.json checks/douyin-video-discovery.yaml checks/douyin-video-processing.yaml checks/douyin-comment-scoring.yaml checks/douyin-lead-outreach.yaml
  skills/douyin-leadgen-101/SKILL.md
  skills/douyin-leadgen-101/references/reuse-map.json
  skills/douyin-leadgen-101/references/runtime-calls.json
  skills/douyin-leadgen-102/SKILL.md
  skills/douyin-leadgen-102/references/reuse-map.json
  skills/douyin-leadgen-102/references/runtime-calls.json
  skills/douyin-leadgen-103/SKILL.md
  skills/douyin-leadgen-103/references/reuse-map.json
  skills/douyin-leadgen-103/references/runtime-calls.json
  skills/douyin-leadgen-104/SKILL.md
  skills/douyin-leadgen-104/references/reuse-map.json
  skills/douyin-leadgen-104/references/runtime-calls.json
)
# 7f842d12 契约组装执行: wf-run.sh 读 ~/bin-harvest/plans/<能力>.plan(wf-plan.mjs 从契约生成、提交在仓库)。
# 执行机没有仓库 node_modules,所以计划不在执行机上生成;漏发 = wf-run 拒跑并升级(不会静默跑错)。
DEVICE_PLAN_FILES=(plans/keyword_acquisition.plan plans/benchmark_link_acquisition.plan plans/keyword_acquisition.steps.json plans/benchmark_link_acquisition.steps.json plans/douyin_video_discovery.plan plans/douyin_video_processing.plan plans/douyin_comment_scoring.plan plans/douyin_lead_outreach.plan plans/douyin_video_discovery.steps.json plans/douyin_video_processing.steps.json plans/douyin_comment_scoring.steps.json plans/douyin_lead_outreach.steps.json)

# RPC method loading reads the same source-verified Skill bytes as the device freeze.
for f in "${DEVICE_RPC_PROBE_FILES[@]}"; do
  [[ " ${MMV_PROBE_FILES[*]} " == *" $f "* ]] || MMV_PROBE_FILES+=("$f")
done

# MMV独立0103 runner与RPC服务均取正式发布字节；完整四流程定义满足Brain完整CI，运行host限制另行核验。
MMV_RUNTIME_FILES=()
for f in "${DEVICE_SH_FILES[@]}" "${DEVICE_NODE_FILES[@]}" "${DEVICE_PLAN_FILES[@]}" "${DEVICE_RPC_PROBE_FILES[@]}" "${DEVICE_CTL_FILES[@]}" "${MMV_JS_FILES[@]}" "${MMV_PROBE_FILES[@]}"; do
  [[ " ${MMV_RUNTIME_FILES[*]-} " == *" $f "* ]] || MMV_RUNTIME_FILES+=("$f")
done
RELEASE_EVIDENCE_FILES=(
  apps/api/db/migrations/20261022_120000_discovery_metrics.sql=release-evidence/20261022_120000_discovery_metrics.sql
  apps/api/db/migrations/20261014_130000_leadgen_outreach_bridge.sql=release-evidence/20261014_130000_leadgen_outreach_bridge.sql
)
RELEASE_EVIDENCE_ARGS=()
for mapping in "${RELEASE_EVIDENCE_FILES[@]}"; do RELEASE_EVIDENCE_ARGS+=("--repository-file=$mapping"); done
REPO_ROOT="$(git rev-parse --show-toplevel)"
# 在任何SSH前核验部署源字节属于固定commit；manifest最后发布，半次部署不能通过起跑核验。
# 所有入口都必须带完整、正式回读的目标计划；空map不能覆盖已有ready身份。
: "${WF_COMMANDER_RELEASES_FILE:?必须提供完整Commander release映射}" "${WF_DEPLOY_PLAN_FILE:?必须提供统一部署计划}"
node "$D/deployment-targets.mjs" "$WF_DEPLOY_PLAN_FILE" "$(git rev-parse HEAD)"
# Actions和人工入口共享内核租锁；FD身份被核验，部署终止自然释放。
if [[ -z "${WF_DEPLOY_LOCK_FD:-}" ]]; then
  exec python3 "$D/deployment-guard.py" bash "$PWD/deploy.sh" "$@"
fi
python3 "$D/deployment-guard.py" check

DEPLOY_MANIFEST=$(mktemp)
MMV_MANIFEST=$(mktemp)
PUBLISH_PENDING_SHA=''
cleanup_deployment() {
  local status=$?
  if [[ -n "$PUBLISH_PENDING_SHA" && -z "${WF_PHONE_TRANSACTION:-}" ]]; then
    ssh mmv node '~/.openclaw/leadgen-scripts/deployment-publish-release.mjs' rollback "$PUBLISH_PENDING_SHA" || echo '❌ 发布链接回退未完成，保留部署admission' >&2
  fi
  rm -f "$DEPLOY_MANIFEST" "$MMV_MANIFEST"
  return "$status"
}
trap cleanup_deployment EXIT
activate_publish_package() {
  ssh mmv 'mkdir -p ~/.openclaw/leadgen-scripts'
  for file in deployment-publish-release.mjs deployment-fixed-source.mjs; do
    push_atomic "$D/$file" mmv '~/.openclaw/leadgen-scripts' "$file"
  done
  PUBLISH_PENDING_SHA="$(git rev-parse HEAD)"
  python3 -c 'import json,sys;print(json.dumps(dict(source=sys.argv[1],revision=sys.argv[2])))' "$REPO_ROOT" "$PUBLISH_PENDING_SHA" | ssh mmv node '~/.openclaw/leadgen-scripts/deployment-publish-release.mjs' deploy-stdin
}
: "${WF_RELEASE_IDS:?必须提供全部部署目标的明确release_id映射}" "${WF_DEPLOY_ENVIRONMENT:?必须提供部署环境}" "${WF_DEPLOY_COLLECTOR:?必须提供受信collector}" "${WF_DEPLOY_ATTEMPT_KEY:?必须提供部署attempt}" "${BRAIN_URL:?必须提供Brain地址}"
node "$D/deployment-manifest.mjs" "$(git rev-parse --show-toplevel)" "${DEVICE_SH_FILES[@]}" "${DEVICE_NODE_FILES[@]}" "${DEVICE_PLAN_FILES[@]}" "${DEVICE_RPC_PROBE_FILES[@]}" "${DEVICE_CTL_FILES[@]}" "${RELEASE_EVIDENCE_ARGS[@]}" > "$DEPLOY_MANIFEST"
node "$D/deployment-manifest.mjs" "$(git rev-parse --show-toplevel)" "${MMV_RUNTIME_FILES[@]}" "${RELEASE_EVIDENCE_ARGS[@]}" > "$MMV_MANIFEST"
node "$D/deployment-targets.mjs" "$WF_DEPLOY_PLAN_FILE" "$(git rev-parse HEAD)"
# Reject incomplete/legacy input sources before any remote mutation. The paired revision
# protects only deployments using this script; older deployment writers must adopt it too.
python3 "$D/input-runtime-release.py" source-info "$D/douyin-phone-adb" "$D/text-input-focus.py" >/dev/null

# 新公司模块只在PG schema已就绪时安装；只读探针先于远端admission写入。
node "$D/company-config-readiness.mjs"
if [[ -z "${WF_PHONE_TRANSACTION:-}" ]]; then
  node "$D/deployment-backend.mjs" deploy "$(git rev-parse HEAD)" '' "$WF_DEPLOY_PLAN_FILE" "$DEPLOY_MANIFEST" "$MMV_MANIFEST"
  exit $?
fi
node "$D/deployment-backend.mjs" check-child "$(git rev-parse HEAD)" "$WF_PHONE_TRANSACTION"
commander_admission
[[ "$FAILED" == 0 ]] || exit 1
deploy_release_evidence


echo "=== [1/3] mmv:~/.openclaw/leadgen-scripts/ (判定链+数据层, ${#MMV_JS_FILES[@]} 个文件) ==="
for f in "${MMV_JS_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
  _pd="$(dirname "$f")"; _pdir="~/.openclaw/leadgen-scripts"; [[ "$_pd" != "." ]] && _pdir="$_pdir/$_pd"
  ssh mmv "mkdir -p $_pdir"
  push_atomic "$D/$f" mmv "$_pdir" "$(basename "$f")"
  case "$f" in
    *.py) _chk="python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' ~/.openclaw/leadgen-scripts/$f";;
    *) _chk="node -c ~/.openclaw/leadgen-scripts/$f";;
  esac
  if ssh mmv "$_chk" 2>/tmp/deploy-err-$$; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 语法检查失败: $(cat /tmp/deploy-err-$$ | head -3)"
    FAILED=1
  fi
  rm -f /tmp/deploy-err-$$
done

echo "=== [1b/3] mmv:~/.openclaw/leadgen-scripts/ 探针读回(${#MMV_PROBE_FILES[@]} 个文件) ==="
for f in "${MMV_PROBE_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
  _pd="$(dirname "$f")"; _pdir="~/.openclaw/leadgen-scripts"; [[ "$_pd" != "." ]] && _pdir="$_pdir/$_pd"
  ssh mmv "mkdir -p $_pdir"
  push_atomic "$D/$f" mmv "$_pdir" "$(basename "$f")"
  case "$f" in
    *.js|*.mjs) _chk="node --check ~/.openclaw/leadgen-scripts/$f";;
    *.json) _chk="node -e 'JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"))' ~/.openclaw/leadgen-scripts/$f";;
    *) _chk="test -s ~/.openclaw/leadgen-scripts/$f";;
  esac
  if ssh mmv "$_chk" 2>/tmp/deploy-err-$$; then echo "  ✅ $f"
  else echo "  ❌ $f 校验失败: $(head -3 /tmp/deploy-err-$$)"; FAILED=1; fi
  rm -f /tmp/deploy-err-$$
done

echo "=== [2/3] mmv:~/.openclaw/ 顶层(agent SOP, ${#MMV_TOPLEVEL_FILES[@]} 个文件) ==="
for f in "${MMV_TOPLEVEL_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
  push_atomic "$D/$f" mmv "~/.openclaw" "$f"
  echo "  ✅ $f"
done

echo "=== [2b/3] mmv:~/bin/ (launchd 长驻脚本, ${#MMV_BIN_FILES[@]} 个文件) ==="
ssh mmv "mkdir -p ~/bin"
for f in "${MMV_BIN_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
  _before="$(remote_md5 mmv "~/bin/$f")"
  push_atomic "$D/$f" mmv "~/bin" "$f" x
  case "$(head -1 "$D/$f")" in *zsh*) _chk="zsh -n ~/bin/$f";; *) _chk="bash -n ~/bin/$f";; esac
  if ssh mmv "$_chk" 2>/tmp/deploy-err-$$; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
    FAILED=1
  fi
  rm -f /tmp/deploy-err-$$
  # 分身 watcher 是 KeepAlive 长驻(tail -F 一直挂着),换版必须重载;守卫按 StartInterval 每次新起进程,自然读新版
  [[ "$f" == "escort-claude-escalation.sh" ]] && kickstart_if_changed mmv com.zenithjoy.escortclaude "$_before" "~/bin/$f"
done

echo "=== [3/3] xian-m4:~/bin-harvest/ 普通payload批量暂存、原序逐文件安装 ==="
for host in xian-m4; do
  deploy_m4_payload "$host"
done

echo "=== [4/4] 设备控制器 → 每台机器的 ${#DEVICE_CTL_DIRS[@]} 个执行路径 (${#DEVICE_CTL_FILES[@]} 个文件) ==="
for host in xian-m4; do
  echo "  --- $host ---"
  # Capture both runtime paths before upload; install compares them under one deployment guard.
  # A new paused/viewport controller is allowed when it carries the same verified input pair.
  _input_stage="$(ssh "$host" 'mktemp -d /tmp/input-runtime-deploy.XXXXXX')"
  scp -q -p "$D/input-runtime-release.py" "$D/deployment-transaction.py" "$D/deployment-maintenance.py" "$host:$_input_stage/"
  if ssh "$host" "python3 $_input_stage/input-runtime-release.py capture ~/bin-harvest ~/.local/bin > $_input_stage/expected.json" && \
     scp -q -p "$D/douyin-phone-adb" "$D/text-input-focus.py" "$host:$_input_stage/" && \
     ssh "$host" "python3 $_input_stage/input-runtime-release.py install-maintenance $WF_PHONE_TRANSACTION $_input_stage/douyin-phone-adb $_input_stage/text-input-focus.py $_input_stage/expected.json ~/.config/openclaw/douyin-phone-profiles.tsv /private/tmp/openclaw-phone/locks ~/bin-harvest ~/.local/bin"; then
    echo "    ✅ input controller/helper pair CAS verified in both runtime paths"
  else
    echo "    ❌ input pair rejected (revision/source/CAS/readback); deployment cannot be declared successful"
    FAILED=1
  fi
  ssh "$host" "rm -f $_input_stage/deployment-transaction.py $_input_stage/deployment-maintenance.py $_input_stage/input-runtime-release.py $_input_stage/douyin-phone-adb $_input_stage/text-input-focus.py $_input_stage/expected.json; rmdir $_input_stage" || true
  for f in "${DEVICE_CTL_FILES[@]}"; do
    [[ "$f" != "douyin-phone-adb" && "$f" != "text-input-focus.py" ]] || continue
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
    for dir in "${DEVICE_CTL_DIRS[@]}"; do
      ssh "$host" "mkdir -p ~/$dir/$(dirname "$f")"
      push_atomic "$D/$f" "$host" "~/$dir" "$f" x
      ssh "$host" "chmod +x ~/$dir/$f"
      if [[ "$f" == *.py ]]; then
        _ctl_check="/opt/homebrew/bin/python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' ~/$dir/$f"
      elif [[ "$f" == *.json ]]; then
        _ctl_check="/opt/homebrew/bin/node -e 'JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"))' ~/$dir/$f"
      else
        _ctl_check="zsh -n ~/$dir/$f"
      fi
      if ssh "$host" "$_ctl_check" 2>/tmp/deploy-err-$$; then
        echo "    ✅ $dir/$f"
      else
        echo "    ❌ $dir/$f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
        FAILED=1
      fi
      rm -f /tmp/deploy-err-$$
    done
    # 两个目录必须字节一致,否则两类消费者跑的是不同版本
    _sums="$(ssh "$host" "md5 -q ~/bin-harvest/$f ~/.local/bin/$f 2>/dev/null | sort -u | wc -l" | tr -d ' ')"
    if [[ "$_sums" == "1" ]]; then
      echo "    ✅ $f 两个路径字节一致"
    else
      echo "    ❌ $f 两个路径内容不一致(版本分叉,消费者会跑到不同版本)"
      FAILED=1
    fi
  done
done

deploy_commander

if ! phone_transaction_tool xian-m4 service apply; then
  echo "❌ PHONE_RECOVERY 开机自检安装失败"; FAILED=1
fi

# 同源完整包落MMV两执行路径：bin-harvest独立调度；leadgen-scripts服务现有设备RPC。
echo "=== MMV独立评分正式运行包（${#MMV_RUNTIME_FILES[@]} 个固定文件） ==="
for rroot in "~/bin-harvest" "~/.openclaw/leadgen-scripts"; do
  for f in "${MMV_RUNTIME_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "  ❌ 缺MMV运行文件: $f"; FAILED=1; continue; fi
    _pd="$(dirname "$f")"; _rdir="$rroot"; [[ "$_pd" != "." ]] && _rdir="$_rdir/$_pd"
    ssh mmv "mkdir -p $_rdir"
    case "$f" in
      *.sh|*.py|douyin-phone-adb) _mode=x;;
      *) _mode="";;
    esac
    push_atomic "$D/$f" mmv "$_rdir" "$(basename "$f")" "$_mode"
    case "$f" in
      *.js|*.mjs) _chk="node --check $rroot/$f";;
      *.json) _chk="node -e 'JSON.parse(require(\"fs\").readFileSync(process.argv[1],\"utf8\"))' $rroot/$f";;
      *.py) _chk="/opt/homebrew/bin/python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' $rroot/$f";;
      *.sh|*.plan|douyin-phone-adb) _chk="zsh -n $rroot/$f";;
      *) _chk="test -s $rroot/$f";;
    esac
    if ! ssh mmv "$_chk" 2>/tmp/deploy-err-$$; then
      echo "  ❌ MMV $f 校验失败: $(head -3 /tmp/deploy-err-$$)"; FAILED=1
    fi
    rm -f /tmp/deploy-err-$$
  done
done

echo ""
if [[ "$FAILED" == "1" ]]; then
  echo "⚠️ 部分文件语法检查失败,见上方 ❌ 标记——已同步的文件里可能有半成品,立刻核查"
  exit 1
fi
# 完整安装实读后：先xian ACK，后唯一MMV聚合ACK；旧本机视图不含远端files。
activate_publish_package
node "$D/deployment-unified-observe.mjs" "$WF_DEPLOY_PLAN_FILE" "$DEPLOY_MANIFEST" "$MMV_MANIFEST"
PUBLISH_PENDING_SHA=''
: # 完整事务由协调器读回后提交并释放admission
echo "✅ 同一目标完整release已部署，旧运行包与Commander共享正式观测。"
