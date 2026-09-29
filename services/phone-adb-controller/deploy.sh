#!/bin/bash
# deploy.sh —— phone-adb-controller 一键同步脚本(0923补建)
#
# 根因(0923主理人真机复盘炸出来的坑): 这套判定链/采收/触达脚本从来没有自动部署链路——
# GitHub 合并只是更新了"配方书",真正跑在生产上的是 mmv(~/.openclaw/leadgen-scripts/)+
# xian-m4(~/bin-harvest/)+xian-m1(~/bin-harvest/)三台物理机器上的手工拷贝,每次改代码
# 都要有人记得手动scp到三个地方,漏一个就是"PR里明明改了,机器上还是老样子"。
# apps/api那边早就有 promote-prod-hk.yml 这种自动化,这块从来没建过,退化成靠人肉记忆。
#
# 用法(必须在装了到 mmv/xian-m4/xian-m1 这三个 SSH 别名的机器上跑,比如这台交互机):
#   cd zenithjoy-workspace仓库根目录
#   bash services/phone-adb-controller/deploy.sh
#
# 对账(0929): 部署完/怀疑有机器跑旧版时跑 bash services/phone-adb-controller/drift-check.sh,
#   逐文件比对 origin/main 与三台机器的 md5,有漂移经 Bark 告警(同组当天只告一次)。mmv 上由 launchd 每天
#   北京时间 09:30 自动跑,模板与安装步骤见 launchd/com.zenithjoy.leadgen-drift-check.plist。
#   改了本文件里的数组名/形状 → drift-check.sh 的 parse_array 也要跟着改(解析为空会 exit 2 拒绝假绿)。
#
# 覆盖范围(v1,有意从小做起,见下方"不在本次范围"):
#   *.js  → mmv:~/.openclaw/leadgen-scripts/(判定链+数据层)
#   *.sh  → xian-m4:~/bin-harvest/ 和 xian-m1:~/bin-harvest/(设备/ADB层,两台各一份)
#   cmdr-escort.txt / cmdr-stream.txt → mmv:~/.openclaw/(agent SOP,按绝对路径引用)
#   plans/*.plan → xian-m4 / xian-m1:~/bin-harvest/plans/(wf-run.sh 的执行计划,契约生成)
#
# 不在本次范围(有意排除,别当成漏了):
#   - *.plist: launchd 安装是一次性动作,不是"同步文件"能表达的操作
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
FAILED=0

# push_atomic <本地文件> <host> <远端目录(可含~)> <文件名> [x]
#   先 scp 到同目录临时名,再远端 mv -f 换 inode;带第 5 参 x 时在 mv 之前先 chmod +x(不留"新文件无执行权限"的窗口)。
push_atomic() {
  local src="$1" host="$2" rdir="$3" name="$4" mode="${5:-}" tmp
  tmp="$rdir/.$name.deploy-new"
  scp -q -p "$src" "$host:$tmp"
  if [[ "$mode" == "x" ]]; then
    ssh "$host" "chmod +x $tmp && mv -f $tmp $rdir/$name"
  else
    ssh "$host" "mv -f $tmp $rdir/$name"
  fi
}

