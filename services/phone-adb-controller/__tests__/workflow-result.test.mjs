import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WFR = join(HERE, "..", "workflow-result.sh");
const LEDGER = join(HERE, "..", "ledger.mjs");
const JQ = spawnSync("bash", ["-lc", "command -v jq"], { encoding: "utf8" }).stdout.trim();

function env(home) {
  // WFR_BRAIN_ENV 指向不存在的文件：开发机 ~/.credentials/brain.env 真实存在，不隔离会把测试工件回执到生产 Brain
  return { ...process.env, WFR_HOME: home, WFR_NODE: process.execPath, WFR_JQ: JQ, WFR_LEDGER_MJS: LEDGER, WFR_SCP_TARGET: "", WFR_BRAIN_ENV: join(home, "no-brain.env"), BRAIN_URL: "", BRAIN_INTERNAL_TOKEN: "", WFR_BRAIN_TASK_ID: "",
    // 6b133a81 起默认 8 个 stage 全读回(含 init 的 preflight):测试默认关掉,需要读回的用例经 PROBE_ENV 显式打开,绝不连真 mmv
    WFR_PROBE_STAGES: "" };
}
// 假 curl：PATH 前置，记录argv及真实stdin正文为一行JSON；默认回 body+"\n200"（对应 -w '\n%{http_code}'），fail=true 时模拟连不上（exit 7 + raw 错误）
function fakeCurl(dir, { fail = false } = {}) {
  const bin = join(dir, "bin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "curl.calls");
  writeFileSync(join(bin, "curl"), `#!/usr/bin/env bash
python3 -c 'import json,sys;a=sys.argv[1:];a.extend(["--test-stdin-json",sys.stdin.read()] if "--data-binary" in a else []);print(json.dumps(a))' "$@" >> "${calls}"
${fail ? 'echo "curl: (7) Failed to connect to brain.test port 5221: Connection refused" >&2; exit 7' : "printf '{\"success\":true}\\n200'"}
`);
  chmodSync(join(bin, "curl"), 0o755);
  return { PATH: `${bin}:${process.env.PATH}`, calls };
}
// 只看回执（execution-callback）：④b 起同一假 curl 还会记 span 上报与活动表 GET，那些由 workflow-result-span.test.mjs 断言
function curlCalls(calls) { return existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((a) => a.some((x) => String(x).includes("/api/brain/execution-callback"))) : []; }
function argAfter(args, flag) { const i = args.indexOf(flag === "-d" && !args.includes("-d") ? "--test-stdin-json" : flag); return i >= 0 ? args[i + 1] : undefined; }
const BRAIN = { BRAIN_URL: "http://brain.test:5221", BRAIN_INTERNAL_TOKEN: "tok-brain", WFR_BRAIN_TASK_ID: "11111111-1111-4111-8111-111111111111" };
function brainEnv(dir, opts) { const c = fakeCurl(dir, opts); return { env: { ...BRAIN, PATH: c.PATH }, calls: c.calls }; }
function wfr(home, extra, ...args) {
  const r = spawnSync("bash", [WFR, ...args], { encoding: "utf8", env: { ...env(home), ...extra } });
  const kv = Object.fromEntries(r.stdout.split("\n").filter((l) => /^WFR_[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1)]; }));
  return { code: r.status, kv, err: r.stderr };
}
function words(dir, list) { const f = join(dir, "kw.txt"); writeFileSync(f, list.join("\n") + "\n"); return f; }
function artifacts(kv) { return readdirSync(kv.WFR_ART_DIR).filter((f) => f.endsWith(".worker-result.json")).sort(); }
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0; // root 无视权限位，chmod 000 测试对它无意义

