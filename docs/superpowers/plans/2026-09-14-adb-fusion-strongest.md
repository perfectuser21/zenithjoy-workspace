# ADB 控制器融合升级(最强版)回流 git 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已在手术台完成并验证的六刀融合版 ADB 控制器五件套收进 repo `services/phone-adb-controller/`,配 proven-to-fire smoke 守卫并纳入 Smoke Glob Gate 基线。

**Architecture:** 纯文件回流 + 三层静态守卫(语法闸/函数存在性/烂死模式检测)。TDD 两段式:commit-1 先落 smoke 脚本与基线行(此时被守卫的文件不存在,smoke 必红),commit-2 放入五件套让 smoke 转绿。

**Tech Stack:** zsh(控制器/采收), Node.js(写表器), bash(smoke), GitHub Actions Smoke Glob Gate。

## Global Constraints

- 源文件在手术台(绝对路径): `/private/tmp/claude-501/-Users-administrator-worktrees-zenithjoy-session-89781119/5a45b786-ee32-4fb5-85f0-22058e240f1b/scratchpad/adb-fusion/`
- CI runner 是 ubuntu-latest,无 zsh:smoke 里 zsh 语法闸必须 `command -v zsh` 降级(缺 zsh 打 ::warning:: 不判红);grep 断言与 node --check 必须硬闸
- 新 smoke 脚本必须同 PR 加进 `.github/workflows/scripts/smoke/smoke-baseline.txt`(baseline-lint 强制)
- worktree: `/Users/administrator/perfect21/zenithjoy/.claude/worktrees/cp-09141213-adb-fusion-strongest`,分支 cp-09141213-adb-fusion-strongest
- commit message 尾部带 Co-Authored-By: Claude Fable 5 <noreply@anthropic.com> 与 Claude-Session: https://claude.ai/code/session_011aZnkpTpaTkvftBj8iwAVz

---

### Task 1: smoke 守卫先行(failing test, commit-1)

**Files:**
- Create: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
- Modify: `.github/workflows/scripts/smoke/smoke-baseline.txt`(追加一行 `phone-adb-controller-smoke.sh`,按文件内既有排序规则插入)

**Interfaces:**
- Produces: smoke 脚本以 `services/phone-adb-controller/` 下五文件为守卫对象;Task 2 落文件后它必须转绿

- [ ] **Step 1: 写 smoke 脚本(此时守卫对象不存在 → 必红)**

```bash
cat > .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh << 'EOF'
#!/usr/bin/env bash
# phone-adb-controller-smoke.sh — ADB 控制器五件套守卫(0914 融合刀 F1 回流)
# 三层: 1) 语法闸(zsh 可用才跑,CI ubuntu 无 zsh 降级 warning) 2) 融合刀函数存在性 3) 烂死模式检测
set -euo pipefail
D="services/phone-adb-controller"
C="$D/douyin-phone-adb"
fail() { echo "::error::phone-adb-controller-smoke: $1"; exit 1; }

# 层0: 五件套存在
for f in douyin-phone-adb harvest-keyword.sh refill-profile-links.sh push-leads.js update-profile-links.js; do
  [[ -s "$D/$f" ]] || fail "$f 缺失或为空"
done

# 层1: 语法闸
if command -v zsh >/dev/null 2>&1; then
  zsh -n "$C" || fail "控制器 zsh 语法错误"
  zsh -n "$D/harvest-keyword.sh" || fail "harvest zsh 语法错误"
  zsh -n "$D/refill-profile-links.sh" || fail "refill zsh 语法错误"
else
  echo "::warning::zsh 不可用,语法闸跳过(部署侧会跑)"
fi
node --check "$D/push-leads.js" || fail "push-leads.js 语法错误"
node --check "$D/update-profile-links.js" || fail "update-profile-links.js 语法错误"

# 层2: 融合刀函数/命令存在性(六刀签名)
for pat in 'clip_guard_check' 'clip_guard_record' 'foreground_gate' 'FG_DISMISS_LABELS' 'lock-refresh)' 'failure_class=' ; do
  grep -qF "$pat" "$C" || fail "融合刀签名缺失: $pat"
done
# harvest 必须接了心跳与作品地址
grep -qF 'lock-refresh' "$D/harvest-keyword.sh" || fail "harvest 未接 lock-refresh 心跳"
grep -qF 'current-video-link' "$D/harvest-keyword.sh" || fail "harvest 未接原爆款作品地址"
# push-leads 必须吃 11/12 列
grep -qF 'purl' "$D/push-leads.js" || fail "push-leads 未接主页直链列"

# 层3: 烂死模式检测(0914 实证的静默腐烂形态,proven-to-fire)
# 3a: 变量被提前展开成空串的尸块('"" -s ""' 形态)
if grep -qF '"" -s ""' "$C"; then fail '检测到变量展开尸块("" -s ""),某次补丁把变量毁成空串'; fi
# 3b: 死函数复活(ui_evidence_retry 已删,再出现=有人从旧版本抄回来了)
if grep -qE '^ui_evidence_retry\(\)' "$C"; then fail "死函数 ui_evidence_retry 复活(0914 已删除,禁止回抄)"; fi

echo "phone-adb-controller-smoke: PASS"
EOF
chmod +x .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
```