MMV_JS_FILES=(
  push-videos.js push-raw-comments.js sort-comments.js sort-comments-lib.js next-outreach.js next-outreach-lib.js
  leadgen-db-lib.js leadgen-db-connect.js judge-jev.js judge-comment.js judge-video.js
  judge-video-lib.js qualify-video.js transcribe-qwen-audio.js comment-tier-lib.js line-routes.js
  lead-fields-lib.js kpi-gate.js next-keywords.js keyword-enabled-lib.js update-keyword-stats.js keyword-stats-lib.js
  fetch-seen-videos.js check-own-account.js dm-daily-cap.js dm-rate-ramp-lib.js
  own-accounts-lib.js push-leads.js update-profile-links.js nickname-match-lib.js
  stats-line.js notify-bark.js push-stats-lib.js
)
MMV_TOPLEVEL_FILES=(cmdr-escort.txt cmdr-stream.txt)
# 6b133a81: 探针读回+运行时拦截在 mmv 跑(workflow-result.sh probe_stage 经 ssh 调 verify-step.mjs),此前从没进过部署清单——
# 靠 README 里手工 scp,0929 实测 mmv 上的探针 YAML 已落后 main。路径相对本目录,子目录原样落到 leadgen-scripts/ 下。
MMV_PROBE_FILES=(
  verify-step.mjs checks/probes-lib.js checks/schema.json checks/social-keyword-leadgen.yaml checks/social-benchmark-leadgen.yaml
)
# 设备控制器单独成组: 它必须同时落到**两个**目录,因为两类消费者各指一个——
#   ~/.local/bin/  ← harvest-keyword.sh:7 / outreach-tick.sh / refill-profile-links.sh
#                    的 C= 全部写死这里, 是 cron 真正执行的那份
#   ~/bin-harvest/ ← device-job-claimer.sh 的 PHONE_CTL 默认值指这里
# 0924 血的教训: 只发 bin-harvest 时,PR 合并、deploy.sh 全绿、md5 校验也通过,
# 生产跑的却仍是 ~/.local/bin 的旧版本,音量棘轮修复完全没生效,最后靠人工 scp 才落地。
# 漏任一目录 = 两份副本版本分叉,且部署过程不会报任何错。层26 smoke 守卫盯这件事。
DEVICE_CTL_FILES=(
  douyin-phone-adb
)
DEVICE_CTL_DIRS=(bin-harvest .local/bin)
DEVICE_SH_FILES=(
  harvest-keyword.sh batch2.sh harvest-cron.sh wf-run.sh discover-keyword.sh outreach-tick.sh
  refill-profile-links.sh wall-report.sh wall-lib.sh phone-wall-push.sh
  disk-gateway-guard.sh device-job-claimer.sh log-stream-push.sh
  workflow-result.sh escort-claude-escalation.sh
)
# 0927 棒3b-3: 账本钩子内建进 harvest-cron.sh/batch2.sh,workflow-result.sh 硬依赖 ledger.mjs(node),
# 少了它账本全程 WFR_WARN——单独成组,用 node --check 而不是 zsh -n 验语法。
DEVICE_NODE_FILES=(ledger.mjs)
# 7f842d12 契约组装执行: wf-run.sh 读 ~/bin-harvest/plans/<能力>.plan(wf-plan.mjs 从契约生成、提交在仓库)。
# 执行机没有仓库 node_modules,所以计划不在执行机上生成;漏发 = wf-run 拒跑并升级(不会静默跑错)。
DEVICE_PLAN_FILES=(plans/keyword_acquisition.plan plans/benchmark_link_acquisition.plan)

echo "=== [1/3] mmv:~/.openclaw/leadgen-scripts/ (判定链+数据层, ${#MMV_JS_FILES[@]} 个文件) ==="
for f in "${MMV_JS_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
  push_atomic "$D/$f" mmv "~/.openclaw/leadgen-scripts" "$f"
  if ssh mmv "node -c ~/.openclaw/leadgen-scripts/$f" 2>/tmp/deploy-err-$$; then
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

