# OpenClaw adb_controller → phonectl.sh 信号桥适配层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 OpenClaw 侧 `douyin-phone-runtime` skill 写一个新的 `adb_controller` 兼容实现，内部调用已合并的 `scripts/openclaw/phonectl.sh` 走中台信号桥操作手机，替代 SSH+adb 老路径。

**Architecture:** 单个 bash 脚本 `scripts/openclaw/adb-controller-bridge.sh`，`--profile` 映射走静态配置 `scripts/openclaw/profiles.json`，测试用 `node --test` + mock HTTP server（顶替中台 API，同时 stub `phonectl.sh` 本身通过覆写 `PHONECTL` 环境变量指向测试专用 fake）。

**Tech Stack:** bash, jq, curl；测试 node:test + node:assert/strict。

设计文档：`docs/superpowers/specs/2026-09-05-openclaw-adb-controller-bridge-design.md`（先读一遍，了解 preflight/lock/snapshot/evidence 的完整字段设计与已知缺口）。

---

## 公共约定（所有 Task 遵守）

- 测试文件：`scripts/openclaw/__tests__/adb-controller-bridge.test.js`（同一个文件持续累加 test case，风格照抄 `scripts/openclaw/__tests__/phonectl.test.js`：`node:test` + `node:assert/strict` + 本地 mock HTTP server + 异步 `spawn`，禁止 `spawnSync`）
- 被测脚本：`scripts/openclaw/adb-controller-bridge.sh`
- 测试里 stub 中台 API 的方式：`ZENITHJOY_API_BASE=http://127.0.0.1:<mock端口>`（同 phonectl 测试）
- 测试里 stub `phonectl.sh` 本身的方式：脚本内部通过 `PHONECTL="${PHONECTL:-$SCRIPT_DIR/phonectl.sh}"` 变量间接调用；测试可以直接指向真实 `phonectl.sh`（它本身只是转发 HTTP，mock server 顶替的是它请求的中台 API，两层都能被同一个 mock server 覆盖：`preflight` 里查询 `/api/agent/burner/sessions` 也打到同一个 `ZENITHJOY_API_BASE`）
- `PROFILES_FILE` 环境变量可覆盖默认路径 `$SCRIPT_DIR/profiles.json`，测试用 `mktemp` 生成临时 profiles 文件传入，不依赖真实的 `profiles.json` 内容
- `OPENCLAW_EVIDENCE_DIR` 环境变量可覆盖 evidence 落盘根目录，测试用 `mktemp -d` 隔离

---

### Task 1: 脚手架 + profile 加载 + preflight

**Files:**
- Create: `scripts/openclaw/adb-controller-bridge.sh`
- Create: `scripts/openclaw/profiles.json`
- Create: `scripts/openclaw/__tests__/adb-controller-bridge.test.js`

- [ ] **Step 1: 写 profiles.json（真实登记文件，非测试用）**

```json
{
  "realmachine-smoke": {
    "agent_id": "e017953c-bc65-47e0-913e-a2ed5eb54993",
    "tenant_id": "455a8ca9-5f63-4286-83ce-c5cca04cfd58"
  }
}
```

- [ ] **Step 2: 写第一批 failing test（脚手架 + preflight）**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const SCRIPT = resolve(__dirname, '../adb-controller-bridge.sh');
const AGENT_ID = 'e017953c-bc65-47e0-913e-a2ed5eb54993';
const TENANT_ID = '455a8ca9-5f63-4286-83ce-c5cca04cfd58';

function makeProfilesFile(dir) {
  const p = join(dir, 'profiles.json');
  writeFileSync(p, JSON.stringify({
    'test-profile': { agent_id: AGENT_ID, tenant_id: TENANT_ID },
  }));
  return p;
}

function startMockServer(handler) {
  return new Promise((resolveStart) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolveStart(server));
  });
}