test("逐词 collection 回执分开记账：首词 blocked 不吞成功词，同词重发保持幂等身份", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-word-receipt-"));
  try {
    const b = brainEnv(d);
    const i = wfr(d, {}, "init", "auto10010315", "p1", words(d, ["无候选", "企业AI办公"]), "1", "S", "h");
    const extra = { ...i.kv, ...b.env, WFR_ATTEMPT: "a1" };
    const metrics = (count) => JSON.stringify({ comments_collected: count, videos_processed: count, cursor_updates: 0, rescan_count: 0, rescan_rate: 0 });
    const ev = '[{"type":"log","ref":"night-auto10010315.log"}]';
    wfr(d, extra, "stage", "collection", "blocked", "1", "no_cards", ev, metrics(0), "无候选");
    wfr(d, extra, "stage", "collection", "completed", "2", "采集完成", ev, metrics(2), "企业AI办公");
    wfr(d, extra, "stage", "collection", "completed", "2", "采集完成", ev, metrics(2), "企业AI办公");
    const bodies = curlCalls(b.calls).map((args) => JSON.parse(argAfter(args, "-d")));
    assert.equal(bodies.length, 2, "ack后同一实例不重复POST");
    assert.equal(bodies[0].result.stage_status, "blocked");
    assert.equal(bodies[1].result.stage_status, "completed");
    assert.notEqual(bodies[0].run_id, bodies[1].run_id, "不同活动实例必须各自触发 run.finished");
    assert.equal(new Set(bodies.map(b=>b.run_id)).size, 2, "同一实例重发不能制造重复运行");
    assert.equal(bodies[1].run_id, "social-keyword-leadgen-crontab-auto10010315__a1.collection.2");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("hash: 同词单不同 TAG 相同；顺序无关；改一词即变；不含 SERIAL", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const a = wfr(d, {}, "hash", "p1", words(d, ["A", "B"]), "1").kv.WFR_HASH;
  const b = wfr(d, {}, "hash", "p1", words(d, ["B", "A"]), "1").kv.WFR_HASH;
  const c = wfr(d, {}, "hash", "p1", words(d, ["A", "C"]), "1").kv.WFR_HASH;
  assert.equal(a.length, 64); assert.equal(a, b); assert.notEqual(a, c);
});

test("init: 只写 preflight(completed)——6b133a81 起不再写 qualification/scoring 的 not_in_profile 占位，导出 RUN_ID/HASH/DIR", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const r = wfr(d, { DEVICE_VERIFIED: "1", ACCOUNT_VERIFIED: "1", CALL_STATE_IDLE: "1", LOCK_ACQUIRED: "1" }, "init", "auto0921", "p1", words(d, ["A"]), "1", "SER1", "xian-m4");
  assert.equal(r.code, 0);
  assert.equal(r.kv.WFR_RUN_ID, "social-keyword-leadgen-crontab-auto0921");
  const files = artifacts(r.kv);
  assert.deepEqual(files, ["social-keyword-leadgen-crontab-auto0921__a0.preflight.1.worker-result.json"]);
  const pf = JSON.parse(readFileSync(join(r.kv.WFR_ART_DIR, files[0]), "utf8"));
  assert.equal(pf.schema_version, 2); assert.equal(pf.status, "completed"); assert.equal(pf.recommended_next_action, "accept");
  assert.equal(pf.task_request_hash, r.kv.WFR_HASH); assert.ok(pf.evidence.length >= 1);
  for (const k of ["external_interactions", "business_reads", "business_writes", "artifact_writes"]) assert.equal(pf.metrics[k], 0);
  for (const k of ["device_verified", "account_verified", "call_state_idle", "lock_acquired"]) assert.equal(pf.metrics[k], 1, `${k} 取 harvest-cron 导出的真实预检结果`);
});

