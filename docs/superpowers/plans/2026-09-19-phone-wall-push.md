# 机房手机可视化（adb 推帧器 + 获客链步骤上报）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Dashboard「工作机」页显示 OpenClaw 用 adb 驱动的四台机房手机的实时画面与任务步骤流，不改 APK、不改 apps/api、不做远程控制。

**Architecture:** Mac mini 侧两个 bash 3.2 兼容脚本：`phone-wall-push.sh`（launchd 常驻，`adb screencap` → JPEG → `POST /api/workers/<uuid>/frame`，用 `POST /api/agent/register` 注册兼心跳）和 `wall-report.sh`（zsh 获客链在每个阶段调用，把任务/步骤/失败三件套报到 `/api/workers` 执行器面）。共用函数在 `wall-lib.sh`。已有 zsh 链只加 `wr ...` 旁路行。

**Tech Stack:** bash 3.2、curl、python3（仅 JSON 编解码）、adb、macOS sips（可注入替代）、node --test（假 adb + 假中台）。

规格：`docs/superpowers/specs/2026-09-19-phone-wall-push-design.md`。所有命令在工作树 `/Users/administrator/worktrees/zenithjoy/cp-09192218-phone-wall-push` 执行。**每次 Bash 前先 `cd` 进去（shell cwd 每次会重置）。**

---

## 文件结构

| 文件 | 职责 |
|---|---|
| `services/phone-adb-controller/wall-lib.sh` | 共用：配置加载、日志、profile→serial、serial→uuid 缓存、register、抓屏压缩、前台包名 |
| `services/phone-adb-controller/phone-wall-push.sh` | 常驻推帧器主循环 + 每台手机后台子进程 |
| `services/phone-adb-controller/wall-report.sh` | 上报薄壳 `start/step/note/done/fail` |
| `services/phone-adb-controller/com.zenithjoy.phonewallpush.plist` | launchd |
| `services/phone-adb-controller/__tests__/wall-helpers.mjs` | 测试共用：假 adb、假中台、tiny JPEG |
| `services/phone-adb-controller/__tests__/phone-wall-push.test.mjs` | 推帧器单测 |
| `services/phone-adb-controller/__tests__/wall-report.test.mjs` | 上报器单测 |
| `services/phone-adb-controller/__tests__/wall-smoke-harness.mjs` | smoke 用的一轮跑法（复用 helpers） |
| `.github/workflows/scripts/smoke/phone-wall-push-smoke.sh` + `smoke-baseline.txt` | 守卫 |
| `harvest-cron.sh` / `batch2.sh` / `harvest-keyword.sh` / `outreach-tick.sh` | 只加 `wr` 行 |
| `services/phone-adb-controller/README.md` | 补「可视化两件」与部署 |

---

### Task 1: 测试助手 + wall-lib.sh

**Files:**
- Create: `services/phone-adb-controller/__tests__/wall-helpers.mjs`
- Create: `services/phone-adb-controller/wall-lib.sh`
- Test: `services/phone-adb-controller/__tests__/wall-lib.test.mjs`

- [ ] **Step 1: 写测试助手**

```js
// services/phone-adb-controller/__tests__/wall-helpers.mjs
// 假 adb + 假中台 + 最小合法 JPEG，供三个单测与 smoke harness 共用
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

// 1×1 灰 JPEG（FFD8 开头，服务端只看大小不解码）
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA0MDAsLDBEODw0RFRUWFhURFBQXGh0dHRoaGRkcHSAgICAeIiIiIiIiIiIiIiIiIiL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
  'base64',
);

export function makeTmp() {
  return mkdtempSync(join(tmpdir(), 'wall-'));
}

/** 造一个假 adb：devices 列出 serials；exec-out screencap 输出 jpegBytes；dumpsys window 给前台包 */
export function makeFakeAdb(dir, { serials = ['SER1'], jpegBytes = TINY_JPEG, offline = [] } = {}) {
  const img = join(dir, 'cap.bin');
  writeFileSync(img, jpegBytes);
  const adb = join(dir, 'adb');
  const list = serials.map((s) => `${s}\tdevice`).join('\n');
  writeFileSync(
    adb,
    `#!/usr/bin/env bash
