# 触达出单三刀 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 触达发送改为主页链接直达(治字母号搜索不可达)+缺链接单上游闸(待补链)+瞬时失败执行内密集重试(1-2min×10次)。

**Architecture:** 纯函数抽到 CJS lib(next-outreach-lib.js)供选单器与单测共用;douyin-phone-adb 的 private-message-send 加可选第5业务参 PROFILE_URL 走 deeplink 直开主页(强校验闸原样保留);outreach-tick.sh 函数化+mkdir 原子锁+按归因行分类的重试循环。

**Tech Stack:** zsh(macOS crontab)、Node CJS(网关容器)、node --test(.mjs 测试)、CI smoke(bash)。

## Global Constraints
- spec: `docs/superpowers/specs/2026-09-15-outreach-link-direct-retry-design.md`(7项审查修正已并入,任何冲突以 spec 为准)
- 决策 c5e600a4+c5828297;Brain task 0899d39c;GP-Anchor: line02/keyword_acquisition#step4
- **禁止** split("/") 位置切段取 URL(URL 含 "/",parts[2]==="https:")
- **禁止** flock(macOS 无此命令且 set -e 缺失下静默停摆);互斥一律 mkdir 原子锁
- lib 必须 CJS(.js + module.exports),next-outreach.js 用 require("./next-outreach-lib.js")
- douyin-phone-adb 顶部 set -euo pipefail:一切新变量过 local,可选参用 ${5:-}
- 瞬时判定按归因行:failure_class=TARGET_ABSENT 优先终止;禁止整段 OUT 跑正则
- commit 顺序铁律:每 task commit-1=failing test / commit-2=实现(lint-tdd-commit-order 在 CI 卡)
- 话术表/refill-profile-links.sh/restore_ime trap 本体(任务523d64ab)一律不碰

---

### Task 1: next-outreach-lib.js 纯函数 + 单测 + CI 接线

**Files:**
- Create: `services/phone-adb-controller/next-outreach-lib.js`
- Create: `services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs`
- Modify: `.github/workflows/ci-l3-code.yml:229-230`(openclaw-scripts-test job,已在 l3-passed needs 链 283 行,只扩 run)

**Interfaces:**
- Produces: `extractLead(raw)->{nick,dyid,profileUrl}`、`isValidDyid(dyid)->bool`、`classifyPending(raw)->"ok"|"no_link"`、`requeueTransientFields(prevReply,note,now)->fields对象`、`TRANSIENT_MARK="[瞬时败]"`(Task 2 消费)

- [ ] **Step 1: 写 failing test**

`services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import lib from "../next-outreach-lib.js";

const RAW = "沉 / LHJ20001024 / https://www.douyin.com/user/MS4wLjABAAAAtest-_x";
const RAW_SHORT = "板烧鸡腿堡 / P0ten / https://v.douyin.com/AbCd123/";
const RAW_NOLINK = "砚秋 / display:砚秋";
const RAW_PENDING = "你脸红了诶~ / 31225819860 / https://www.douyin.com/user/MS4wq";

test("extractLead: URL 整体正则,不受 split(/) 影响", () => {
  const r = lib.extractLead(RAW);
  assert.equal(r.nick, "沉");
  assert.equal(r.dyid, "LHJ20001024");
  assert.equal(r.profileUrl, "https://www.douyin.com/user/MS4wLjABAAAAtest-_x");
});
test("extractLead: 短链", () => {
  assert.equal(lib.extractLead(RAW_SHORT).profileUrl, "https://v.douyin.com/AbCd123/");
});
test("classifyPending: 带链+合法dyid=ok", () => {
  assert.equal(lib.classifyPending(RAW), "ok");
  assert.equal(lib.classifyPending(RAW_PENDING), "ok");
});
test("classifyPending: 无链=no_link", () => {
  assert.equal(lib.classifyPending(RAW_NOLINK), "no_link");
});
test("classifyPending: 有链但dyid非法=no_link", () => {
  assert.equal(lib.classifyPending("某人 / id待核验 / https://v.douyin.com/x1/"), "no_link");
  assert.equal(lib.classifyPending("某人 / 中文号 / https://v.douyin.com/x1/"), "no_link");
});
test("requeueTransientFields: 首轮回队待触达+标记", () => {
  const f = lib.requeueTransientFields("", "AdbIME cannot be enabled", "0915 12:00(UTC+8)");
  assert.equal(f["状态"], "待触达");
  assert.ok(f["回复结果"].startsWith("[瞬时败]"));
});
test("requeueTransientFields: 二轮转受阻,保留原文", () => {
  const f = lib.requeueTransientFields("[瞬时败][1轮 0915 12:00(UTC+8)]x", "again", "0915 13:00(UTC+8)");
  assert.equal(f["状态"], "触达受阻");
  assert.equal(f["发送状态"], "发送失败");
  assert.ok(f["回复结果"].includes("[瞬时败]"));
  assert.ok(f["回复结果"].includes("2轮转受阻"));
  assert.ok(f["回复结果"].length <= 200);
});
```

