// harvest-keyword.sh 锁被占不重试直接放弃回归测试(0930 夜实测发现)。
// 事故形状：夜间生产批次 auto09292304 里，另一条合法功能(discover-benchmark.sh 对标发现)
// 持续持有同一台设备的锁约 5 分钟；harvest-keyword.sh 的 lock-acquire 只试一次，失败就
// `log "锁被占,退出"; exit 3`——12 个关键词里词7-12 全部因这一把锁被连续跳过，一整批
// 只跑完一半，且没有任何补跑机制。用户要求"所有词都要真正跑完，不能因为设备并发丢词"。
// 修法：lock-acquire 改成限时轮询重试(LOCK_ACQUIRE_MAX_RETRIES × LOCK_ACQUIRE_POLL_SECONDS，
// 默认 24×20s=8分钟，覆盖实测约5分钟的持锁时长)，重试期间用尽仍拿不到才保留原退出码3语义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FAKE_SSH_QUAL, FAKE_SCP } from "./qual-fakes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 假 douyin-phone-adb：lock-acquire 前 LOCKACQUIRE_FAIL_COUNT 次装作"锁被别人持有"失败，
// 之后才成功；每次调用计数写文件，供测试断言真的重试了几次。
const FAKE_ADB = `#!/bin/sh
shift; shift
CMD="$1"; shift
case "$CMD" in
  lock-acquire)
    cnt="$HOME/lockacquire-count"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
    if [ "$n" -le "\${LOCKACQUIRE_FAIL_COUNT:-0}" ]; then echo "lock is held by another run: bench-verify-0930 age=5s/ttl=1800s" >&2; exit 1; fi
    printf 'lock=acquired owner=TAG\\n'; exit 0;;
  lock-refresh) printf 'lock=refreshed owner=TAG ttl=1800s\\n'; exit 0;;
  lock-release) printf 'lock=released owner=TAG\\n'; exit 0;;
  open-app) exit 0;;
  open-search) exit 0;;
  search-video-tab) exit 0;;
  search-time-layer) exit 0;;
  search-video-cards) exit 0;;
esac
exit 0`;

const FAKE_SSH = FAKE_SSH_QUAL;

function setup(extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "hklockretry-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB);
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  writeFileSync(join(home, ".local", "bin", "scp"), FAKE_SCP);
  chmodSync(join(home, ".local", "bin", "scp"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", ...extraEnv };
  return { home, env };
}

test("锁第1次被占 → 不再一次性放弃，会重试(第2次拿到锁后正常收工)", { skip: SKIP }, () => {
  const { home, env } = setup({ LOCKACQUIRE_FAIL_COUNT: "1" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.notEqual(r.status, 3, `不该在第1次失败就退出3, stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockacquire-count"), "utf8").trim());
  assert.ok(n >= 2, `应至少重试到第2次才拿到锁, 实际调用次数=${n}`);
});

test("锁连续被占3次、第4次才拿到 → 重试到位后正常收工，不放弃该关键词", { skip: SKIP }, () => {
  const { home, env } = setup({ LOCKACQUIRE_FAIL_COUNT: "3" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.notEqual(r.status, 3, `重试应该成功拿到锁, stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockacquire-count"), "utf8").trim());
  assert.equal(n, 4, `应重试到第4次才成功, 实际调用次数=${n}`);
});

test("锁持续被占超过重试上限 → 用尽重试后仍保留退出码3(不会无限等)", { skip: SKIP }, () => {
  const { home, env } = setup({ LOCKACQUIRE_FAIL_COUNT: "999", LOCK_ACQUIRE_MAX_RETRIES: "3" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.equal(r.status, 3, `应保留原退出码3语义(batch2.sh 依赖此契约), stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockacquire-count"), "utf8").trim());
  assert.equal(n, 3, `应该真的重试满LOCK_ACQUIRE_MAX_RETRIES次才放弃, 实际调用次数=${n}`);
  assert.match(r.stderr, /重试.*次.*(仍未拿到|退出)/, `退出前应留痕说明重试过, stderr=${r.stderr}`);
});

test("锁一开始就是空闲 → 一次拿到，不产生多余的重试日志", { skip: SKIP }, () => {
  const { home, env } = setup();
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.notEqual(r.status, 3, `stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockacquire-count"), "utf8").trim());
  assert.equal(n, 1, `锁空闲时不该重试, 实际调用次数=${n}`);
});