echo "adb $*" >> "${dir}/adb.calls"
if [ "$1" = "devices" ]; then printf 'List of devices attached\\n${list}\\n'; exit 0; fi
S="$2"; shift 2
case "${offline.join(' ')}" in *"$S"*) [ "$1" = "get-state" ] && exit 1;; esac
if [ "$1" = "get-state" ]; then echo device; exit 0; fi
if [ "$1" = "exec-out" ]; then cat "${img}"; exit 0; fi
if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ]; then echo '  mCurrentFocus=Window{c2d79ba u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity}'; exit 0; fi
exit 0
`,
  );
  chmodSync(adb, 0o755);
  return adb;
}

/** 直通"缩图"：把输入原样拷到输出（输入已是 JPEG） */
export function makePassthroughConvert(dir) {
  const p = join(dir, 'convert.sh');
  writeFileSync(p, '#!/usr/bin/env bash\ncp "$1" "$2"\n');
  chmodSync(p, 0o755);
  return p;
}

/** 假中台：记录全部请求；tasks 端点可按次序返回 409 */
export function startFakeApi({ busyCodes = [] } = {}) {
  const requests = [];
  const uuid = randomUUID();
  const taskId = randomUUID();
  let taskCalls = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/agent/register') return send(200, { ok: true, success: true, agent_id: uuid, registered_machine_id: JSON.parse(body.toString()).machine_id });
      if (/^\/api\/workers\/[^/]+\/frame$/.test(req.url)) return send(202, { success: true, data: { seq: requests.length } });
      if (/^\/api\/workers\/[^/]+\/tasks$/.test(req.url)) {
        const code = busyCodes[taskCalls++] ?? 201;
        return code === 201 ? send(201, { success: true, data: { task_id: taskId, lease_until: new Date().toISOString() } }) : send(code, { success: false, error: { code: 'WORKER_BUSY' } });
      }
      if (/^\/api\/workers\/tasks\/[^/]+\/steps$/.test(req.url)) return send(200, { success: true, data: {} });
      if (/^\/api\/workers\/tasks\/[^/]+\/complete$/.test(req.url)) return send(200, { success: true, data: {} });
      send(404, { success: false });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${server.address().port}`;
      resolve({ url, uuid, taskId, requests, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

/** 写 wall.env + profiles.tsv，返回给脚本用的 env */
export function makeEnv(dir, { apiBase, license = 'ZJ-E-TESTTEST', token = 'tok-test', adb, convert }) {
  const cfg = join(dir, 'cfg'); mkdirSync(cfg, { recursive: true });
  const envFile = join(cfg, 'wall.env');
  writeFileSync(envFile, `ZJ_API_BASE=${apiBase}\nZJ_LICENSE=${license}\n${token ? `ZJ_INTERNAL_TOKEN=${token}\n` : ''}`);
  const profiles = join(cfg, 'profiles.tsv');
  writeFileSync(profiles, 'jinoshengyuan-work\tSER1\tMAA-AN00\t1199\t2663\nlegacy\tSER2\tMAA-AN00\t1199\t2663\n');
  return {
    ...process.env,
    HOME: dir,
    ZJ_WALL_ENV: envFile,
    ZJ_WALL_STATE_DIR: cfg,
    ZJ_WALL_TMP: join(dir, 'tmp'),
    ZJ_WALL_LOG: join(dir, 'wall.log'),
    ZJ_PROFILES_TSV: profiles,
    ADB: adb,
    WALL_CONVERT_CMD: convert,
    WALL_ONCE: '1',
  };
}
```

- [ ] **Step 2: 写 wall-lib 的失败测试**

```js
// services/phone-adb-controller/__tests__/wall-lib.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv } from './wall-helpers.mjs';

const LIB = new URL('../wall-lib.sh', import.meta.url).pathname;
const run = (script, env) => spawnSync('bash', ['-c', `. "${LIB}"; ${script}`], { env, encoding: 'utf8' });

test('profile→serial 与缓存读写', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  let r = run('wall_load_env && wall_profile_serial legacy', env);
  assert.equal(r.stdout.trim(), 'SER2');
  r = run('wall_load_env && wall_cache_put SER1 11111111-1111-4111-8111-111111111111 && wall_cache_put SER1 22222222-2222-4222-8222-222222222222 && wall_cached_uuid SER1 && wc -l < "$WALL_AGENTS_TSV"', env);
  assert.match(r.stdout, /22222222-2222-4222-8222-222222222222/);
  assert.match(r.stdout, /\b1\b/); // 同一序列号只保留一行
});

test('register 传 license/machine_id/hostname=phone-<序列号>，返回 uuid 并写缓存', async () => {
  const dir = makeTmp();
  const api = await startFakeApi();
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = run('wall_load_env && wall_register SER1', env);
  assert.equal(r.stdout.trim(), api.uuid);
  const reg = api.requests.find((q) => q.url === '/api/agent/register');
  const body = JSON.parse(reg.body.toString());
  assert.equal(body.license_key, 'ZJ-E-TESTTEST');
  assert.equal(body.machine_id, 'SER1');
  assert.equal(body.hostname, 'phone-SER1');
  assert.equal(body.agent_id, 'phone-SER1');
  assert.match(readFileSync(join(dir, 'cfg', 'wall-agents.tsv'), 'utf8'), new RegExp(`^SER1\\t${api.uuid}\\tphone-SER1$`, 'm'));
  await api.close();
});

test('抓屏压缩：≤上限成功；超上限两次仍超则返回 2', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  let r = run('wall_load_env && wall_capture_jpeg SER1 "$ZJ_WALL_TMP/o.jpg" 122880; echo rc=$?', env);
  assert.match(r.stdout, /rc=0/);
  assert.ok(existsSync(join(dir, 'tmp', 'o.jpg')));
  const big = makeTmp();
  const envBig = makeEnv(big, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(big, { jpegBytes: Buffer.alloc(130 * 1024, 0xff) }), convert: makePassthroughConvert(big) });
  r = run('wall_load_env && wall_capture_jpeg SER1 "$ZJ_WALL_TMP/o.jpg" 122880; echo rc=$?', envBig);
  assert.match(r.stdout, /rc=2/);
});