- [ ] **Step 2: 跑测试确认 FAIL**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: FAIL(Cannot find module '../next-outreach-lib.js')

- [ ] **Step 3: commit-1(failing test)**

```bash
git add services/phone-adb-controller/__tests__/next-outreach-lib.test.mjs
git commit -m "test(phone-adb): 选单器纯函数失败测试先行(URL整体正则/缺链闸/瞬时两轮状态机)"
```

- [ ] **Step 4: 写实现**

`services/phone-adb-controller/next-outreach-lib.js`:
```js
// next-outreach-lib.js —— 选单器纯函数(CJS)。与 next-outreach.js 同目录同批部署:
// 网关副本 /opt/openclaw/state/ 漏发本文件 = 首个 tick MODULE_NOT_FOUND 全线选单挂。
// 「抖音昵称/主页链接」实况: `昵称 / dyid / https://www.douyin.com/user/MS4w...`
// URL 自身含 "/" —— 取链接必须整体正则,禁止 split("/") 位置切段(parts[2]==="https:")。
"use strict";

const URL_RE = /https?:\/\/\S+/;
const DYID_RE = /^[A-Za-z0-9._]{4,}$/;
const TRANSIENT_MARK = "[瞬时败]";

function extractLead(raw) {
  const s = String(raw || "");
  const parts = s.split("/").map((x) => x.trim());
  const m = s.match(URL_RE);
  return { nick: parts[0] || "", dyid: parts[1] || "", profileUrl: m ? m[0] : "" };
}

function isValidDyid(dyid) {
  return !!dyid && dyid !== "id待核验" && DYID_RE.test(dyid);
}

// 出单资格(决策 c5828297): 主页链接=必备件;dyid 供主页强校验闸,同为必备。
function classifyPending(raw) {
  const { dyid, profileUrl } = extractLead(raw);
  if (!profileUrl.startsWith("https://")) return "no_link";
  if (!isValidDyid(dyid)) return "no_link";
  return "ok";
}

// 瞬时失败两轮状态机(决策 c5828297): 执行内10次用尽=1轮回队;再来一轮仍败=受阻。
function requeueTransientFields(prevReply, note, now) {
  const prev = String(prevReply || "");
  const clip = (s) => s.slice(0, 200);
  if (prev.includes(TRANSIENT_MARK)) {
    return {
      "状态": "触达受阻",
      "发送状态": "发送失败",
      "回复结果": clip(prev + " | [瞬时败2轮转受阻 " + now + "]" + note),
    };
  }
  return {
    "状态": "待触达",
    "回复结果": clip(TRANSIENT_MARK + "[1轮 " + now + "]" + note),
  };
}