function runBridge(args, env) {
  return new Promise((resolveRun) => {
    const child = spawn('bash', [SCRIPT, ...args], { env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolveRun({ status, stdout, stderr }));
  });
}

test('缺少 --profile 参数：exit 2，不发任何请求', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const r = await runBridge(['preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('未知 profile：exit 2，报 unknown profile', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const r = await runBridge(['--profile', 'nope', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown profile/);
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：device_info 成功 + 有 active burner session → account_verified=true，call_state=unknown', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res, body) => {
    if (req.url === `/api/devices/${AGENT_ID}/actions`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', data: { model: 'MAA-AN00', manufacturer: 'HONOR', androidVersion: '15', agentVersion: '2.1.48' }, outcome: 'completed' } }));
      return;
    }
    if (req.url === '/api/agent/burner/sessions') {
      assert.equal(req.headers['x-tenant-id'], TENANT_ID);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sessions: [
        { agent_id: AGENT_ID, platform: 'douyin', role: 'burner', status: 'active', account_label: 'test-burner' },
      ] } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.account_verified, true);
  assert.equal(out.call_state, 'unknown');
  assert.equal(out.model, 'MAA-AN00');
  assert.ok(out.warnings.some((w) => w.includes('call_state')));
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：无 active session → account_verified=false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res) => {
    if (req.url === `/api/devices/${AGENT_ID}/actions`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'launcher', data: { model: 'MAA-AN00' }, outcome: 'completed' } }));
      return;
    }
    if (req.url === '/api/agent/burner/sessions') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { sessions: [
        { agent_id: AGENT_ID, platform: 'douyin', role: 'burner', status: 'needs_rebind' },
      ] } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.account_verified, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('preflight：device_info 失败 → blocked', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const server = await startMockServer((req, res) => {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: 'NOT_CONNECTED' }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'preflight'], {
    PROFILES_FILE: profilesFile,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`,
    ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.errorCode, 'DEVICE_UNREACHABLE');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: FAIL — `adb-controller-bridge.sh` 不存在，spawn ENOENT 或 exit 非预期

- [ ] **Step 4: 写脚手架 + preflight 实现**

```bash
#!/usr/bin/env bash
# adb-controller-bridge.sh — OpenClaw douyin-phone-runtime skill 的 adb_controller 实现。
# 把 douyin-phone-runtime 要求的命令集转译到中台设备指令桥（phonectl.sh），
# 替代原来 SSH 到 xian-m1 本地跑 adb 的老路径。
#
# 用法: adb-controller-bridge.sh --profile <phone_profile> <command> [args...]
#
# 环境变量：
#   PROFILES_FILE             profile 映射文件（默认脚本同目录 profiles.json）
#   PHONECTL                  phonectl.sh 路径（默认脚本同目录）
#   ZENITHJOY_API_BASE        中台 API 基址
#   ZENITHJOY_INTERNAL_TOKEN  内部鉴权 token（必填，转发给 phonectl.sh）
#   OPENCLAW_EVIDENCE_DIR     evidence 落盘根目录（默认 /tmp/openclaw-evidence）
#   OPENCLAW_LOCK_TTL_SECONDS 设备锁孤儿超时（默认 1800）
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROFILES_FILE="${PROFILES_FILE:-$SCRIPT_DIR/profiles.json}"
PHONECTL="${PHONECTL:-$SCRIPT_DIR/phonectl.sh}"
ZENITHJOY_API_BASE="${ZENITHJOY_API_BASE:-https://autopilot.zenjoymedia.media}"
EVIDENCE_ROOT="${OPENCLAW_EVIDENCE_DIR:-/tmp/openclaw-evidence}"
LOCK_TTL_SECONDS="${OPENCLAW_LOCK_TTL_SECONDS:-1800}"

die() { echo "adb-controller-bridge: $1" >&2; exit "${2:-2}"; }
emit_ok() { echo "$1"; exit 0; }
emit_fail() { echo "$1"; exit "${2:-1}"; }

command -v jq >/dev/null 2>&1 || die "需要 jq"
command -v curl >/dev/null 2>&1 || die "需要 curl"
[ -n "${ZENITHJOY_INTERNAL_TOKEN:-}" ] || die "缺少 ZENITHJOY_INTERNAL_TOKEN"

[ $# -ge 2 ] || die "用法: --profile <phone_profile> <command> [args...]"
[ "$1" = "--profile" ] || die "第一个参数必须是 --profile"
PROFILE="$2"; shift 2
[ $# -ge 1 ] || die "缺少 command"
COMMAND="$1"; shift

[ -f "$PROFILES_FILE" ] || die "profiles 文件不存在: $PROFILES_FILE"
AGENT_ID=$(jq -r --arg p "$PROFILE" '.[$p].agent_id // empty' "$PROFILES_FILE")
TENANT_ID=$(jq -r --arg p "$PROFILE" '.[$p].tenant_id // empty' "$PROFILES_FILE")
[ -n "$AGENT_ID" ] || die "unknown profile: $PROFILE"

PROFILE_DIR="$EVIDENCE_ROOT/$PROFILE"
mkdir -p "$PROFILE_DIR"
LOCK_FILE="$PROFILE_DIR/.lock.json"

call_phonectl() {
  # 透传 phonectl.sh 的 stdout（JSON），把 exit code 存到 PHONECTL_EXIT
  local out
  out=$(bash "$PHONECTL" "$AGENT_ID" "$@" 2>/dev/null)
  PHONECTL_EXIT=$?
  PHONECTL_OUT="$out"
}

cmd_preflight() {
  call_phonectl device_info
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(jq -n '{ok:false,errorCode:"DEVICE_UNREACHABLE",detail:"device_info 失败"}')" 1
  fi
  local dinfo
  dinfo=$(echo "$PHONECTL_OUT" | jq -c '.data')
  local model foreground
  model=$(echo "$dinfo" | jq -r '.data.model // "unknown"')
  foreground=$(echo "$dinfo" | jq -r '.foregroundPkg // "unknown"')

  local sessions_http sessions_body
  sessions_body=$(mktemp)
  sessions_http=$(curl -sS -m 15 -o "$sessions_body" -w '%{http_code}' \
    "${ZENITHJOY_API_BASE}/api/agent/burner/sessions" \
    -H "X-Tenant-Id: ${TENANT_ID}" \
    -H "Authorization: Bearer ${ZENITHJOY_INTERNAL_TOKEN}")
  local account_verified="false"
  if [ "$sessions_http" = "200" ]; then
    account_verified=$(jq --arg aid "$AGENT_ID" \
      '[.data.sessions[]? | select(.agent_id==$aid and .platform=="douyin" and .role=="burner" and .status=="active")] | length > 0' \
      "$sessions_body")
  fi
  rm -f "$sessions_body"

  emit_ok "$(jq -n \
    --arg profile "$PROFILE" --arg serial "$AGENT_ID" --arg model "$model" \
    --arg fg "$foreground" --argjson verified "$account_verified" \
    '{ok:true, profile:$profile, serial:$serial, model:$model, adb_state:"device",
       call_state:"unknown", foreground_pkg:$fg, account_verified:$verified,
       warnings:["call_state 检测能力缺失，douyin-phone-runtime skill 要求 call_state!=idle 时安全停止，这里无法提供该判据，调用方需自行决定是否继续"]}')"
}

case "$COMMAND" in
  preflight) cmd_preflight ;;
  *) die "命令尚未实现: $COMMAND" ;;
esac
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 5 个测试全 PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/profiles.json scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "feat(openclaw): adb-controller-bridge 脚手架 + preflight 命令"
```

---

### Task 2: lock-acquire / lock-release / lock-status

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh`
- Modify: `scripts/openclaw/__tests__/adb-controller-bridge.test.js`

- [ ] **Step 1: 追加 failing test**

```js
test('lock-acquire：首次获取成功', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.acquired, true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('lock-acquire：同一 run_id 重入返回 already_owned', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.already_owned, true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('lock-acquire：不同 run_id 冲突 → LOCKED，exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-2'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.errorCode, 'LOCKED');
  assert.equal(out.owner, 'run-1');
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('lock-release：非 owner 释放 → NOT_OWNER，exit 1', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const r = await runBridge(['--profile', 'test-profile', 'lock-release', 'run-2'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.errorCode, 'NOT_OWNER');
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('lock-release：owner 释放成功，release 后 lock-status 显示 locked=false', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const rel = await runBridge(['--profile', 'test-profile', 'lock-release', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(rel.status, 0);
  const status = await runBridge(['--profile', 'test-profile', 'lock-status'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const out = JSON.parse(status.stdout);
  assert.equal(out.locked, false);
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('lock-acquire：过期孤儿锁（TTL=0）允许抢占', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-1'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  const r = await runBridge(['--profile', 'test-profile', 'lock-acquire', 'run-2'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    OPENCLAW_LOCK_TTL_SECONDS: '0',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.acquired, true);
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 新增的 6 个 lock 相关测试 FAIL（命令未实现，走 `die "命令尚未实现"` exit 2）

- [ ] **Step 3: 实现 lock-* 命令**

在 `cmd_preflight` 函数后追加：

```bash
now_epoch() { date -u +%s; }

cmd_lock_acquire() {
  local run_id="${1:-}"
  [ -n "$run_id" ] || die "lock-acquire 需要 run_id"
  if [ -f "$LOCK_FILE" ]; then
    local owner acquired_at age
    owner=$(jq -r '.owner' "$LOCK_FILE")
    acquired_at=$(jq -r '.acquired_at_epoch' "$LOCK_FILE")
    age=$(( $(now_epoch) - acquired_at ))
    if [ "$owner" = "$run_id" ]; then
      emit_ok "$(jq -n '{ok:true, acquired:true, already_owned:true}')"
    fi
    if [ "$age" -lt "$LOCK_TTL_SECONDS" ]; then
      emit_fail "$(jq -n --arg owner "$owner" '{ok:false,errorCode:"LOCKED",owner:$owner}')" 1
    fi
    # 孤儿锁超时，允许抢占，落到下面正常写入
  fi
  jq -n --arg owner "$run_id" --arg iso "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --argjson epoch "$(now_epoch)" \
    '{owner:$owner, acquired_at:$iso, acquired_at_epoch:$epoch}' > "$LOCK_FILE"
  emit_ok "$(jq -n '{ok:true, acquired:true}')"
}

cmd_lock_release() {
  local run_id="${1:-}"
  [ -n "$run_id" ] || die "lock-release 需要 run_id"
  if [ ! -f "$LOCK_FILE" ]; then
    emit_fail "$(jq -n '{ok:false,errorCode:"NOT_OWNER",detail:"锁不存在"}')" 1
  fi
  local owner
  owner=$(jq -r '.owner' "$LOCK_FILE")
  if [ "$owner" != "$run_id" ]; then
    emit_fail "$(jq -n --arg owner "$owner" '{ok:false,errorCode:"NOT_OWNER",owner:$owner}')" 1
  fi
  rm -f "$LOCK_FILE"
  emit_ok "$(jq -n '{ok:true, released:true}')"
}

cmd_lock_status() {
  if [ ! -f "$LOCK_FILE" ]; then
    emit_ok "$(jq -n '{ok:true, locked:false}')"
  fi
  local owner acquired_at age
  owner=$(jq -r '.owner' "$LOCK_FILE")
  acquired_at=$(jq -r '.acquired_at' "$LOCK_FILE")
  age=$(( $(now_epoch) - $(jq -r '.acquired_at_epoch' "$LOCK_FILE") ))
  emit_ok "$(jq -n --arg owner "$owner" --arg at "$acquired_at" --argjson age "$age" \
    '{ok:true, locked:true, owner:$owner, acquired_at:$at, age_seconds:$age}')"
}
```

在 `case "$COMMAND" in` 里追加分支（替换掉 Task 1 里的 `*) die ...` 之前插入）：

```bash
  lock-acquire) cmd_lock_acquire "$@" ;;
  lock-release) cmd_lock_release "$@" ;;
  lock-status) cmd_lock_status ;;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 全部 PASS（累计 Task1+Task2 共 11 个测试）