test('前台包名从 mCurrentFocus 取', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = run('wall_load_env && wall_foreground_pkg SER1', env);
  assert.equal(r.stdout.trim(), 'com.ss.android.ugc.aweme');
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `cd /Users/administrator/worktrees/zenithjoy/cp-09192218-phone-wall-push && node --test services/phone-adb-controller/__tests__/wall-lib.test.mjs`
Expected: 4 个 fail（`wall-lib.sh: No such file`）

- [ ] **Step 4: 写 wall-lib.sh**

```bash
#!/usr/bin/env bash
# wall-lib.sh — 机房手机可视化共用函数（bash 3.2 兼容；被 phone-wall-push.sh / wall-report.sh source）
# 配置文件 ~/.config/zenithjoy/wall.env: ZJ_API_BASE / ZJ_LICENSE / ZJ_INTERNAL_TOKEN
ZJ_WALL_ENV="${ZJ_WALL_ENV:-$HOME/.config/zenithjoy/wall.env}"
ZJ_WALL_STATE_DIR="${ZJ_WALL_STATE_DIR:-$HOME/.config/zenithjoy}"
ZJ_WALL_TMP="${ZJ_WALL_TMP:-/tmp/zj-wall}"
ZJ_WALL_LOG="${ZJ_WALL_LOG:-$HOME/phone-wall.log}"
ZJ_PROFILES_TSV="${ZJ_PROFILES_TSV:-$HOME/.config/openclaw/douyin-phone-profiles.tsv}"
ADB="${ADB:-adb}"
WALL_WIDTH="${WALL_WIDTH:-360}"
WALL_AGENTS_TSV="$ZJ_WALL_STATE_DIR/wall-agents.tsv"

wall_log() { printf '[%s] %s\n' "$(date +%m%d-%H:%M:%S)" "$*" >> "$ZJ_WALL_LOG" 2>/dev/null; }

# 读配置；缺文件或缺键 → 记日志返回 1（调用方自行 exit 0，绝不阻塞主流程）
wall_load_env() {
  [ -r "$ZJ_WALL_ENV" ] || { wall_log "缺配置 $ZJ_WALL_ENV"; return 1; }
  # shellcheck disable=SC1090
  . "$ZJ_WALL_ENV"
  [ -n "${ZJ_API_BASE:-}" ] && [ -n "${ZJ_LICENSE:-}" ] || { wall_log "wall.env 缺 ZJ_API_BASE/ZJ_LICENSE"; return 1; }
  ZJ_API_BASE="${ZJ_API_BASE%/}"
  mkdir -p "$ZJ_WALL_STATE_DIR" "$ZJ_WALL_TMP" 2>/dev/null
  return 0
}

# 取 JSON 路径值（a.b.c），空 → 空串
wall_json_get() {
  python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: d=None
for k in sys.argv[1].split("."):
    d=d.get(k) if isinstance(d,dict) else None
print("" if d is None else d)' "$1"
}

# profile → serial（~/.config/openclaw/douyin-phone-profiles.tsv 第1列 profile、第2列 serial）
wall_profile_serial() { awk -F'\t' -v p="$1" '$1==p{print $2; exit}' "$ZJ_PROFILES_TSV" 2>/dev/null; }

wall_cached_uuid() { awk -F'\t' -v s="$1" '$1==s{print $2; exit}' "$WALL_AGENTS_TSV" 2>/dev/null; }

# 原子写缓存：serial \t uuid \t phone-serial（同序列号只留一行）
wall_cache_put() {
  local tmp="$WALL_AGENTS_TSV.tmp.$$"
  { [ -f "$WALL_AGENTS_TSV" ] && awk -F'\t' -v s="$1" '$1!=s' "$WALL_AGENTS_TSV"
    printf '%s\t%s\tphone-%s\n' "$1" "$2" "$1"; } > "$tmp" && mv -f "$tmp" "$WALL_AGENTS_TSV"
}

# 注册兼心跳：POST /api/agent/register（服务端按 tenant+hostname 去重，故 hostname=phone-<serial> 每台唯一）
# 成功输出 uuid 并写缓存；失败返回 1
wall_register() {
  local serial="$1" body resp uuid
  body=$(python3 -c 'import json,sys; print(json.dumps({"license_key":sys.argv[1],"machine_id":sys.argv[2],"hostname":"phone-"+sys.argv[2],"agent_id":"phone-"+sys.argv[2],"version":"wall-1"}))' "$ZJ_LICENSE" "$serial")
  resp=$(curl -s -m 8 -X POST "$ZJ_API_BASE/api/agent/register" -H 'Content-Type: application/json' -d "$body") || { wall_log "register 网络失败 $serial"; return 1; }
  uuid=$(printf '%s' "$resp" | wall_json_get agent_id)
  case "$uuid" in
    ????????-????-????-????-????????????) wall_cache_put "$serial" "$uuid"; printf '%s\n' "$uuid"; return 0 ;;
    *) wall_log "register $serial 未返回 uuid: $(printf '%s' "$resp" | head -c 200)"; return 1 ;;
  esac
}

# serial → uuid：缓存优先，否则注册
wall_uuid_for() {
  local u; u=$(wall_cached_uuid "$1")
  [ -n "$u" ] && { printf '%s\n' "$u"; return 0; }
  wall_register "$1"
}

# 缩图：in out width quality。默认 macOS sips；WALL_CONVERT_CMD 可注入（同 4 参）
wall_convert() {
  if [ -n "${WALL_CONVERT_CMD:-}" ]; then "$WALL_CONVERT_CMD" "$1" "$2" "$3" "$4"
  else sips -Z "$3" -s format jpeg -s formatOptions "$4" "$1" --out "$2" >/dev/null 2>&1; fi
}

# 抓屏并压到 ≤max 字节：serial out max → 0 成功 / 1 抓屏失败 / 2 两次降质仍超限
wall_capture_jpeg() {
  local serial="$1" out="$2" max="$3" png="$ZJ_WALL_TMP/cap-$1.png" q
  "$ADB" -s "$serial" exec-out screencap -p > "$png" 2>/dev/null || return 1
  [ -s "$png" ] || return 1
  for q in 55 35; do
    wall_convert "$png" "$out" "$WALL_WIDTH" "$q" || return 1
    [ "$(wc -c < "$out" | tr -d ' ')" -le "$max" ] && return 0
  done
  return 2
}

# 前台包名（mCurrentFocus=Window{... u0 <pkg>/<activity>}）
wall_foreground_pkg() {
  "$ADB" -s "$1" shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | sed -n 's/.* \([a-zA-Z0-9_.]*\)\/.*/\1/p' | tr -d '\r'
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd /Users/administrator/worktrees/zenithjoy/cp-09192218-phone-wall-push && node --test services/phone-adb-controller/__tests__/wall-lib.test.mjs`
Expected: 4 pass

- [ ] **Step 6: 提交**

```bash
git add services/phone-adb-controller/__tests__/wall-helpers.mjs services/phone-adb-controller/__tests__/wall-lib.test.mjs
git commit -m "test(phone-wall): wall-lib 失败测试 + 假 adb/假中台助手"
git add services/phone-adb-controller/wall-lib.sh
git commit -m "feat(phone-wall): wall-lib 共用函数（注册兼心跳/缓存/抓屏压缩/前台包名）"
```

---

### Task 2: phone-wall-push.sh 推帧器

**Files:**
- Create: `services/phone-adb-controller/phone-wall-push.sh`
- Test: `services/phone-adb-controller/__tests__/phone-wall-push.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// services/phone-adb-controller/__tests__/phone-wall-push.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, TINY_JPEG } from './wall-helpers.mjs';

const PUSH = new URL('../phone-wall-push.sh', import.meta.url).pathname;
const runOnce = (env) => spawnSync('bash', [PUSH], { env, encoding: 'utf8', timeout: 20000 });

test('一轮：两台手机各 register 一次 + 各推一帧（image/jpeg、带 license 头、≤120KB）', async () => {
  const dir = makeTmp();
  const api = await startFakeApi();
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { serials: ['SER1', 'SER2'] }), convert: makePassthroughConvert(dir) });
  const r = runOnce(env);
  assert.equal(r.status, 0, r.stderr);
  const regs = api.requests.filter((q) => q.url === '/api/agent/register');
  assert.equal(regs.length, 2);
  const frames = api.requests.filter((q) => /\/frame$/.test(q.url));
  assert.equal(frames.length, 2);
  for (const f of frames) {
    assert.equal(f.headers['content-type'], 'image/jpeg');
    assert.equal(f.headers['x-agent-license'], 'ZJ-E-TESTTEST');
    assert.ok(f.body.length <= 122880);
    assert.ok(f.body.equals(TINY_JPEG));
    assert.match(f.url, new RegExp(`/api/workers/${api.uuid}/frame`));
  }
  assert.match(readFileSync(join(dir, 'cfg', 'wall-agents.tsv'), 'utf8'), /^SER1\t/m);
  await api.close();
});

test('帧超 120KB 两次降质仍超 → 跳过该帧，不发请求，退出码 0', async () => {
  const dir = makeTmp();
  const api = await startFakeApi();
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir, { jpegBytes: Buffer.alloc(130 * 1024, 0xff) }), convert: makePassthroughConvert(dir) });
  const r = runOnce(env);
  assert.equal(r.status, 0);
  assert.equal(api.requests.filter((q) => /\/frame$/.test(q.url)).length, 0);
  await api.close();
});

test('中台不可达：退出码 0，日志有记录', async () => {
  const dir = makeTmp();
  const env = makeEnv(dir, { apiBase: 'http://127.0.0.1:1', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  const r = runOnce(env);
  assert.equal(r.status, 0);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /register 网络失败 SER1/);
});

test('缺配置文件：退出码 0 不崩', () => {
  const dir = makeTmp();
  const env = { ...makeEnv(dir, { apiBase: 'x', adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) }), ZJ_WALL_ENV: join(dir, 'nope.env') };
  const r = runOnce(env);
  assert.equal(r.status, 0);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/phone-wall-push.test.mjs`
Expected: 4 fail（脚本不存在）

- [ ] **Step 3: 写 phone-wall-push.sh**

```bash
#!/usr/bin/env bash
# phone-wall-push.sh — 机房手机 adb 抓屏推帧器：每台在线手机每秒一帧 → 控制塔「工作机」实时画面
# 常驻(launchd com.zenithjoy.phonewallpush)；WALL_ONCE=1 只跑一轮(单测/smoke)。永远退出 0。
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wall-lib.sh
. "$DIR/wall-lib.sh"
WALL_INTERVAL="${WALL_INTERVAL:-1}"
FRAME_MAX=122880   # 服务端 express.raw limit 120kb

wall_load_env || exit 0
wall_log "推帧器启动 api=$ZJ_API_BASE once=${WALL_ONCE:-0}"

# 单台手机推帧循环（后台子进程）：serial uuid
push_loop() {
  local serial="$1" uuid="$2" jpg="$ZJ_WALL_TMP/frame-$1.jpg" code
  while :; do
    if ! "$ADB" -s "$serial" get-state >/dev/null 2>&1; then wall_log "$serial 离线,推帧退出"; return 0; fi
    if wall_capture_jpeg "$serial" "$jpg" "$FRAME_MAX"; then
      code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' -X POST "$ZJ_API_BASE/api/workers/$uuid/frame" \
        -H "X-Agent-License: $ZJ_LICENSE" -H 'Content-Type: image/jpeg' --data-binary "@$jpg")
      case "$code" in
        202) ;;
        429) wall_log "$serial frame 429,退避10s"; sleep 10 ;;
        *)   wall_log "$serial frame HTTP $code" ;;
      esac
    fi
    [ "${WALL_ONCE:-0}" = "1" ] && return 0
    sleep "$WALL_INTERVAL"
  done
}

PIDS=(); PSER=()
alive() { kill -0 "$1" 2>/dev/null; }

while :; do
  serials=$("$ADB" devices 2>/dev/null | awk 'NR>1 && $2=="device"{print $1}')
  for s in $serials; do
    running=0; i=0
    while [ "$i" -lt "${#PSER[@]}" ]; do
      [ "${PSER[$i]}" = "$s" ] && alive "${PIDS[$i]}" && running=1
      i=$((i+1))
    done
    uuid=$(wall_register "$s") || { wall_log "$s 注册失败,本轮跳过"; continue; }   # 每轮注册 = 心跳(刷 last_seen)
    if [ "$running" -eq 0 ]; then
      push_loop "$s" "$uuid" &
      PIDS[${#PIDS[@]}]=$!; PSER[${#PSER[@]}]="$s"
      wall_log "$s 推帧子进程 $! uuid=$uuid"
    fi
  done
  [ "${WALL_ONCE:-0}" = "1" ] && { wait; exit 0; }
  sleep 60
done
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/phone-wall-push.test.mjs`
Expected: 4 pass

- [ ] **Step 5: 提交**

```bash
git add services/phone-adb-controller/__tests__/phone-wall-push.test.mjs
git commit -m "test(phone-wall): 推帧器一轮/超限跳帧/中台不可达/缺配置 失败测试"
git add services/phone-adb-controller/phone-wall-push.sh
git commit -m "feat(phone-wall): adb 抓屏推帧器（register 兼心跳 + 每台子进程推帧 + 429 退避）"
```

---

### Task 3: wall-report.sh 上报器

**Files:**
- Create: `services/phone-adb-controller/wall-report.sh`
- Test: `services/phone-adb-controller/__tests__/wall-report.test.mjs`

- [ ] **Step 1: 写失败测试**

```js
// services/phone-adb-controller/__tests__/wall-report.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv, TINY_JPEG } from './wall-helpers.mjs';

const WR = new URL('../wall-report.sh', import.meta.url).pathname;
const wr = (env, ...args) => spawnSync('bash', [WR, ...args], { env, encoding: 'utf8', timeout: 15000 });
const body = (q) => JSON.parse(q.body.toString());

async function setup(opts = {}) {
  const dir = makeTmp();
  const api = await startFakeApi(opts);
  const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
  return { dir, api, env };
}

test('start/step/note/done 全链：只带 Bearer 不带 license 头，note 续报当前步 doing', async () => {
  const { api, env } = await setup();
  assert.equal(wr(env, 'start', 'SER1', '获客采收·AI', '拉Commander,设备预检,取词单').status, 0);
  assert.equal(wr(env, 'step', 'SER1', '0', 'done').status, 0);
  assert.equal(wr(env, 'step', 'SER1', '1', 'doing', '词1: 学AI').status, 0);
  assert.equal(wr(env, 'note', 'SER1', '视频2: xxx').status, 0);
  assert.equal(wr(env, 'done', 'SER1').status, 0);
  const t = api.requests.find((q) => /\/tasks$/.test(q.url));
  assert.equal(t.headers.authorization, 'Bearer tok-test');
  assert.equal(t.headers['x-agent-license'], undefined);
  assert.deepEqual(body(t), { title: '获客采收·AI', steps: ['拉Commander', '设备预检', '取词单'], executor_id: 'adb-wall' });
  const steps = api.requests.filter((q) => /\/steps$/.test(q.url)).map(body);
  assert.deepEqual(steps.map((s) => [s.step_index, s.status, s.note]), [[0, 'done', ''], [1, 'doing', '词1: 学AI'], [1, 'doing', '视频2: xxx']]);
  for (const q of api.requests.filter((q) => /\/steps$|\/complete$/.test(q.url))) assert.equal(q.headers['x-agent-license'], undefined);
  const c = api.requests.find((q) => /\/complete$/.test(q.url));
  assert.deepEqual(body(c), { outcome: 'completed', executor_id: 'adb-wall' });
  await api.close();
});

test('fail 必带三件套（前台包名 + 诊断行 + JPEG base64）并 complete failed', async () => {
  const { api, env } = await setup();
  wr(env, 'start', 'SER1', 't', 'a,b');
  assert.equal(wr(env, 'fail', 'SER1', '1', 'device_offline', 'adb get-state 失败').status, 0);
  const s = body(api.requests.find((q) => /\/steps$/.test(q.url)));
  assert.equal(s.status, 'failed');
  assert.equal(s.step_index, 1);
  assert.equal(s.foreground_pkg, 'com.ss.android.ugc.aweme');
  assert.equal(s.diag_line, 'adb get-state 失败');
  assert.equal(s.screenshot_jpeg_b64, TINY_JPEG.toString('base64'));
  const c = body(api.requests.find((q) => /\/complete$/.test(q.url)));
  assert.deepEqual(c, { outcome: 'failed', executor_id: 'adb-wall', error_code: 'device_offline', failed_step: 1 });
  await api.close();
});

test('--profile 解析序列号；409 时先把旧任务 complete superseded 再重试', async () => {
  const { api, env } = await setup({ busyCodes: [201, 409, 201] });
  wr(env, 'start', '--profile', 'legacy', 't1', 'a');            // 201
  wr(env, 'start', '--profile', 'legacy', 't2', 'a');            // 409 → superseded → 201
  const completes = api.requests.filter((q) => /\/complete$/.test(q.url)).map(body);
  assert.deepEqual(completes[0], { outcome: 'failed', executor_id: 'adb-wall', error_code: 'superseded', failed_step: 0 });
  assert.equal(api.requests.filter((q) => /\/tasks$/.test(q.url)).length, 3);
  const reg = body(api.requests.find((q) => q.url === '/api/agent/register'));
  assert.equal(reg.machine_id, 'SER2');
  await api.close();
});

test('缺 ZJ_INTERNAL_TOKEN / 中台不可达：都退出 0 不发请求或只记日志', async () => {
  const { dir, api, env } = await setup();
  const noTok = { ...env, ZJ_WALL_ENV: join(dir, 'cfg', 'notok.env') };
  writeFileSync(noTok.ZJ_WALL_ENV, `ZJ_API_BASE=${api.url}\nZJ_LICENSE=ZJ-E-TESTTEST\n`);
  assert.equal(wr(noTok, 'start', 'SER1', 't', 'a').status, 0);
  assert.equal(api.requests.length, 0);
  const dead = { ...env, ZJ_WALL_ENV: join(dir, 'cfg', 'dead.env') };
  writeFileSync(dead.ZJ_WALL_ENV, 'ZJ_API_BASE=http://127.0.0.1:1\nZJ_LICENSE=ZJ-E-TESTTEST\nZJ_INTERNAL_TOKEN=t\n');
  assert.equal(wr(dead, 'start', 'SER1', 't', 'a').status, 0);
  assert.match(readFileSync(join(dir, 'wall.log'), 'utf8'), /register 网络失败 SER1/);
  await api.close();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test services/phone-adb-controller/__tests__/wall-report.test.mjs`
Expected: 4 fail

- [ ] **Step 3: 写 wall-report.sh**

```bash
#!/usr/bin/env bash
# wall-report.sh — 获客链步骤上报薄壳（控制塔 worker 活动协议执行器面）。永远退出 0、绝不阻塞主流程。
# 用法（目标 = <serial> 或 --profile <P>，后者查 douyin-phone-profiles.tsv）:
#   wall-report start <目标> "<title>" "步骤1,步骤2,..."
#   wall-report step  <目标> <idx> doing|done|failed ["note"] ["diag"]
#   wall-report note  <目标> "<note>"            # 当前步再报 doing（服务端续租 10 分钟）
#   wall-report done  <目标>
#   wall-report fail  <目标> <idx> <error_code> ["diag_line"]
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=wall-lib.sh
. "$DIR/wall-lib.sh"
EXECUTOR="adb-wall"
# 最小合法 JPEG(1×1)，真机截图失败时的占位（服务端 failed 步必须带截图）
PLACEHOLDER_JPEG_B64='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA0MDAsLDBEODw0RFRUWFhURFBQXGh0dHRoaGRkcHSAgICAeIiIiIiIiIiIiIiIiIiL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z'

cmd="${1:-}"; [ $# -gt 0 ] && shift
wall_load_env || exit 0
[ -n "${ZJ_INTERNAL_TOKEN:-}" ] || { wall_log "缺 ZJ_INTERNAL_TOKEN,上报关闭"; exit 0; }
if [ "${1:-}" = "--profile" ]; then SERIAL=$(wall_profile_serial "${2:-}"); shift 2
else SERIAL="${1:-}"; [ $# -gt 0 ] && shift; fi
[ -n "$SERIAL" ] || { wall_log "report $cmd: 无法解析序列号"; exit 0; }
STATE="$ZJ_WALL_TMP/task-$SERIAL"    # 两行: task_id / 当前 step_index

# 执行器面只用内部 token；绝不带 X-Agent-License（带了会被分流到 license 路径而 401）
api() { # POST path body → 输出 "<code> <body>"
  local out code
  out=$(curl -s -m 3 -w '\n%{http_code}' -X POST "$ZJ_API_BASE$1" \
        -H "Authorization: Bearer $ZJ_INTERNAL_TOKEN" -H 'Content-Type: application/json' -d "$2") || { printf '000 \n'; return 0; }
  code=${out##*$'\n'}; out=${out%$'\n'*}
  printf '%s %s\n' "$code" "$out"
}
state_task() { sed -n 1p "$STATE" 2>/dev/null; }
state_step() { sed -n 2p "$STATE" 2>/dev/null; }
state_put()  { printf '%s\n%s\n' "$1" "$2" > "$STATE"; }

do_complete() { # task_id completed | task_id failed error_code failed_step
  local b
  if [ "$2" = "failed" ]; then
    b=$(python3 -c 'import json,sys;print(json.dumps({"outcome":"failed","executor_id":sys.argv[1],"error_code":sys.argv[2],"failed_step":int(sys.argv[3] or 0)}))' "$EXECUTOR" "$3" "$4")
  else
    b=$(python3 -c 'import json,sys;print(json.dumps({"outcome":sys.argv[2],"executor_id":sys.argv[1]}))' "$EXECUTOR" "$2")
  fi
  api "/api/workers/tasks/$1/complete" "$b" >/dev/null
}

do_start() { # title steps_csv
  local uuid body r code tid old
  uuid=$(wall_uuid_for "$SERIAL") || { wall_log "start $SERIAL: 无 uuid"; return 0; }
  body=$(python3 -c 'import json,sys;print(json.dumps({"title":sys.argv[1][:80],"steps":[s for s in sys.argv[2].split(",") if s],"executor_id":sys.argv[3]}))' "$1" "$2" "$EXECUTOR")
  r=$(api "/api/workers/$uuid/tasks" "$body"); code=${r%% *}
  if [ "$code" = "409" ]; then
    old=$(state_task)
    if [ -n "$old" ]; then
      do_complete "$old" failed superseded "$(state_step)"
      r=$(api "/api/workers/$uuid/tasks" "$body"); code=${r%% *}
    fi
  fi
  if [ "$code" = "201" ]; then
    tid=$(printf '%s' "${r#* }" | wall_json_get data.task_id)
    state_put "$tid" 0; wall_log "start $SERIAL task=$tid"
  else
    rm -f "$STATE"; wall_log "start $SERIAL HTTP $code,静默降级"
  fi
}

do_step() { # idx status [note] [diag]
  local tid idx="$1" st="$2" note="${3:-}" diag="${4:-}" body fg shot b64 r code
  tid=$(state_task); [ -n "$tid" ] || return 0
  if [ "$st" = "failed" ]; then
    fg=$(wall_foreground_pkg "$SERIAL"); [ -n "$fg" ] || fg=unknown
    [ -n "$diag" ] || diag="${note:-n/a}"
    shot="$ZJ_WALL_TMP/fail-$SERIAL.jpg"
    if wall_capture_jpeg "$SERIAL" "$shot" 204800; then b64=$(base64 < "$shot" | tr -d '\n')
    else b64="$PLACEHOLDER_JPEG_B64"; note="$note [截图失败,占位图]"; fi
    body=$(python3 -c 'import json,sys;print(json.dumps({"step_index":int(sys.argv[1]),"status":"failed","executor_id":sys.argv[2],"note":sys.argv[3][:200],"foreground_pkg":sys.argv[4],"diag_line":sys.argv[5][:500],"screenshot_jpeg_b64":sys.argv[6]}))' "$idx" "$EXECUTOR" "$note" "$fg" "$diag" "$b64")
  else
    body=$(python3 -c 'import json,sys;print(json.dumps({"step_index":int(sys.argv[1]),"status":sys.argv[2],"executor_id":sys.argv[3],"note":sys.argv[4][:200]}))' "$idx" "$st" "$EXECUTOR" "$note")
  fi
  r=$(api "/api/workers/tasks/$tid/steps" "$body"); code=${r%% *}
  [ "$code" = "200" ] || wall_log "step $SERIAL #$idx $st HTTP $code"
  state_put "$tid" "$idx"
}

case "$cmd" in
  start) do_start "${1:-任务}" "${2:-步骤1}" ;;
  step)  do_step "${1:-0}" "${2:-doing}" "${3:-}" "${4:-}" ;;
  note)  do_step "$(state_step)" doing "${1:-}" ;;
  done)  tid=$(state_task); [ -n "$tid" ] && { do_complete "$tid" completed; rm -f "$STATE"; } ;;
  fail)  idx="${1:-0}"; ec="${2:-failed}"
         do_step "$idx" failed "$ec" "${3:-$ec}"
         tid=$(state_task); [ -n "$tid" ] && { do_complete "$tid" failed "$ec" "$idx"; rm -f "$STATE"; } ;;
  *)     wall_log "未知子命令: $cmd" ;;
esac
exit 0
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test services/phone-adb-controller/__tests__/wall-report.test.mjs`
Expected: 4 pass

- [ ] **Step 5: 提交**

```bash
git add services/phone-adb-controller/__tests__/wall-report.test.mjs
git commit -m "test(phone-wall): 上报器 start/step/note/done/fail 三件套/409 收尾/降级 失败测试"
git add services/phone-adb-controller/wall-report.sh
git commit -m "feat(phone-wall): wall-report 上报薄壳（worker 活动协议，失败带三件套，409 收尾重试）"
```

---

### Task 4: 挂钩四个 zsh 脚本 + smoke 守卫

**Files:**
- Modify: `services/phone-adb-controller/harvest-cron.sh`
- Modify: `services/phone-adb-controller/batch2.sh`
- Modify: `services/phone-adb-controller/harvest-keyword.sh`
- Modify: `services/phone-adb-controller/outreach-tick.sh`
- Create: `services/phone-adb-controller/__tests__/wall-smoke-harness.mjs`
- Create: `.github/workflows/scripts/smoke/phone-wall-push-smoke.sh`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`

- [ ] **Step 1: 先写 smoke（它就是这个任务的失败测试）**

```bash
#!/usr/bin/env bash
# phone-wall-push-smoke.sh — 机房手机可视化守卫：语法闸 + 四脚本挂钩存在 + 既有窗口断言不破 + 假中台跑一轮
# CI ubuntu 无 adb 无 zsh 也自洽（假 adb 是 bash 脚本）。
set -euo pipefail
D="services/phone-adb-controller"
fail() { echo "::error::phone-wall-push-smoke: $1"; exit 1; }

# 层0: 文件存在
for f in wall-lib.sh phone-wall-push.sh wall-report.sh com.zenithjoy.phonewallpush.plist; do
  [ -s "$D/$f" ] || fail "$f 缺失或为空"
done
# 层1: bash 语法闸
for f in wall-lib.sh phone-wall-push.sh wall-report.sh; do bash -n "$D/$f" || fail "$f bash 语法错误"; done
# 层2: 挂钩存在（删掉任一行即红）
grep -qF 'wr start "$SERIAL"' "$D/harvest-cron.sh"                 || fail "harvest-cron 未挂 start"
grep -qF 'wr fail "$SERIAL" 1 device_offline' "$D/harvest-cron.sh" || fail "harvest-cron 未挂 device_offline"
grep -qF 'wr fail "$SERIAL" 2 keywords_unavailable' "$D/harvest-cron.sh" || fail "harvest-cron 未挂 keywords_unavailable"
grep -qF 'wr done "$SERIAL"' "$D/harvest-cron.sh"                  || fail "harvest-cron 未挂 done"
grep -qF 'wr step "$SERIAL" 3 doing' "$D/batch2.sh"                 || fail "batch2 未挂词级 step"
grep -qF 'wr note --profile "$P"' "$D/harvest-keyword.sh"           || fail "harvest-keyword 未挂视频级 note(续租)"
grep -qF 'wr start --profile "$PROFILE"' "$D/outreach-tick.sh"      || fail "outreach-tick 未挂 start"
grep -qF 'wr fail --profile "$PROFILE" 1' "$D/outreach-tick.sh"     || fail "outreach-tick 未挂 fail"
# 层2b: outreach 的 wr 定义必须在 source 守卫之后（smoke 层4 source 只取函数）
GUARD=$(grep -n 'OUTREACH_TICK_SOURCED' "$D/outreach-tick.sh" | head -1 | cut -d: -f1)
WRDEF=$(grep -n '^wr()' "$D/outreach-tick.sh" | head -1 | cut -d: -f1)
[ -n "$GUARD" ] && [ -n "$WRDEF" ] && [ "$WRDEF" -gt "$GUARD" ] || fail "outreach-tick 的 wr 定义必须在 source 守卫之后"
# 层3: 既有窗口断言不破（同 phone-adb-controller-smoke 层7c/层8）
grep -A2 '设备离线' "$D/harvest-cron.sh" | grep -q escalate || fail "harvest-cron 设备离线→escalate 窗口被挤"
grep -A8 'KWERR' "$D/harvest-cron.sh" | grep -q escalate   || fail "harvest-cron KWERR→escalate 窗口被挤"
# 层4: 假中台 + 假 adb 跑一轮（推帧 + 上报）
node "$D/__tests__/wall-smoke-harness.mjs" || fail "假中台一轮失败"
echo "phone-wall-push-smoke: OK"
```

```js
// services/phone-adb-controller/__tests__/wall-smoke-harness.mjs
// smoke 层4：不经 node --test，直接跑推帧器一轮 + 上报器 start/done，断言最少请求形状
import { spawnSync } from 'node:child_process';
import { makeTmp, makeFakeAdb, makePassthroughConvert, startFakeApi, makeEnv } from './wall-helpers.mjs';

const dir = makeTmp();
const api = await startFakeApi();
const env = makeEnv(dir, { apiBase: api.url, adb: makeFakeAdb(dir), convert: makePassthroughConvert(dir) });
const PUSH = new URL('../phone-wall-push.sh', import.meta.url).pathname;
const WR = new URL('../wall-report.sh', import.meta.url).pathname;
const die = (m) => { console.error('wall-smoke-harness: ' + m); process.exit(1); };
if (spawnSync('bash', [PUSH], { env, timeout: 20000 }).status !== 0) die('推帧器退出码非 0');
if (spawnSync('bash', [WR, 'start', 'SER1', 'smoke', 'a,b'], { env, timeout: 15000 }).status !== 0) die('start 退出码非 0');
if (spawnSync('bash', [WR, 'done', 'SER1'], { env, timeout: 15000 }).status !== 0) die('done 退出码非 0');
const has = (re) => api.requests.some((q) => re.test(q.url));
if (!has(/\/api\/agent\/register$/)) die('无 register');
if (!has(/\/frame$/)) die('无 frame');
if (!has(/\/tasks$/)) die('无 tasks');
if (!has(/\/complete$/)) die('无 complete');
const frame = api.requests.find((q) => /\/frame$/.test(q.url));
if (frame.headers['content-type'] !== 'image/jpeg' || frame.body.length > 122880) die('frame 形状不对');
await api.close();
console.log('wall-smoke-harness: OK');
```

- [ ] **Step 2: 跑 smoke 确认失败**

Run: `chmod +x .github/workflows/scripts/smoke/phone-wall-push-smoke.sh && bash .github/workflows/scripts/smoke/phone-wall-push-smoke.sh`
Expected: `::error::phone-wall-push-smoke: com.zenithjoy.phonewallpush.plist 缺失或为空`（plist 在 Task 5；先临时看到这一条即可，Task 5 后整份绿）

- [ ] **Step 3: 挂钩 harvest-cron.sh**

在第 12 行 `log(){...}` 之后插入（wr 定义，永不阻塞）：

```zsh
# 可视化旁路(0919): 每阶段报给控制塔工作机页; 上报器缺失/失败一律吞掉, 绝不影响采收
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
```

在第 29 行 `}`（escalate 函数结束）之后插入：

```zsh
wr start "$SERIAL" "获客采收·$BIZ" "拉Commander,设备预检,取词单,采收主体,效果回写"
wr step "$SERIAL" 0 doing
```

在原第 49 行 `fi`（Commander 块结束）之后插入：

```zsh
wr step "$SERIAL" 0 done; wr step "$SERIAL" 1 doing
```

在原第 54 行 `escalate "设备 $SERIAL 离线..."` 之后、`exit 0` 之前插入（不动 53↔54 相邻关系）：

```zsh
  wr fail "$SERIAL" 1 device_offline "adb get-state 失败"