module.exports = { extractLead, isValidDyid, classifyPending, requeueTransientFields, TRANSIENT_MARK, URL_RE };
```

- [ ] **Step 5: 跑测试确认 PASS**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 全 pass

- [ ] **Step 6: CI 接线**

`.github/workflows/ci-l3-code.yml` 229-230 行改为(job 名/结构不动,只扩 run,并同步改 name):
```yaml
      - name: node --test scripts/openclaw + services/phone-adb-controller
        run: node --test scripts/openclaw/**/*.test.js services/phone-adb-controller/__tests__/*.test.mjs
```

- [ ] **Step 7: commit-2(实现+接线)**

```bash
git add services/phone-adb-controller/next-outreach-lib.js .github/workflows/ci-l3-code.yml
git commit -m "feat(phone-adb): 选单器纯函数库(URL整体正则/缺链闸/瞬时两轮状态机)+CI单测接线"
```

---

### Task 2: next-outreach.js 接 lib——profile_url 出单 + 缺链闸 + requeue_transient

**Files:**
- Modify: `services/phone-adb-controller/next-outreach.js`(全文 77 行,改后约 110 行)
- Test: 复用 Task 1 单测(状态机已覆盖);本 task 的接线由 Task 5 smoke `node --check` + 签名断言卡

**Interfaces:**
- Consumes: Task 1 全部导出
- Produces: next 模式 JSON 增 `profile_url` 字段;done 模式新增 `requeue_transient` 结果值;stderr 统计行 `gated_no_link=N`(Task 4 消费 profile_url;Manager 日报消费 stderr)

- [ ] **Step 1: 顶部引 lib**

`const fs = require("fs");` 之后加:
```js
const lib = require("./next-outreach-lib.js");
```

- [ ] **Step 2: done 分支加 requeue_transient**

现 33-38 行的 fields 三元结构改为 if/else(sent/requeue 语义原样,原「0915: 失败单转触达受阻…」注释保留在 else 臂上方):
```js
    let fields;
    if (result === "sent") {
      fields = { "状态": "已触达", "发送状态": "已发送", "触达时间": now };
    } else if (result === "requeue") {
      fields = { "状态": "待触达" };  // 环境性失败(锁忙/设备离线): 回队列,不算受阻
    } else if (result === "requeue_transient") {
      // 瞬时失败(IME/前台波动)执行内10次用尽: 1轮回队/2轮受阻(决策 c5828297)
      const cur = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${rid}`, { headers: H })).json();
      const prev = txt(cur?.data?.record?.fields?.["回复结果"]);
      fields = lib.requeueTransientFields(prev, note, now);
    } else {
      fields = { "状态": "触达受阻", "发送状态": "发送失败", "回复结果": ("[受阻]" + note).slice(0, 200) };
    }
```

- [ ] **Step 3: pending 过滤改双桶 + 缺链闸**

现 48-54 行(`const pending = leads.filter(...)`)整段替换:
```js
  const pending = [], noLink = [];
  for (const r of leads) {
    if (txt(r.fields["状态"]) !== "待触达") continue;
    const raw = txt(r.fields["抖音昵称/主页链接"]);
    (lib.classifyPending(raw) === "ok" ? pending : noLink).push(r);
  }
  // 缺链接上游闸(决策 c5828297): 链接=出单必备件,缺件单标「待补链」交回采集补链,
  // 不再送搜索路线撞墙。写新 select 值失败(字段选项受限)降级只写备注,不阻塞选单。
  let gated = 0;
  for (const r of noLink) {
    gated++;
    const reply = txt(r.fields["回复结果"]);
    if (reply.includes("[待补链]")) continue; // 降级标记过的行不重写
    const mark = { "回复结果": ("[待补链]" + reply).slice(0, 200) };
    const res = await (await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${r.record_id}`, { method: "PUT", headers: H, body: JSON.stringify({ fields: { "状态": "待补链", ...mark } }) })).json();
    if (res.code !== 0) {
      await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${B}/tables/${LEADS}/records/${r.record_id}`, { method: "PUT", headers: H, body: JSON.stringify({ fields: mark }) });
    }
  }
  if (gated) console.error("gated_no_link=" + gated);
```

- [ ] **Step 4: pick 输出加 profile_url**

parts/nick/dyid 处改为:
```js
  const lead = lib.extractLead(txt(pick.fields["抖音昵称/主页链接"]));
  const nick = lead.nick, dyid = lead.dyid;
```
末尾 console.log 的 JSON 对象加字段: `profile_url: lead.profileUrl,`

- [ ] **Step 5: 语法验证**

Run: `node --check services/phone-adb-controller/next-outreach.js && node --test services/phone-adb-controller/__tests__/*.test.mjs`
Expected: 无输出 + 全 pass

- [ ] **Step 6: commit**

```bash
git add services/phone-adb-controller/next-outreach.js
git commit -m "feat(phone-adb): 选单器接lib——profile_url出单+缺链单标待补链+requeue_transient两轮状态机"
```
(本 task 无独立新测试文件——状态机测试在 Task 1 commit-1 已先行,满足 TDD 顺序。)

---

### Task 3: douyin-phone-adb 链接直达路线

**Files:**
- Modify: `services/phone-adb-controller/douyin-phone-adb`(dispatch 约2106-2110行;send_private_message 函数头约1204行与导航段约1229-1287行)
- Modify: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(层2签名,commit-1)

**Interfaces:**
- Consumes: 无(自包含)
- Produces: `private-message-send SENDER TARGET_ID MSG_B64 EVIDENCE_ID [PROFILE_URL]` 第5业务参;die 文案 `profile url shape not allowed` 与 `link route:` 前缀(Task 4/5 消费)

- [ ] **Step 1: commit-1(failing smoke 断言先行)**

`.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh` 层2 的 for pat in 列表追加三个签名(代码未实现,smoke 必红=proven-to-fire):
```bash
for pat in 'clip_guard_check' 'clip_guard_record' 'foreground_gate' 'FG_DISMISS_LABELS' 'lock-refresh)' 'failure_class=' 'ensure_feed' 'locate_cached utab' 'profile url shape not allowed' 'link route:' '"$#" == 5 || "$#" == 6' ; do
```
Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: FAIL `融合刀签名缺失: profile url shape not allowed`
```bash
git add .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
git commit -m "test(phone-adb): 链接直达路线smoke签名先行(必红=proven-to-fire)"
```

- [ ] **Step 2: dispatch 扩第5业务参**

2106-2110 行改为:
```zsh
  private-message-send)
    [[ "$#" == 5 || "$#" == 6 ]] || die "usage: douyin-phone-adb --profile PROFILE private-message-send SENDER_DOUYIN_ID TARGET_DOUYIN_ID MESSAGE_B64 EVIDENCE_ID [PROFILE_URL]"
    check_target
    send_private_message "$2" "$3" "$4" "$5" "${6:-}"
    ;;
```

- [ ] **Step 3: send_private_message 函数改造**

函数头(约1204-1215行): local 声明行加 `profile_url`,赋参段(`evidence_id="$4"` 之后)加:
```zsh
  profile_url="${5:-}"
```
导航段: 把从 `"$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "snssdk1128://search/tabs?keyword=$target_douyin_id"`(约1229行)起、到 `(( _tp_found )) || die ...` 与 `profile_xml="$EVIDENCE_ROOT/${evidence_id}-target-profile-c${_card}.xml"`(约1286-1287行)止的整段搜索导航包进 else 臂,前面加链接臂:
```zsh
  if [[ -n "$profile_url" ]]; then
    # 0915 链接直达路线(决策 c5e600a4/c5828297): 有主页直链禁走搜索——字母号搜索
    # 不可达实证(LHJ20001024/P0ten, 0915 三单撞墙)。链接打不开/校验不过=受阻类,
    # 不做搜索兜底(搜索正是被否掉的路线)。
    [[ "$profile_url" == https://(v|www).douyin.com/[A-Za-z0-9._/-]## ]] || die "profile url shape not allowed"
    "$ADB" -s "$SERIAL" shell am start -a android.intent.action.VIEW -d "$profile_url" com.ss.android.ugc.aweme >/dev/null
    # 落页节奏沿用先探后睡: 每 3.5s 一拍,3 轮预算,读到「抖音号：」即走
    profile_xml="$EVIDENCE_ROOT/${evidence_id}-target-profile-link.xml"
    target_id_line=""
    local _lp
    for _lp in 1 2 3; do
      wait_ms 3500
      if _ui_evidence_wave "${evidence_id}-target-profile-link" >/dev/null 2>&1; then
        target_id_line="$(/usr/bin/grep -oE '<node[^>]+text="抖音号：[^"]+"[^>]*>' "$profile_xml" | /usr/bin/head -1 || true)"
        [[ -n "$target_id_line" ]] && break
      fi
    done
    [[ -n "$target_id_line" ]] || die "link route: profile identity was not readable after deeplink" TARGET_ABSENT
    observed_target_id="$(print -- "$target_id_line" | /usr/bin/sed -E 's/.* text="抖音号：([^"]*)" resource-id=.*/\1/')"
    # 强校验闸原样: 认错人绝不发
    [[ "$observed_target_id" == "$target_douyin_id" ]] || die "link route: profile id ${observed_target_id} does not match claimed ${target_douyin_id}" TARGET_ABSENT
  else
    <原搜索导航段原样,含 _tp_found 三卡循环与末尾 profile_xml=...-c${_card}.xml>
  fi