- [ ] **Step 5: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "feat(openclaw): adb-controller-bridge 加 lock-acquire/release/status"
```

---

### Task 3: open-app / snapshot / snapshot-evidence

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh`
- Modify: `scripts/openclaw/__tests__/adb-controller-bridge.test.js`

- [ ] **Step 1: 追加 failing test**

```js
import { readFileSync } from 'node:fs';

// 1x1 红色 PNG，base64（合法最小图片，供 snapshot 落盘断言用）
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('open-app：调用 phonectl launch 抖音包名', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  let capturedBody = null;
  const server = await startMockServer((req, res, body) => {
    capturedBody = JSON.parse(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true, foregroundPkg: 'com.ss.android.ugc.aweme', outcome: 'completed' } }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'open-app'], {
    PROFILES_FILE: profilesFile, ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  assert.equal(capturedBody.action, 'launch');
  assert.equal(capturedBody.pkg, 'com.ss.android.ugc.aweme');
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

test('snapshot-evidence：成功落盘 PNG 并返回路径+双分辨率', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  const server = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: true, data: {
      imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664,
    }, outcome: 'completed' } }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-001'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.captureWidth, 720);
  assert.equal(out.screenWidth, 1200);
  const written = readFileSync(out.path);
  assert.equal(written.toString('base64'), TINY_PNG_B64);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('snapshot-evidence：非法 EVIDENCE_ID 格式 → exit 2，不发请求', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'has space'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 2);
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('snapshot-evidence：phonectl screenshot 失败 → 透传错误，不落盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  const server = await startMockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'CAPTURE_FAILED', outcome: 'completed' } }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'snapshot-evidence', 'ev-002'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 新增 4 个测试 FAIL

- [ ] **Step 3: 实现 open-app / snapshot 系列**

追加函数：

```bash
cmd_open_app() {
  call_phonectl launch com.ss.android.ugc.aweme
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"LAUNCH_FAILED"}')" 1
  fi
  emit_ok "$(echo "$PHONECTL_OUT" | jq -c '.data | {ok:true, foregroundPkg:.foregroundPkg}')"
}