```

在原第 63 行 `adb -s $SERIAL shell svc power stayon true` 之后插入：

```zsh
wr step "$SERIAL" 1 done
```

把原第 68 行整行改为（同一行，不增行）：

```zsh
if (( H >= 8 && H < 22 )); then log "白天触达时窗,采收退让"; wr done "$SERIAL"; exit 0; fi
```

把原第 79-80 行 `log "KPI已达标..."` / `exit 0` 之间插入：

```zsh
  wr done "$SERIAL"
```

在原第 88 行 `fi`（KPI 闸块结束）之后插入：

```zsh
wr step "$SERIAL" 2 doing
```

在原第 115 行 `escalate "取词单失败**且无兜底词单**..."` 之后、`exit 0` 之前插入（在 104-112 窗口之外）：

```zsh
    wr fail "$SERIAL" 2 keywords_unavailable "$WHY"
```

在原第 120 行 `log "词单 ${NWORDS}词: ..."` 之后插入：

```zsh
wr step "$SERIAL" 2 done; wr step "$SERIAL" 3 doing "${NWORDS}词"
```

在原第 124 行 `log "批完成: ..."` 之后插入：

```zsh
wr step "$SERIAL" 3 done
```

把原第 126-130 行效果回写块改为：

```zsh
if [[ "$PUSH" == "1" ]]; then
  wr step "$SERIAL" 4 doing
  ssh -o ConnectTimeout=20 us-vps "docker exec openclaw-gateway node /root/.openclaw/update-keyword-stats.js" >> $LOG 2>&1
  log "效果已回写关键词表"
  wr step "$SERIAL" 4 done
