// services/phone-adb-controller/__tests__/wall-helpers.mjs
// 假 adb + 假中台 + 最小合法 JPEG，供三个单测与 smoke harness 共用
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

/** 异步跑一段 bash（假中台与测试同进程，禁用 spawnSync：它会阻塞事件循环，curl 永远等不到响应） */
export function runBash(script, env, { bash = process.env.WALL_TEST_BASH || 'bash', timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const p = spawn(bash, ['-c', script], { env });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; p.kill('SIGKILL'); }, timeoutMs); // 脚本自旋时不让测试挂死
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', (e) => { clearTimeout(timer); resolve({ status: -1, stdout, stderr: String(e), timedOut }); }); // bash 不存在时不挂死
    p.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr, timedOut }); });
  });
}

// 1×1 灰 JPEG（FFD8 开头，服务端只看大小不解码）
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDA0MDAsLDBEODw0RFRUWFhURFBQXGh0dHRoaGRkcHSAgICAeIiIiIiIiIiIiIiIiIiL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AN//Z',
  'base64',
);

const tmpDirs = [];
process.on('exit', () => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

export function makeTmp() {
  const d = mkdtempSync(join(tmpdir(), 'wall-'));
  tmpDirs.push(d);
  return d;
}

/** 造一个假 adb：devices 列出 serials；exec-out screencap 输出 jpegBytes；dumpsys window 给前台包（focusLine 可覆盖，如锁屏 mCurrentFocus=null） */
export function makeFakeAdb(dir, {
  serials = ['SER1'], jpegBytes = TINY_JPEG, offline = [],
  focusLine = '  mCurrentFocus=Window{c2d79ba u0 com.ss.android.ugc.aweme/com.ss.android.ugc.aweme.main.MainActivity}',
} = {}) {
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
case " ${offline.join(' ')} " in *" $S "*) [ "$1" = "get-state" ] && exit 1;; esac
if [ "$1" = "get-state" ]; then echo device; exit 0; fi
if [ "$1" = "exec-out" ]; then cat "${img}"; exit 0; fi
if [ "$1" = "shell" ] && [ "$2" = "dumpsys" ]; then echo '${focusLine}'; exit 0; fi
exit 0
`,
  );
  chmodSync(adb, 0o755);
  return adb;
}

/** 直通"缩图"：把输入原样拷到输出（输入已是 JPEG）；每次调用的 4 个参数追加一行到 <dir>/convert.calls */
export function makePassthroughConvert(dir) {
  const p = join(dir, 'convert.sh');
  writeFileSync(p, `#!/usr/bin/env bash\necho "$1 $2 $3 $4" >> "${dir}/convert.calls"\ncp "$1" "$2"\n`);
  chmodSync(p, 0o755);
  return p;
}

/** 假中台：记录全部请求；tasks 端点可按次序返回 409；frame 端点可按次序返回状态码（默认 202） */
export function startFakeApi({ busyCodes = [], frameCodes = [] } = {}) {
  const requests = [];
  const uuid = randomUUID();
  const taskId = randomUUID();
  let taskCalls = 0;
  let frameCalls = 0;
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const rec = { method: req.method, url: req.url, headers: req.headers, body };
      requests.push(rec);
      const send = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/api/agent/register') return send(200, { ok: true, success: true, agent_id: uuid, registered_machine_id: JSON.parse(body.toString()).machine_id });
      if (/^\/api\/workers\/[^/]+\/frame$/.test(req.url)) {
        const code = frameCodes[frameCalls++] ?? 202;
        return code === 202 ? send(202, { success: true, data: { seq: requests.length } }) : send(code, { success: false, error: { code: 'FRAME_REJECTED' } });
      }
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