// ── 棒3b-2 探针读回改经 ssh 在 MMV 跑（决策 8f38f5fd）：leadgen PG / 飞书凭据只在 MMV，执行机本地跑 verify-step 必 error ──
// 假 ssh：PATH 前置，把每次 argv 记成一行 JSON，回放 canned 到 stdout（rc 非零时模拟连不上/超时，stderr 给一行）
function fakeSsh(dir, { canned = "", rc = 0 } = {}) {
  const bin = join(dir, "sshbin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "ssh.calls");
  const cannedFile = join(dir, "ssh.canned"); writeFileSync(cannedFile, `${canned}\n`); // 走文件回放：canned 可含多行（远端噪音 + 末行 JSON）
  writeFileSync(join(bin, "ssh"), `#!/usr/bin/env bash
python3 -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "$@" >> "${calls}"
${rc ? `echo "ssh: connect to host mmv port 22: Operation timed out" >&2; exit ${rc}` : `cat "${cannedFile}"`}
`);
  chmodSync(join(bin, "ssh"), 0o755);
  return { bin, calls };
}
function sshCalls(calls) { return existsSync(calls) ? readFileSync(calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []; }
// 假 node：本机 node 绝不该再拉起 verify-step（它已迁到 MMV）；命中就记账并输出会被误合并的 probes
function fakeNode(dir) {
  const bin = join(dir, "nodebin"); mkdirSync(bin, { recursive: true });
  const calls = join(dir, "node.calls");
  const node = join(bin, "node");
  writeFileSync(node, `#!/usr/bin/env bash
case "$*" in
  *verify-step.mjs*)echo "$*" >> "${calls}"; printf '{"stage":"delivery","probes":[{"key":"local","observed":1,"probed_at":"x"}]}\\n';;
  *) exec "${process.execPath}" "$@";;
esac
`);
  chmodSync(node, 0o755);
  return { WFR_NODE: node, calls };
}
// 探针相关 env 全部指向不存在的路径：本机不再需要 checks YAML / 凭据文件，测试也不许碰开发机真实文件
const PROBE_ENV = (d) => ({ WFR_CHECKS_YAML: join(d, "no-checks.yaml"), WFR_PROBE_STAGES: "delivery scoring" });
const DELIVERY_ARGS = ["delivery", "completed", "1", "pushed 2 leads", '[{"type":"log","ref":"n.log"}]', '{"leads_written":2,"videos_pushed":1,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'];
const CANNED = JSON.stringify({ stage: "delivery", probes: [{ key: "videos_readback", observed: 7, probed_at: "2026-09-26T00:00:00.000Z" }, { key: "comments_readback", observed: 22, probed_at: "2026-09-26T00:00:00.000Z" }, { key: "line_key_not_null", observed: ["jinuo"], probed_at: "2026-09-26T00:00:00.000Z" }] });
function probeRun(d, tag, profile, { ssh, node, extra = {}, stageArgs = DELIVERY_ARGS, push = "1" }) {
  const i = wfr(d, {}, "init", tag, profile, words(d, ["A"]), push, "S", "h");
  const e = wfr(d, i.kv, "enter");
  const b = brainEnv(d);
  const s = wfr(d, { ...i.kv, ...e.kv, ...b.env, ...PROBE_ENV(d), PATH: `${ssh.bin}:${b.env.PATH}`, WFR_NODE: node.WFR_NODE, ...extra }, "stage", ...stageArgs);
  return { i, s, b };
}

test("init: 额外导出 WFR_TAG / WFR_PROFILE（stage 钩子据此传 --run-tag/--line-key）", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const i = wfr(d, {}, "init", "t15", "jinoshengyuan-work", words(d, ["A"]), "1", "S", "h");
  assert.equal(i.kv.WFR_TAG, "t15"); assert.equal(i.kv.WFR_PROFILE, "jinoshengyuan-work");
});

test("stage delivery: 经 ssh 在 MMV 跑 verify-step（形状同 batch2.sh:55 推 push-videos），probes 合进回执 result.probes；本机 node 不碰 verify-step", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: CANNED }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "auto09252230", "jinoshengyuan-work", { ssh, node });
  assert.equal(s.code, 0);
  const calls = sshCalls(ssh.calls);
  assert.equal(calls.length, 1, "delivery 恰好一次 ssh");
  const av = calls[0];
  assert.equal(argAfter(av, "-o"), "ConnectTimeout=20", "照 batch2.sh:55 带 ConnectTimeout=20");
  assert.equal(av[av.length - 2], "mmv", "默认主机 mmv");
  const remote = av[av.length - 1];
  assert.ok(remote.startsWith("set -a; source ~/.credentials/zenithjoy-db.env 2>/dev/null; set +a; "), `远端先 source 凭据：${remote}`);
  assert.ok(remote.includes("cd ~/.openclaw/leadgen-scripts && node verify-step.mjs "), `默认目录 ~/.openclaw/leadgen-scripts：${remote}`);
  assert.match(remote, /--stage 'delivery' --run-tag 'auto09252230' --line-key 'jinoshengyuan-work' --word ''/, `参数形状：${remote}`);
  assert.ok(!remote.includes("--checks"), "checks 走 MMV 侧默认路径，不再传 --checks");
  assert.equal(sshCalls(node.calls).length, 0, "本机 node 不该再拉起 verify-step");
  const curls = curlCalls(b.calls);
  assert.equal(curls.length, 1);
  const body = JSON.parse(argAfter(curls[0], "-d"));
  assert.deepEqual(body.result.probes, JSON.parse(CANNED).probes);
  assert.equal(body.result.stage, "delivery"); assert.equal(body.result.metrics.leads_written, 2);
});