fi
wr done "$SERIAL"
```

- [ ] **Step 4: 挂钩 batch2.sh**

在第 8 行 `P="$1"; ...` 之后插入：

```zsh
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -n "$SERIAL" && -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
```

在 `print "[$(date +%H:%M:%S)] 词$n: $W" >> $LOG` 之后插入：

```zsh
  wr step "$SERIAL" 3 doing "词$n: $W"
```

在 `print "[$(date +%H:%M:%S)] 词$n 完成 LEAD=..." >> $LOG` 之后插入：

```zsh
  wr note "$SERIAL" "词$n 完成 LEAD=$(grep -c '^LEAD' $OUT 2>/dev/null||echo 0)"
```

- [ ] **Step 5: 挂钩 harvest-keyword.sh**

在第 10 行 `log(){...}` 之后插入：

```zsh
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
```

在 `log "视频$i: ${TITLE:0:40}"` 之后插入（每视频续租一次，与下一行 lock-refresh 同理）：

```zsh
  wr note --profile "$P" "视频$i: ${TITLE:0:40}"
```

- [ ] **Step 6: 挂钩 outreach-tick.sh**

在第 23 行 `[[ -n "${OUTREACH_TICK_SOURCED:-}" ]] && return 0` **之后**插入：

```zsh
# 可视化旁路(0919): 触达每阶段报给控制塔; 上报失败一律吞掉
WR=${WALL_REPORT:-$HOME/bin-harvest/wall-report.sh}
wr(){ [[ -x "$WR" ]] && "$WR" "$@" >/dev/null 2>&1; true }
```

在 `log "单#$SEQ: $NICK($DYID) via $SENDER [$PROFILE] ${PURL:+link}"` 之后插入：

```zsh
wr start --profile "$PROFILE" "触达·单#$SEQ $NICK" "拿锁,发送,核验"
wr step --profile "$PROFILE" 0 doing
```

`log "锁被占(采收在用),回队列待下轮"; mark "$RID" requeue "lock busy"; exit 0` 改为：

```zsh
    log "锁被占(采收在用),回队列待下轮"; mark "$RID" requeue "lock busy"; wr done --profile "$PROFILE"; exit 0