- [ ] **Step 2: 运行确认 FAIL**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: exit 1,`::error::phone-adb-controller-smoke: douyin-phone-adb 缺失或为空`

- [ ] **Step 3: 基线行追加**

在 `.github/workflows/scripts/smoke/smoke-baseline.txt` 按字母序插入一行:
```
phone-adb-controller-smoke.sh
```

- [ ] **Step 4: Commit(commit-1)**

```bash
git add .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh .github/workflows/scripts/smoke/smoke-baseline.txt
git commit -m "test: phone-adb-controller 五件套 smoke 守卫(failing,commit-1)"
```

---

### Task 2: 五件套落库(smoke 转绿, commit-2)

**Files:**
- Create: `services/phone-adb-controller/douyin-phone-adb`(源: 手术台 `controller.zsh`)
- Create: `services/phone-adb-controller/harvest-keyword.sh`(源: 手术台同名)
- Create: `services/phone-adb-controller/refill-profile-links.sh`(源: xian-m4 `~/bin-harvest/refill-profile-links.sh`,手术台无副本则 scp 拉取)
- Create: `services/phone-adb-controller/push-leads.js`(源: 手术台同名,已含 purl/vurl 列)
- Create: `services/phone-adb-controller/update-profile-links.js`(源: 手术台同名)
- Create: `services/phone-adb-controller/README.md`

**Interfaces:**
- Consumes: Task 1 的 smoke 脚本
- Produces: repo 内规范位置的五件套,部署 = scp 到 M4/M1 `~/.local/bin/` 与 `~/bin-harvest/`,网关 docker cp

- [ ] **Step 1: 拷贝五件套**

```bash
SURG=/private/tmp/claude-501/-Users-administrator-worktrees-zenithjoy-session-89781119/5a45b786-ee32-4fb5-85f0-22058e240f1b/scratchpad/adb-fusion
mkdir -p services/phone-adb-controller
cp "$SURG/controller.zsh" services/phone-adb-controller/douyin-phone-adb
cp "$SURG/harvest-keyword.sh" services/phone-adb-controller/
cp "$SURG/push-leads.js" services/phone-adb-controller/
cp "$SURG/update-profile-links.js" services/phone-adb-controller/
scp xian-m4:bin-harvest/refill-profile-links.sh services/phone-adb-controller/
chmod +x services/phone-adb-controller/douyin-phone-adb services/phone-adb-controller/*.sh
```

- [ ] **Step 2: 写 README**

内容必须包含:五件套用途一句话各一行;命令总表(preflight/lock-*/open-*/search-*/collect-comments/commenter-*/current-video-link/private-message-send/record-*);部署三步(M4/M1 scp 路径、网关 docker cp);触达安全声明(outreach_policy.enabled=false,发送需主理人批话术/频控);六刀融合来历(抄 Kotlin NodeAwait/DouyinCollectService 教义,0914)。

- [ ] **Step 3: 运行 smoke 确认 PASS**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: `phone-adb-controller-smoke: PASS`(本机有 zsh,语法闸全跑)

- [ ] **Step 4: 烂死守卫 proven-to-fire 验证(临时弄坏亲眼看红,不 commit)**

```bash
printf '%s\n' 'x() { "" -s "" shell input tap "" "" }' >> services/phone-adb-controller/douyin-phone-adb
bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh && echo "守卫失灵!" || echo "守卫报红确认"
git checkout -- services/phone-adb-controller/douyin-phone-adb 2>/dev/null || git restore services/phone-adb-controller/douyin-phone-adb
```
Expected: `守卫报红确认`(注意此时文件尚未 commit,restore 会失败——改用重新 cp 源文件恢复)

- [ ] **Step 5: Commit(commit-2)**

```bash
git add services/phone-adb-controller/
git commit -m "feat(line02): ADB控制器六刀融合版回流git——最强版采收链五件套"
```