test("stage delivery: videos_pushed 是闭集键——缺它工件被拒（不落文件、不回执），带它则通过", { skip: !JQ && "no jq" }, () => {
  const old = ["delivery", "completed", "1", "x", '[{"type":"log","ref":"n.log"}]', '{"leads_written":2,"duplicates_skipped":0,"readback_verified":0,"cursor_updates":0}'];
  const d1 = mkdtempSync(join(tmpdir(), "wfr-"));
  const r1 = probeRun(d1, "t30", "p1", { ssh: fakeSsh(d1, { canned: CANNED }), node: fakeNode(d1), stageArgs: old });
  assert.match(r1.s.err, /WFR_WARN.*invalid/);
  const f1 = join(r1.i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t30__a1.delivery.1.worker-result.json");
  assert.ok(!existsSync(f1), "缺 videos_pushed 的旧形状被拒");
  assert.equal(curlCalls(r1.b.calls).length, 0, "被拒的工件不回执");
  const d2 = mkdtempSync(join(tmpdir(), "wfr-"));
  const r2 = probeRun(d2, "t30", "p1", { ssh: fakeSsh(d2, { canned: CANNED }), node: fakeNode(d2), stageArgs: DELIVERY_ARGS });
  assert.equal(r2.s.err.includes("invalid"), false, r2.s.err);
  assert.equal(JSON.parse(readFileSync(join(r2.i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t30__a1.delivery.1.worker-result.json"), "utf8")).metrics.videos_pushed, 1);
});

// 6b133a81：blocked 工件（PUSH=0 的 delivery、没跑到的阶段）同样读回判探针——占位不再豁免；
// 读回 0 == 期望 0 的场景由探针自己定义（blocked 且确实没写业务数据时本就该过）。
test("stage blocked/completed/failed 一律读回，probes 合进回执", { skip: !JQ && "no jq" }, () => {
  for (const status of ["blocked", "completed", "failed"]) {
    const d2 = mkdtempSync(join(tmpdir(), "wfr-"));
    const ssh2 = fakeSsh(d2, { canned: CANNED }); const node2 = fakeNode(d2);
    const r = probeRun(d2, "t32", "p1", { ssh: ssh2, node: node2, stageArgs: [...DELIVERY_ARGS.slice(0, 1), status, ...DELIVERY_ARGS.slice(2)] });
    assert.equal(r.s.code, 0);
    assert.equal(sshCalls(ssh2.calls).length, 1, `${status} 读回`);
    assert.deepEqual(JSON.parse(argAfter(curlCalls(r.b.calls)[0], "-d")).result.probes, JSON.parse(CANNED).probes, status);
  }
});

test("init: 不再写 qualification/scoring 占位工件，只有 preflight 一次回执", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: CANNED });
  const b = brainEnv(d);
  const i = wfr(d, { ...b.env, ...PROBE_ENV(d), PATH: `${ssh.bin}:${b.env.PATH}` }, "init", "t33", "p1", words(d, ["A"]), "1", "S", "h");
  assert.equal(i.code, 0);
  const stages = curlCalls(b.calls).map((c) => JSON.parse(argAfter(c, "-d")).result.stage);
  assert.deepEqual(stages, ["preflight"]);
});

test("stage delivery: WFR_PROBE_HOST / WFR_PROBE_DIR 可覆盖主机与目录；--word 带中文与单引号照单引号包裹", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: CANNED }); const node = fakeNode(d);
  const { s } = probeRun(d, "t20", "yueshengyun-work", { ssh, node, extra: { WFR_PROBE_HOST: "probe-host", WFR_PROBE_DIR: "/srv/leadgen" }, stageArgs: [...DELIVERY_ARGS, "AI训练师 it's"] });
  assert.equal(s.code, 0);
  const av = sshCalls(ssh.calls)[0];
  assert.equal(av[av.length - 2], "probe-host");
  const remote = av[av.length - 1];
  assert.ok(remote.includes("cd /srv/leadgen && node verify-step.mjs "), remote);
  assert.ok(remote.includes("--line-key 'yueshengyun-work' --word 'AI训练师 it'\\''s'"), remote);
});