```

在 lock-acquire 的 `fi` 之后（`# 拟人③` 注释之前）插入：

```zsh
  wr step --profile "$PROFILE" 0 done; wr step --profile "$PROFILE" 1 doing "第${ATTEMPT}次发送"
```

在 `if print -- "$OUT" | grep -q "send_status=sent"; then` 之后的 `RAWTAIL=...` 行之后插入：

```zsh
    wr step --profile "$PROFILE" 1 done; wr step --profile "$PROFILE" 2 doing "核验仅互关"
```

受限分支 `log "⚠️ 单#$SEQ 气泡已发但仅互关限制,标记受限(不计成功触达)"` 之后插入：

```zsh
      wr step --profile "$PROFILE" 2 done "受限"; wr done --profile "$PROFILE"
```

送达分支 `log "✅ 单#$SEQ 送达(第${ATTEMPT}次尝试)"` 之后插入：

```zsh
    wr step --profile "$PROFILE" 2 done; wr done --profile "$PROFILE"
```

非瞬时失败分支 `log "❌ 单#$SEQ 失败($CLS): ${REASON:-rc=$RC}"` 之后插入：

```zsh
    wr fail --profile "$PROFILE" 1 "$CLS" "${REASON:-rc=$RC}"
```

重试用尽分支 `log "🔁 单#$SEQ 瞬时失败${ATTEMPT}次用尽,回队列: ..."` 之后插入：