```
注意: 链接臂自行赋 `profile_xml`,不触碰 `_card`(set -u 安全);`observed_target_id` 已在函数 local 列表;`_lp` 补进 local。

- [ ] **Step 4: 语法+smoke 转绿**

Run: `zsh -n services/phone-adb-controller/douyin-phone-adb && bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: 语法过,smoke 全绿

- [ ] **Step 5: commit-2**

```bash
git add services/phone-adb-controller/douyin-phone-adb
git commit -m "feat(phone-adb): private-message-send 链接直达路线(deeplink直开主页+URL白名单闸+强校验原样,无搜索兜底)"
```

---

### Task 4: outreach-tick.sh——mkdir 锁 + 归因分类 + 密集重试

**Files:**
- Modify: `services/phone-adb-controller/outreach-tick.sh`(全文重排:函数区+source 守卫+主体)
- Modify: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(层4功能断言,commit-1)

**Interfaces:**
- Consumes: Task 2 的 profile_url 字段与 requeue_transient;Task 3 的第5业务参
- Produces: `classify_failure "$OUT"` -> terminal|transient|other(可 source 测试);锁目录 `/tmp/outreach-tick.lock`

- [ ] **Step 1: commit-1(failing 功能断言先行)**

`phone-adb-controller-smoke.sh` 末尾追加层4(zsh 可用才跑,与层1同款降级):
```bash
# 层4: outreach-tick 归因分类功能断言(source 守卫模式,决策 c5828297)
if command -v zsh >/dev/null 2>&1; then
  CF() { zsh -c "OUTREACH_TICK_SOURCED=1 source '$D/outreach-tick.sh'; classify_failure \"\$1\"" _ "$1"; }
  [[ "$(CF 'blah
failure_class=TARGET_ABSENT')" == "terminal" ]] || fail "classify: TARGET_ABSENT 应 terminal"
  [[ "$(CF 'Unknown input method com.android.adbkeyboard/.AdbIME cannot be enabled for user #0')" == "transient" ]] || fail "classify: AdbIME 应 transient"
  [[ "$(CF 'restore_ime: original_ime: parameter not set')" == "transient" ]] || fail "classify: restore_ime 应 transient"
  [[ "$(CF 'warning: foreground gate: douyin not foreground (round 1)
no card matched
failure_class=TARGET_ABSENT')" == "terminal" ]] || fail "classify: warning:foreground 不得污染 TARGET_ABSENT 判终止"
  [[ "$(CF 'some other die message')" == "other" ]] || fail "classify: 未知失败应 other"
else
  echo "::warning::zsh 不可用,层4 归因断言跳过(部署侧会跑)"
fi
grep -qF 'requeue_transient' "$D/outreach-tick.sh" || fail "tick 未接 requeue_transient"
grep -qF 'outreach-tick.lock' "$D/outreach-tick.sh" || fail "tick 未接 mkdir 互斥锁"
grep -qF 'profile_url' "$D/next-outreach.js" || fail "选单器未出 profile_url"
```
Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: FAIL(classify_failure 不存在)
```bash
git add .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
git commit -m "test(phone-adb): tick归因分类/互斥锁/重试smoke断言先行(必红)"
```