validate_evidence_id() {
  [[ "$1" =~ ^[A-Za-z0-9._-]+$ ]] || die "非法 EVIDENCE_ID: $1"
}

cmd_snapshot() {
  local evidence_id="${1:-}"
  local filename
  if [ -n "$evidence_id" ]; then
    validate_evidence_id "$evidence_id"
    filename="snapshot-${evidence_id}.png"
  else
    filename="snapshot-$(date +%s%N).png"
  fi
  call_phonectl screenshot
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"CAPTURE_FAILED"}')" 1
  fi
  local b64 cw ch sw sh out_path
  b64=$(echo "$PHONECTL_OUT" | jq -r '.data.data.imageBase64')
  cw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureWidth')
  ch=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureHeight')
  sw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenWidth')
  sh=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenHeight')
  out_path="$PROFILE_DIR/$filename"
  echo "$b64" | base64 -d > "$out_path"
  emit_ok "$(jq -n --arg path "$out_path" --argjson cw "$cw" --argjson ch "$ch" --argjson sw "$sw" --argjson sh "$sh" \
    '{ok:true, path:$path, captureWidth:$cw, captureHeight:$ch, screenWidth:$sw, screenHeight:$sh}')"
}
```

在 case 分支追加：

```bash
  open-app) cmd_open_app ;;
  snapshot) cmd_snapshot "" ;;
  snapshot-evidence) cmd_snapshot "${1:-}" ;;