```zsh
    wr fail --profile "$PROFILE" 1 transient_exhausted "${REASON:-rc=$RC}"
```

瞬时重试 `log "⏳ 单#$SEQ 瞬时失败(第${ATTEMPT}次): ..."` 之后插入：

```zsh
  wr note --profile "$PROFILE" "第${ATTEMPT}次瞬时失败,${BACKOFF}s后重试"
```

- [ ] **Step 7: 登记 smoke 基线**

在 `.github/workflows/scripts/smoke-baseline.txt` 按字母序插入一行 `phone-wall-push-smoke.sh`（紧邻 `phone-adb-controller-smoke.sh` 之后）。

- [ ] **Step 8: 跑既有 smoke 与新 smoke（新 smoke 仍缺 plist，其余层应全过）**

Run: `bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh && zsh -n services/phone-adb-controller/harvest-cron.sh services/phone-adb-controller/batch2.sh services/phone-adb-controller/harvest-keyword.sh services/phone-adb-controller/outreach-tick.sh && echo ZSH_OK`
Expected: 既有 smoke 全过 + `ZSH_OK`

- [ ] **Step 9: 提交**

```bash
git add .github/workflows/scripts/smoke/phone-wall-push-smoke.sh .github/workflows/scripts/smoke-baseline.txt services/phone-adb-controller/__tests__/wall-smoke-harness.mjs
git commit -m "test(phone-wall): 可视化 smoke 守卫（挂钩存在+窗口断言+假中台一轮）"
git add services/phone-adb-controller/harvest-cron.sh services/phone-adb-controller/batch2.sh services/phone-adb-controller/harvest-keyword.sh services/phone-adb-controller/outreach-tick.sh
git commit -m "feat(phone-wall): 采收/触达链每阶段旁路上报到控制塔（失败不阻塞）"
```