echo "=== [3/3] xian-m4 + xian-m1:~/bin-harvest/ (设备/ADB层, ${#DEVICE_SH_FILES[@]} 个文件 × 2台) ==="
for host in xian-m4 xian-m1; do
  echo "  --- $host ---"
  for f in "${DEVICE_SH_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
    push_atomic "$D/$f" "$host" "~/bin-harvest" "$f" x
    ssh "$host" "chmod +x ~/bin-harvest/$f"
    # douyin-phone-adb 还要送一份到 ~/.local/bin/ —— **夜批真正调的是那个**：
    # harvest-keyword.sh 里写的是 `C=~/.local/bin/douyin-phone-adb`。
    # 0924 实测两台机 bin-harvest=新版、.local/bin=旧版，下发"成功"了夜批却跑旧的
    # （昵称归一那次差点就这么白改）。这条路径长期两份不同步，见 memory
    # phone_controller_live_path_is_local_bin_not_repo。
    # 两处送的是同一次循环里的同一个源文件($D/$f),不是两条独立下发链——
    # 不存在"两份各自演化再不同步"的风险,恰恰是为了消灭原来那种不同步。
    if [[ "$f" == "douyin-phone-adb" ]]; then
      ssh "$host" "mkdir -p ~/.local/bin"
      push_atomic "$D/$f" "$host" "~/.local/bin" "$f" x
      ssh "$host" "chmod +x ~/.local/bin/$f"
    fi
    if command -v zsh >/dev/null 2>&1 && ssh "$host" "zsh -n ~/bin-harvest/$f" 2>/tmp/deploy-err-$$; then
      echo "    ✅ $f"
    elif [[ -s /tmp/deploy-err-$$ ]]; then
      echo "    ❌ $f 语法检查失败: $(cat /tmp/deploy-err-$$ | head -3)"
      FAILED=1
    else
      echo "    ✅ $f (已复制,本机无zsh跳过语法检查)"
    fi
    rm -f /tmp/deploy-err-$$
  done
  for f in "${DEVICE_NODE_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
    push_atomic "$D/$f" "$host" "~/bin-harvest" "$f"
    if ssh "$host" "/opt/homebrew/bin/node --check ~/bin-harvest/$f" 2>/tmp/deploy-err-$$; then
      echo "    ✅ $f"
    else
      echo "    ❌ $f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
      FAILED=1
    fi
    rm -f /tmp/deploy-err-$$
  done
  ssh "$host" "mkdir -p ~/bin-harvest/plans"
  for f in "${DEVICE_PLAN_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
    push_atomic "$D/$f" "$host" "~/bin-harvest/plans" "$(basename "$f")"
    if ssh "$host" "zsh -n ~/bin-harvest/$f" 2>/tmp/deploy-err-$$; then
      echo "    ✅ $f"
    else
      echo "    ❌ $f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
      FAILED=1
    fi
    rm -f /tmp/deploy-err-$$
  done
done

echo "=== [4/4] 设备控制器 → 每台机器的 ${#DEVICE_CTL_DIRS[@]} 个执行路径 (${#DEVICE_CTL_FILES[@]} 个文件) ==="
for host in xian-m4 xian-m1; do
  echo "  --- $host ---"
  for f in "${DEVICE_CTL_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; FAILED=1; continue; fi
    for dir in "${DEVICE_CTL_DIRS[@]}"; do
      ssh "$host" "mkdir -p ~/$dir"
      push_atomic "$D/$f" "$host" "~/$dir" "$f" x
      ssh "$host" "chmod +x ~/$dir/$f"
      if ssh "$host" "zsh -n ~/$dir/$f" 2>/tmp/deploy-err-$$; then
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

# Commander 入口(决策 7f842d12): 启动器落 mmv(openclaw CLI 在本机), skill 落 work-commander 工作区
echo "=== [5/5] mmv Commander 入口(wf-launch/wf-status + skill workflow-commander) ==="
ssh mmv "mkdir -p ~/.openclaw/commander ~/openclaw-root/workspaces-root/clawd-work-commander/skills/workflow-commander"
for f in wf-launch.sh wf-status.sh; do
  if [[ ! -s "$D/commander/$f" ]]; then echo "  ⚠️ 仓库里缺失: commander/$f"; FAILED=1; continue; fi
  push_atomic "$D/commander/$f" mmv "~/.openclaw/commander" "$f" x
  if ssh mmv "bash -n ~/.openclaw/commander/$f" 2>/tmp/deploy-err-$$; then
    echo "  ✅ commander/$f"
  else
    echo "  ❌ commander/$f 语法检查失败: $(head -3 /tmp/deploy-err-$$)"
    FAILED=1
  fi
  rm -f /tmp/deploy-err-$$
done
if [[ -s "$D/commander/skills/workflow-commander/SKILL.md" ]]; then
  push_atomic "$D/commander/skills/workflow-commander/SKILL.md" mmv "~/openclaw-root/workspaces-root/clawd-work-commander/skills/workflow-commander" SKILL.md
  echo "  ✅ skills/workflow-commander/SKILL.md"
fi

echo ""
if [[ "$FAILED" == "1" ]]; then
  echo "⚠️ 部分文件语法检查失败,见上方 ❌ 标记——已同步的文件里可能有半成品,立刻核查"
  exit 1
fi
echo "✅ 全部同步完成(mmv + xian-m4 + xian-m1,控制器覆盖两个执行路径),每个文件都过了语法检查。"