```

> 注意：`call_phonectl` 返回的 `PHONECTL_OUT` 是 phonectl.sh 的原始 stdout（形如 `{"success":true,"data":{...}}`），所以这里取值路径是 `.data.data.imageBase64`（外层 `.data` 是中台 `OK()` 包装，内层 `.data` 是 devices.ts 里 `result.data`，即设备端 `CmdOutcome.data`）。`open-app` 同理用 `.data.foregroundPkg`（`foregroundPkg` 在中台响应里跟 `data` 同级，不在 `data` 里面——写实现时对照 `phonectl.sh` 真实返回样例核对一次字段路径，避免两层 `.data` 嵌套搞混）。

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 全部 PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "feat(openclaw): adb-controller-bridge 加 open-app/snapshot(-evidence)"
```

---

### Task 4: tap-evidence / swipe-evidence / back-evidence + UNSUPPORTED 命令

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh`
- Modify: `scripts/openclaw/__tests__/adb-controller-bridge.test.js`

- [ ] **Step 1: 追加 failing test**

```js
test('tap-evidence：动作成功 → 等待后截图存证，返回 action_ok', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let tapCalled = false, screenshotCalled = false;
  const server = await startMockServer((req, res, body) => {
    const b = JSON.parse(body);
    if (b.action === 'tap') { tapCalled = true; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
    if (b.action === 'screenshot') {
      screenshotCalled = true;
      res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } }));
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-1', '10'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  assert.ok(tapCalled); assert.ok(screenshotCalled);
  const out = JSON.parse(r.stdout);
  assert.equal(out.action_ok, true);
  assert.ok(out.path);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('tap-evidence：动作失败 → 不截图，直接透传错误', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let screenshotCalled = false;
  const server = await startMockServer((req, res, body) => {
    const b = JSON.parse(body);
    if (b.action === 'screenshot') { screenshotCalled = true; }
    res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: false, errorCode: 'DEVICE_BUSY', outcome: 'completed' } }));
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'tap-evidence', '600', '1300', 'ev-tap-2'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 1);
  assert.equal(screenshotCalled, false);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('swipe-evidence：成功路径调用 swipe 再截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let capturedSwipeBody = null;
  const server = await startMockServer((req, res, body) => {
    const b = JSON.parse(body);
    if (b.action === 'swipe') { capturedSwipeBody = b; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
    if (b.action === 'screenshot') { res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } })); return; }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'swipe-evidence', '600', '2000', '600', '500', '400', 'ev-swipe-1', '10'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  assert.equal(capturedSwipeBody.x1, 600); assert.equal(capturedSwipeBody.durationMs, 400);
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