---

### Task 5: launchd plist + README + 全量验证 + 变异自证

**Files:**
- Create: `services/phone-adb-controller/com.zenithjoy.phonewallpush.plist`
- Modify: `services/phone-adb-controller/README.md`

- [ ] **Step 1: 写 plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.zenithjoy.phonewallpush</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>-c</string><string>export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/Library/Android/sdk/platform-tools:$PATH"; exec ~/bin-harvest/phone-wall-push.sh</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
<key>StandardErrorPath</key><string>/tmp/phonewallpush.err</string>
</dict></plist>
```

- [ ] **Step 2: README 追加一节**

在「五件套清单」表后追加：

```markdown
## 可视化两件(0919, 决策见 Brain task 1f5b9134)

| 文件 | 用途 |
| --- | --- |
| `phone-wall-push.sh` + `wall-lib.sh` + `com.zenithjoy.phonewallpush.plist` | 推帧器(launchd 常驻): 每台 adb 在线手机每秒 `screencap`→JPEG(≤120KB)→`POST /api/workers/<uuid>/frame`(X-Agent-License); 每 60s `POST /api/agent/register` 兼心跳(hostname=phone-<序列号>) |
| `wall-report.sh` | 上报薄壳: `start/step/note/done/fail`, 采收/触达链每阶段旁路调用(内部 token, curl -m 3, 永不阻塞); `fail` 自动带三件套 |

配置 `~/.config/zenithjoy/wall.env`(chmod 600): `ZJ_API_BASE` / `ZJ_LICENSE` / `ZJ_INTERNAL_TOKEN`。
部署: scp 三个新脚本 + 四个改过的 zsh 到 `~/bin-harvest/`, plist 到 `~/Library/LaunchAgents/`, `launchctl load -w`。
看: Dashboard「工作机」页 `/dashboard/workers`。
```

- [ ] **Step 3: 全量跑**

Run: `node --test services/phone-adb-controller/__tests__/*.test.mjs && bash .github/workflows/scripts/smoke/phone-wall-push-smoke.sh && bash .github/workflows/scripts/smoke/phone-adb-controller-smoke.sh`
Expected: 单测 12 pass；两份 smoke 各打印 OK

- [ ] **Step 4: 变异自证（不提交，看红后还原）**

1. `sed -i '' 's/FRAME_MAX=122880/FRAME_MAX=1024/' services/phone-adb-controller/phone-wall-push.sh` → 跑推帧器单测，Expected: "一轮" 用例 fail（frames.length 0）→ `git checkout services/phone-adb-controller/phone-wall-push.sh`
2. `sed -i '' '/wr fail "\$SERIAL" 1 device_offline/d' services/phone-adb-controller/harvest-cron.sh` → 跑新 smoke，Expected: `未挂 device_offline` 红 → `git checkout services/phone-adb-controller/harvest-cron.sh`
3. `sed -i '' 's/-H "Authorization: Bearer $ZJ_INTERNAL_TOKEN"/-H "X-Agent-License: x" -H "Authorization: Bearer $ZJ_INTERNAL_TOKEN"/' services/phone-adb-controller/wall-report.sh` → 跑上报器单测，Expected: "只带 Bearer" 用例 fail → `git checkout services/phone-adb-controller/wall-report.sh`

- [ ] **Step 5: 提交**

```bash
git add services/phone-adb-controller/com.zenithjoy.phonewallpush.plist services/phone-adb-controller/README.md
git commit -m "feat(phone-wall): launchd 常驻 plist + README 可视化两件与部署"
```

---

## 自审

- 规格覆盖：3.1 推帧器→Task 2；3.2 上报器→Task 3；3.3 挂钩→Task 4；3.4 plist→Task 5；5 错误处理（429/超限/409/不可达/三件套占位）→Task 2/3 代码与测试；6 测试策略→Task 1-5；7 部署→README。真机验收由 lead 在 PR 后手动执行（不在计划内）。
- 类型一致：`wall_capture_jpeg serial out max` 三处调用一致；`wr` 参数序 `子命令 目标 ...` 与 `wall-report.sh` 解析一致；`FRAME_MAX=122880` 与测试断言一致；假中台 `busyCodes` 与 409 测试一致。
- PR 标题须带 `[CONFIG]`（新增 smoke 文件触发 Config Audit）。