- [ ] **Step 2: 重写 outreach-tick.sh**

全文替换为(原拟人纪律/时窗/取单/风控账注释全部保留,新增段已标注):
```zsh
#!/bin/zsh
# outreach-tick.sh —— 触达心跳(M4 crontab 每30分钟, 08:00-22:00 主理人拍板窗口)
# 拟人纪律: ①30%概率本tick安静跳过(发送时刻不规律) ②tick内随机延迟0-8分钟(不卡半点)
#          ③发送前3-8秒停留(private-message-send内部已有主页浏览过程) ④两号轮流分摊
# 风控账: 28 tick/天 × 70% ≈ 19发/天, 两号各~10, 间隔≥30min —— 远低于0821决策20/时上限
# 0915 三刀(决策 c5e600a4/c5828297): 链接直达出单 + 瞬时失败执行内密集重试(1-2min×10) + mkdir互斥锁
set -uo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
LOG=~/outreach.log
log(){ print -- "[$(date +%m%d-%H:%M:%S)] $*" >> $LOG }

# ── 归因分类(决策 c5828297): 按归因行不按整段——warning: foreground 等非致命行禁止污染判定 ──
classify_failure() {
  local out="$1" last_fc tail5
  last_fc=$(print -- "$out" | grep -oE 'failure_class=[A-Z_]+' | tail -1 | cut -d= -f2)
  if [[ "$last_fc" == "TARGET_ABSENT" ]]; then print terminal; return; fi
  tail5=$(print -- "$out" | tail -5)
  if print -- "$tail5" | grep -qiE 'AdbIME|input method|_ime'; then print transient; return; fi
  print other
}

# source 守卫: smoke 层4 以 OUTREACH_TICK_SOURCED=1 source 本文件只取函数,不执行主体
[[ -n "${OUTREACH_TICK_SOURCED:-}" ]] && return 0

# 时窗守卫(冗余保险, crontab 已限时)
H=$(date +%H)
(( H >= 8 && H < 22 )) || { log "时窗外,跳过"; exit 0 }

# 拟人①: 30% 概率安静跳过
(( RANDOM % 10 < 3 )) && { log "拟人跳过本tick"; exit 0 }

# ── tick 互斥(mkdir 原子锁,家法同 douyin-phone-adb lock-acquire): 重试拉长运行时长后防重入 ──
TICK_LOCK=/tmp/outreach-tick.lock
if ! /bin/mkdir "$TICK_LOCK" 2>/dev/null; then
  # stale 回收: 目录 mtime 超 35 分钟视为上轮尸锁
  if [[ -n "$(find "$TICK_LOCK" -maxdepth 0 -mmin +35 2>/dev/null)" ]]; then
    /bin/rmdir "$TICK_LOCK" 2>/dev/null
    /bin/mkdir "$TICK_LOCK" 2>/dev/null || { log "锁竞争,跳过"; exit 0 }
    log "回收尸锁后继续"
  else
    log "上轮tick在跑,跳过"; exit 0
  fi
fi
trap '/bin/rmdir "$TICK_LOCK" 2>/dev/null' EXIT INT TERM

# 拟人②: 随机延迟 0-480 秒
DELAY=$(( RANDOM % 480 ))
log "本tick延迟 ${DELAY}s 后执行"
/bin/sleep $DELAY

# 取单(网关选单器: 重复高亮优先→A级→B级, 预写触达中防重)
ORDER=$(ssh -o ConnectTimeout=15 us-vps 'docker exec openclaw-gateway node /root/.openclaw/next-outreach.js next' 2>>$LOG)
[[ "$ORDER" == "NO_PENDING" || -z "$ORDER" ]] && { log "无待触达单"; exit 0 }
[[ "$ORDER" == NO_SCRIPT* ]] && { log "话术缺失: $ORDER"; exit 1 }

RID=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['rid'])")
DYID=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['dyid'])")
MSGB64=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['msg_b64'])")
PROFILE=$(print -- "$ORDER" | python3 -c "import json,sys;print(json.load(sys.stdin)['profile'])")
SENDER=$(print -- "$ORDER"  | python3 -c "import json,sys;print(json.load(sys.stdin)['sender_id'])")
SEQ=$(print -- "$ORDER"     | python3 -c "import json,sys;print(json.load(sys.stdin)['seq'])")
NICK=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin)['nick'])")
PURL=$(print -- "$ORDER"    | python3 -c "import json,sys;print(json.load(sys.stdin).get('profile_url',''))")
log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE] ${PURL:+link}"

C=~/.local/bin/douyin-phone-adb
mark(){ ssh -o ConnectTimeout=15 us-vps "docker exec openclaw-gateway node /root/.openclaw/next-outreach.js done $1 $2 $(print -n -- "$3" | /usr/bin/base64)" >>$LOG 2>&1 }

# ── 发送尝试循环(决策 c5828297): 瞬时失败就地重试,间隔60-120s,上限10次,总时长护栏22分钟 ──
MAX_ATTEMPTS=10
LOOP_START=$SECONDS
ATTEMPT=1
while true; do
  TAG="outreach-$(date +%m%d%H%M)-a${ATTEMPT}"
  if ! $C --profile "$PROFILE" lock-acquire "$TAG" >>$LOG 2>&1; then
    log "锁被占(采收在用),回队列待下轮"; mark "$RID" requeue "lock busy"; exit 0
  fi
  # 拟人③: 发送前 3-8 秒停顿
  /bin/sleep $(( 3 + RANDOM % 6 ))
  OUT=$($C --profile "$PROFILE" private-message-send "$SENDER" "$DYID" "$MSGB64" "$TAG" ${PURL:+"$PURL"} </dev/null 2>&1)
  RC=$?
  print -- "$OUT" | grep -vE "file pulled" | tail -4 >> $LOG
  $C --profile "$PROFILE" lock-release "$TAG" >>$LOG 2>&1 || true

  if print -- "$OUT" | grep -q "send_status=sent"; then
    mark "$RID" sent "ok"
    log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"
    exit 0
  fi

  CLS=$(classify_failure "$OUT")
  REASON=$(print -- "$OUT" | grep -E "failure_class=|die|not" | tail -1 | head -c 150)
  if [[ "$CLS" != "transient" ]]; then
    mark "$RID" failed "${REASON:-rc=$RC}"
    log "❌ 单#$SEQ 失败($CLS): ${REASON:-rc=$RC}"
    exit 0
  fi
  if (( ATTEMPT >= MAX_ATTEMPTS )) || (( SECONDS - LOOP_START > 1320 )); then
    mark "$RID" requeue_transient "${REASON:-rc=$RC} (attempts=$ATTEMPT)"
    log "🔁 单#$SEQ 瞬时失败${ATTEMPT}次用尽,回队列: ${REASON:-rc=$RC}"
    exit 0
  fi
  BACKOFF=$(( 60 + RANDOM % 61 ))
  log "⏳ 单#$SEQ 瞬时失败(第${ATTEMPT}次): ${REASON:-rc=$RC},${BACKOFF}s 后重试"
  /bin/sleep $BACKOFF
  ATTEMPT=$(( ATTEMPT + 1 ))
done
```