test('back-evidence：成功路径调用 key back 再截图', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'acb-'));
  const profilesFile = makeProfilesFile(dir);
  const evDir = mkdtempSync(join(tmpdir(), 'acb-ev-'));
  let capturedKeyBody = null;
  const server = await startMockServer((req, res, body) => {
    const b = JSON.parse(body);
    if (b.action === 'key') { capturedKeyBody = b; res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, outcome: 'completed' } })); return; }
    if (b.action === 'screenshot') { res.writeHead(200); res.end(JSON.stringify({ success: true, data: { ok: true, data: { imageBase64: TINY_PNG_B64, captureWidth: 720, captureHeight: 1598, screenWidth: 1200, screenHeight: 2664 }, outcome: 'completed' } })); return; }
    res.writeHead(404); res.end('{}');
  });
  const { port } = server.address();
  const r = await runBridge(['--profile', 'test-profile', 'back-evidence', 'ev-back-1', '10'], {
    PROFILES_FILE: profilesFile, OPENCLAW_EVIDENCE_DIR: evDir,
    ZENITHJOY_API_BASE: `http://127.0.0.1:${port}`, ZENITHJOY_INTERNAL_TOKEN: 'tok',
  });
  assert.equal(r.status, 0);
  assert.equal(capturedKeyBody.key, 'back');
  server.close();
  rmSync(dir, { recursive: true, force: true });
  rmSync(evDir, { recursive: true, force: true });
});

for (const cmd of ['current-video-link', 'record-start', 'record-stop', 'record-status', 'record-extract-audio', 'ui-evidence']) {
  test(`${cmd}：本次范围不支持，exit 3`, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'acb-'));
    const profilesFile = makeProfilesFile(dir);
    const r = await runBridge(['--profile', 'test-profile', cmd], {
      PROFILES_FILE: profilesFile, ZENITHJOY_INTERNAL_TOKEN: 'tok',
    });
    assert.equal(r.status, 3);
    const out = JSON.parse(r.stdout);
    assert.equal(out.errorCode, 'UNSUPPORTED');
    rmSync(dir, { recursive: true, force: true });
  });
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 新增 10 个测试 FAIL