test("stage discovery: YAML 无该 stage 探针（本机无 YAML 时按 WFR_PROBE_STAGES 兜底闸）→ 不 ssh，probes 仍 []", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: '{"stage":"discovery","probes":[{"key":"bogus","observed":1,"probed_at":"x"}]}' }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "t16", "p1", { ssh, node, push: "0", stageArgs: ["discovery", "completed", "1", "ok", '[{"type":"log","ref":"n.log"}]', '{"candidates":1,"keywords_processed":1,"screens_scanned":0}', "A"] });
  assert.equal(s.code, 0);
  assert.equal(sshCalls(ssh.calls).length, 0, "discovery 不该 ssh");
  assert.deepEqual(JSON.parse(argAfter(curlCalls(b.calls)[0], "-d")).result.probes, []);
});

test("stage delivery: ssh 超时/非零 / 输出非 JSON / 末行 JSON 无 probes 数组 → probes 保持 []、记 WFR_WARN、exit 0、回执照发", { skip: !JQ && "no jq" }, () => {
  const cases = [
    { name: "ssh 超时", ssh: (d) => fakeSsh(d, { rc: 255 }) },
    { name: "输出非 JSON", ssh: (d) => fakeSsh(d, { canned: "zsh: command not found: node" }) },
    { name: "无 probes 数组", ssh: (d) => fakeSsh(d, { canned: '{"stage":"delivery","probes":"nope"}' }) },
  ];
  for (const c of cases) {
    const d = mkdtempSync(join(tmpdir(), "wfr-"));
    const ssh = c.ssh(d); const node = fakeNode(d);
    const { i, s, b } = probeRun(d, "t17", "p1", { ssh, node });
    assert.equal(s.code, 0, c.name);
    assert.match(s.err, /WFR_WARN.*verify-step/, `${c.name}: 缺 WFR_WARN`);
    const calls = curlCalls(b.calls);
    assert.equal(calls.length, 1, `${c.name}: 回执仍要发`);
    assert.deepEqual(JSON.parse(argAfter(calls[0], "-d")).result.probes, [], c.name);
    assert.ok(existsSync(join(i.kv.WFR_ART_DIR, "social-keyword-leadgen-crontab-t17__a1.delivery.1.worker-result.json")), `${c.name}: 工件照写`);
  }
});

test("stage delivery: 远端 stderr 噪音夹在 stdout 前也只取末行 JSON", { skip: !JQ && "no jq" }, () => {
  const d = mkdtempSync(join(tmpdir(), "wfr-"));
  const ssh = fakeSsh(d, { canned: `line-route: jinuo base=x\n${CANNED}` }); const node = fakeNode(d);
  const { s, b } = probeRun(d, "t21", "p1", { ssh, node });
  assert.equal(s.code, 0);
  assert.deepEqual(JSON.parse(argAfter(curlCalls(b.calls)[0], "-d")).result.probes, JSON.parse(CANNED).probes);
});