- [ ] **Step 3: 语法+smoke 转绿**

Run: `zsh -n services/phone-adb-controller/outreach-tick.sh && bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: 全绿(层4 五条断言过)

- [ ] **Step 4: commit-2**

```bash
git add services/phone-adb-controller/outreach-tick.sh
git commit -m "feat(phone-adb): tick密集重试(瞬时1-2min×10)+mkdir互斥锁+归因行分类+链接传参"
```

---

### Task 5: smoke 收口(层0/层1 覆盖补齐)+ 全量回归

**Files:**
- Modify: `.github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`(层0/层1 补新文件)

- [ ] **Step 1: 层0 五件套扩为八件套,层1 语法闸补齐**

层0 for 列表加 `next-outreach.js next-outreach-lib.js outreach-tick.sh`;层1 zsh 段加 `zsh -n "$D/outreach-tick.sh" || fail "outreach-tick zsh 语法错误"`;node 段加:
```bash
node --check "$D/next-outreach.js" || fail "next-outreach.js 语法错误"
node --check "$D/next-outreach-lib.js" || fail "next-outreach-lib.js 语法错误"
```

- [ ] **Step 2: 全量回归**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh && node --test services/phone-adb-controller/__tests__/*.test.mjs && zsh -n services/phone-adb-controller/douyin-phone-adb`
Expected: 全绿

- [ ] **Step 3: commit**

```bash
git add .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh
git commit -m "test(phone-adb): smoke层0/层1覆盖补齐(八件套+tick/选单器语法闸)"
```

---

## 合并后部署与真机 E2E(主 session 执行,不属 subagent 任务)
1. 副本同步(逐项): M4/M1 `~/.local/bin/douyin-phone-adb` + `~/bin-harvest/outreach-tick.sh`;网关 `/opt/openclaw/state/next-outreach.js` **+ next-outreach-lib.js(同批!)**;clawd-media skills 副本
2. 真机 E2E: ①字母号单(P0ten/LHJ20001024)链接路线送达(sent+气泡回读+三件套) ②`adb shell ime disable` 注入一次性 IME 故障→就地重试成功不进受阻 ③无链接单被闸,表上出现待补链
3. 受阻单复活: 字母号单回待触达(走链接);报主理人验收后由主理人开话术表闸