- [ ] **Step 3: 实现 tap/swipe/back-evidence + UNSUPPORTED**

追加函数：

```bash
cmd_tap_evidence() {
  local x="$1" y="$2" evidence_id="$3" wait_ms="${4:-800}"
  validate_evidence_id "$evidence_id"
  call_phonectl tap "$x" "$y"
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"TAP_FAILED"}')" 1
  fi
  sleep "$(awk "BEGIN{print $wait_ms/1000}")"
  local snap_json ok_flag
  snap_json=$(cmd_snapshot_capture "$evidence_id") || { emit_fail "$snap_json" 1; }
  emit_ok "$(echo "$snap_json" | jq -c '. + {action_ok:true}')"
}

cmd_swipe_evidence() {
  local x1="$1" y1="$2" x2="$3" y2="$4" duration_ms="$5" evidence_id="$6" wait_ms="${7:-800}"
  validate_evidence_id "$evidence_id"
  call_phonectl swipe "$x1" "$y1" "$x2" "$y2" "$duration_ms"
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"SWIPE_FAILED"}')" 1
  fi
  sleep "$(awk "BEGIN{print $wait_ms/1000}")"
  local snap_json
  snap_json=$(cmd_snapshot_capture "$evidence_id") || { emit_fail "$snap_json" 1; }
  emit_ok "$(echo "$snap_json" | jq -c '. + {action_ok:true}')"
}

cmd_back_evidence() {
  local evidence_id="$1" wait_ms="${2:-800}"
  validate_evidence_id "$evidence_id"
  call_phonectl key back
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    emit_fail "$(echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"KEY_FAILED"}')" 1
  fi
  sleep "$(awk "BEGIN{print $wait_ms/1000}")"
  local snap_json
  snap_json=$(cmd_snapshot_capture "$evidence_id") || { emit_fail "$snap_json" 1; }
  emit_ok "$(echo "$snap_json" | jq -c '. + {action_ok:true}')"
}

cmd_unsupported() {
  emit_fail "$(jq -n --arg c "$COMMAND" '{ok:false,errorCode:"UNSUPPORTED",detail:("本次范围（keyword_acquisition Step②③）不支持: "+$c)}')" 3
}
```

> **重构说明**：`cmd_snapshot` 需要拆出一个不直接 `emit_ok`/退出的子函数 `cmd_snapshot_capture`（返回 JSON 字符串到 stdout，失败时返回非0并把错误 JSON 打到 stdout），供 `cmd_snapshot`（顶层命令）和 `cmd_tap_evidence`/`cmd_swipe_evidence`/`cmd_back_evidence`（内部复用截图逻辑）共用，避免 `emit_ok/emit_fail` 的 `exit` 语义在被复用时提前终止整个脚本。修改 Task 3 里的 `cmd_snapshot`：

