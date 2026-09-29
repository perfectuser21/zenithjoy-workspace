// harvest-keyword.sh 锁心跳/放锁失败可见性回归测试（0929 DoD 审计发现）。
// 事故形状：lock-refresh/lock-release 的输出+退出码此前全丢进 /dev/null 且 `|| true`
// 吞掉失败——TTL(1800s)到点没人知道续期一直在失败，直到锁被别的轮次抢走才现形；
// 0928 夜实证过一次真实撞车（两条并发批次同时驱动同一台设备）。放锁失败同理会漏锁，
// 让下一批误判"锁被占"或者更糟地跟正在跑的批次撞车。
// 0929批次4修法(主理人纠正)：光留痕不够——"拿不到确认不代表锁真没释放/没续上，大概率
// 是网络抖/时序问题，应该跟 commenter-identity 一样重试几次"。lock-release/lock-refresh
// 都改成最多重试3次(trap 里的重试仍是非阻塞的短暂等待，不是无限等)，3次都失败才留告警。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const SKIP = !ZSH && "no zsh (CI: sudo apt-get install -y zsh)";

// 通用假控制器：可通过环境变量分别控制 lock-refresh / lock-release 是否"假装失败"
// (输出 die 时的典型形状：非 lock=xxx 开头的错误行 + 非0退出码)。其余命令给最小可用响应，
// 让脚本在"无视频卡片"分支尽快收工，不需要跑完整个录制/评论采集流程。
const FAKE_ADB = `#!/bin/sh
shift; shift
CMD="$1"; shift
case "$CMD" in
  lock-acquire) exit 0;;
  lock-refresh)
    if [ "$LOCKREFRESH_FAIL" = "1" ]; then echo "refusing to refresh lock owned by another run: other-tag" >&2; exit 1; fi
    printf 'lock=refreshed owner=TAG ttl=1800s\\n'; exit 0;;
  lock-release)
    cnt="$HOME/lockrelease-count"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
    if [ "$LOCKRELEASE_FAIL" = "1" ]; then echo "refusing to release lock owned by another run: other-tag" >&2; exit 1; fi
    if [ "$n" -le "\${LOCKRELEASE_FAIL_COUNT:-0}" ]; then echo "transient release error" >&2; exit 1; fi
    printf 'lock=released owner=TAG\\n'; exit 0;;
  open-app) exit 0;;
  open-search) exit 0;;
  search-video-tab) exit 0;;
  search-time-layer) exit 0;;
  search-video-cards) exit 0;;
esac
exit 0`;

const FAKE_SSH = `#!/bin/sh
exit 0`;

function setup(extraEnv = {}) {
  const home = mkdtempSync(join(tmpdir(), "hklock-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), FAKE_ADB);
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1", ...extraEnv };
  return { home, env };
}

test("lock-release 持续失败(锁被别人持有) → 重试3次后日志留痕，不再静默吞掉", { skip: SKIP }, () => {
  const { home, env } = setup({ LOCKRELEASE_FAIL: "1" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.match(r.stderr, /放锁未确认成功/, `stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockrelease-count"), "utf8").trim());
  assert.equal(n, 3, `应该重试3次才放弃, 实际调用次数=${n}`);
});

test("lock-release 成功 → 不产生多余的放锁失败告警", { skip: SKIP }, () => {
  const { env } = setup();
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.doesNotMatch(r.stderr, /放锁未确认成功/, `stderr=${r.stderr}`);
});

test("lock-release 前2次失败第3次成功 → 重试后确认成功,不告警", { skip: SKIP }, () => {
  const { home, env } = setup({ LOCKRELEASE_FAIL_COUNT: "2" });
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.doesNotMatch(r.stderr, /放锁未确认成功/, `stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockrelease-count"), "utf8").trim());
  assert.equal(n, 3, `应该重试到第3次才成功, 实际调用次数=${n}`);
});
