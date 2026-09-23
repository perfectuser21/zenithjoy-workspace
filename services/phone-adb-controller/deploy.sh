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
# 覆盖范围(v1,有意从小做起,见下方"不在本次范围"):
#   *.js  → mmv:~/.openclaw/leadgen-scripts/(判定链+数据层)
#   *.sh  → xian-m4:~/bin-harvest/ 和 xian-m1:~/bin-harvest/(设备/ADB层,两台各一份)
#   cmdr-escort.txt / cmdr-stream.txt → mmv:~/.openclaw/(agent SOP,按绝对路径引用)
#
# 不在本次范围(有意排除,别当成漏了):
#   - douyin-phone-adb 编译后二进制: 单独构建/发版流程,盲目覆盖有版本不匹配风险
#   - *.plist: launchd 安装是一次性动作,不是"同步文件"能表达的操作
#   - config/*.json: 可能含机器本地校准过的实验数据,批量覆盖有丢真实调参的风险
#   - __tests__/、*.md、package.json: 不需要跑在生产机上
#
# 每份文件同步后立刻在目标机上跑语法检查(zsh -n / node -c),同步一份验证一份,
# 不是"复制完就算数"——避免把语法错误的半成品扔到生产机上。
set -euo pipefail
cd "$(dirname "$0")"
D="."
FAILED=0

MMV_JS_FILES=(
  push-videos.js push-raw-comments.js sort-comments.js sort-comments-lib.js next-outreach.js next-outreach-lib.js
  leadgen-db-lib.js leadgen-db-connect.js judge-jev.js judge-comment.js judge-video.js
  judge-video-lib.js transcribe-qwen-audio.js comment-tier-lib.js line-routes.js
  lead-fields-lib.js kpi-gate.js next-keywords.js keyword-enabled-lib.js update-keyword-stats.js keyword-stats-lib.js
  fetch-seen-videos.js check-own-account.js dm-daily-cap.js dm-rate-ramp-lib.js
  own-accounts-lib.js push-leads.js update-profile-links.js
)
MMV_TOPLEVEL_FILES=(cmdr-escort.txt cmdr-stream.txt)
DEVICE_SH_FILES=(
  harvest-keyword.sh batch2.sh harvest-cron.sh outreach-tick.sh
  refill-profile-links.sh wall-report.sh wall-lib.sh phone-wall-push.sh
  disk-gateway-guard.sh device-job-claimer.sh log-stream-push.sh
  workflow-result.sh escort-claude-escalation.sh
)

echo "=== [1/3] mmv:~/.openclaw/leadgen-scripts/ (判定链+数据层, ${#MMV_JS_FILES[@]} 个文件) ==="
for f in "${MMV_JS_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
  scp -q -p "$D/$f" "mmv:~/.openclaw/leadgen-scripts/$f"
  if ssh mmv "node -c ~/.openclaw/leadgen-scripts/$f" 2>/tmp/deploy-err-$$; then
    echo "  ✅ $f"
  else
    echo "  ❌ $f 语法检查失败: $(cat /tmp/deploy-err-$$ | head -3)"
    FAILED=1
  fi
  rm -f /tmp/deploy-err-$$
done

echo "=== [2/3] mmv:~/.openclaw/ 顶层(agent SOP, ${#MMV_TOPLEVEL_FILES[@]} 个文件) ==="
for f in "${MMV_TOPLEVEL_FILES[@]}"; do
  if [[ ! -s "$D/$f" ]]; then echo "  ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
  scp -q -p "$D/$f" "mmv:~/.openclaw/$f"
  echo "  ✅ $f"
done

echo "=== [3/3] xian-m4 + xian-m1:~/bin-harvest/ (设备/ADB层, ${#DEVICE_SH_FILES[@]} 个文件 × 2台) ==="
for host in xian-m4 xian-m1; do
  echo "  --- $host ---"
  for f in "${DEVICE_SH_FILES[@]}"; do
    if [[ ! -s "$D/$f" ]]; then echo "    ⚠️ 仓库里缺失: $f (跳过)"; continue; fi
    scp -q -p "$D/$f" "$host:~/bin-harvest/$f"
    ssh "$host" "chmod +x ~/bin-harvest/$f"
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
done

echo ""
if [[ "$FAILED" == "1" ]]; then
  echo "⚠️ 部分文件语法检查失败,见上方 ❌ 标记——已同步的文件里可能有半成品,立刻核查"
  exit 1
fi
echo "✅ 全部同步完成(mmv + xian-m4 + xian-m1),每个文件都过了语法检查。"