```bash
cmd_snapshot_capture() {
  # 不 exit，成功打印 JSON 到 stdout 返回 0；失败打印错误 JSON 到 stdout 返回 1
  local evidence_id="${1:-}"
  local filename
  if [ -n "$evidence_id" ]; then
    filename="snapshot-${evidence_id}.png"
  else
    filename="snapshot-$(date +%s%N).png"
  fi
  call_phonectl screenshot
  if [ "$PHONECTL_EXIT" -ne 0 ]; then
    echo "$PHONECTL_OUT" | jq -c '. // {ok:false,errorCode:"CAPTURE_FAILED"}'
    return 1
  fi
  local b64 cw ch sw sh out_path
  b64=$(echo "$PHONECTL_OUT" | jq -r '.data.data.imageBase64')
  cw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureWidth')
  ch=$(echo "$PHONECTL_OUT" | jq -r '.data.data.captureHeight')
  sw=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenWidth')
  sh=$(echo "$PHONECTL_OUT" | jq -r '.data.data.screenHeight')
  out_path="$PROFILE_DIR/$filename"
  echo "$b64" | base64 -d > "$out_path"
  jq -n --arg path "$out_path" --argjson cw "$cw" --argjson ch "$ch" --argjson sw "$sw" --argjson sh "$sh" \
    '{ok:true, path:$path, captureWidth:$cw, captureHeight:$ch, screenWidth:$sw, screenHeight:$sh}'
  return 0
}

cmd_snapshot() {
  local evidence_id="${1:-}"
  [ -n "$evidence_id" ] && validate_evidence_id "$evidence_id"
  local out
  out=$(cmd_snapshot_capture "$evidence_id")
  local rc=$?
  if [ "$rc" -ne 0 ]; then emit_fail "$out" 1; fi
  emit_ok "$out"
}
```

在 case 分支追加（放在 `*) die ...` 之前）：

```bash
  tap-evidence) cmd_tap_evidence "$@" ;;
  swipe-evidence) cmd_swipe_evidence "$@" ;;
  back-evidence) cmd_back_evidence "$@" ;;
  current-video-link|record-start|record-stop|record-status|record-extract-audio|ui-evidence) cmd_unsupported ;;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `node --test scripts/openclaw/__tests__/adb-controller-bridge.test.js`
Expected: 全部 PASS（累计约 25 个测试）

- [ ] **Step 5: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh scripts/openclaw/__tests__/adb-controller-bridge.test.js
git commit -m "feat(openclaw): adb-controller-bridge 加 tap/swipe/back-evidence + UNSUPPORTED 命令"
```

---

### Task 5: chmod +x + CI 确认 + PR 描述里的已知缺口

**Files:**
- Modify: `scripts/openclaw/adb-controller-bridge.sh`（权限）

- [ ] **Step 1: 赋可执行权限**

```bash
chmod +x scripts/openclaw/adb-controller-bridge.sh
```

- [ ] **Step 2: 本地全量跑一次测试确认无回归**

Run: `node --test scripts/openclaw/**/*.test.js`
Expected: `phonectl.test.js` + `adb-controller-bridge.test.js` 全部 PASS（确认没有破坏 phonectl.sh 自身的测试）

- [ ] **Step 3: Commit**

```bash
git add scripts/openclaw/adb-controller-bridge.sh
git commit -m "chore(openclaw): adb-controller-bridge.sh 加可执行权限"
```

- [ ] **Step 4: 真机验证（手动，不进 CI）**

```bash
export ZENITHJOY_API_BASE=https://staging-autopilot.zenjoymedia.media
export ZENITHJOY_INTERNAL_TOKEN=<内部token>
bash scripts/openclaw/adb-controller-bridge.sh --profile realmachine-smoke preflight
bash scripts/openclaw/adb-controller-bridge.sh --profile realmachine-smoke snapshot-evidence manual-check-1
bash scripts/openclaw/adb-controller-bridge.sh --profile realmachine-smoke tap-evidence 600 1300 manual-check-2
```

确认 `preflight` 返回真实设备信息、`snapshot-evidence`/`tap-evidence` 在 `/tmp/openclaw-evidence/realmachine-smoke/` 下产出可打开的 PNG。把这一步的实际输出（或截图）贴进 PR description，作为真机验证记录（不是自动化 CI gate，是手动记录，同 `phonectl.sh` 当初的验证方式）。

---

## 收尾：PR description 必须包含的内容

- 归位：`customer_app/line02/keyword_acquisition` 置换，范围仅 Step②③
- 已知缺口清单（照抄设计文档「已知缺口」一节）：call_state 无法检测、current-video-link/record-* 不支持、screenshot 依赖 phonectl.sh 已知 bug（验证时避免同时开上墙）、profiles.json 手动维护
- 真机验证记录（Task 5 Step 4 的实际输出）
- GP-Anchor: `line02/keyword_acquisition keep-green`
