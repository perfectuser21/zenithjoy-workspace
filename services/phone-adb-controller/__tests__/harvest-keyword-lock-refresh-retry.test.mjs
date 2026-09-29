// harvest-keyword.sh 锁心跳续期(lock-refresh)重试回归测试（0929 DoD 审计批次4）。
// 事故形状：批次3只把 lock-refresh 失败"记一笔日志就算了"，主理人纠正——30分钟TTL buffer
// 故意设得宽松是为了容错，不是让单次失败躺平不管。拿不到续期确认，跟 commenter-identity
// 拿不到身份一样，大概率是网络抖/时序问题，应该按同样的"3次重试"套路处理，而不是打一条
// 警告就继续假装没事。
//
// 修法：lock-refresh 改成最多重试3次(间隔用 nap，测试模式下不真睡)，3次都失败才留告警日志
// (仍不让整批夭折——30分钟 buffer 还在)。
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

// 通用假控制器：lock-refresh 按调用次数返回不同结果(前N次失败,之后成功)，其余命令给
// 最小可用响应，让脚本在"无视频卡片"分支尽快收工(lock-refresh 发生在拿到卡片之后，
// 所以给1张卡但让 current-video-link 报图文帖跳过，省掉整段录制/评论流程)。
function makeFakeAdb(failCount) {
  return `#!/bin/sh
shift; shift
CMD="$1"; shift
case "$CMD" in
  lock-acquire) exit 0;;
  lock-release) printf 'lock=released owner=TAG\\n'; exit 0;;
  lock-refresh)
    cnt="$HOME/lockrefresh-count"; n=$(cat "$cnt" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$cnt"
    if [ "$n" -le "${failCount}" ]; then
      echo "refusing to refresh lock owned by another run: other-tag" >&2; exit 1
    fi
    printf 'lock=refreshed owner=TAG ttl=1800s\\n'; exit 0;;
  open-app) exit 0;;
  open-search) exit 0;;
  search-video-tab) exit 0;;
  search-time-layer) exit 0;;
  search-video-cards) printf '1\\t2\\t01:00\\tTITLE_A\\n'; exit 0;;
  tap-evidence) exit 0;;
  current-video-link) printf 'excluded_non_video=true\\n'; exit 0;;
  back-to-results) exit 0;;
esac
exit 0`;
}

const FAKE_SSH = `#!/bin/sh
exit 0`;

function setup(failCount) {
  const home = mkdtempSync(join(tmpdir(), "hklr-"));
  mkdirSync(join(home, ".local", "bin"), { recursive: true });
  writeFileSync(join(home, ".local", "bin", "douyin-phone-adb"), makeFakeAdb(failCount));
  chmodSync(join(home, ".local", "bin", "douyin-phone-adb"), 0o755);
  writeFileSync(join(home, ".local", "bin", "ssh"), FAKE_SSH);
  chmodSync(join(home, ".local", "bin", "ssh"), 0o755);
  const env = { ...process.env, HOME: home, PATH: `${join(home, ".local", "bin")}:${process.env.PATH}`, HARVEST_KEYWORD_TESTING: "1" };
  return { home, env };
}

test("lock-refresh 前2次失败第3次成功 → 重试后确认成功,不告警", { skip: SKIP }, () => {
  const { home, env } = setup(2);
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.doesNotMatch(r.stderr, /锁心跳续期3次仍未确认成功/, `stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockrefresh-count"), "utf8").trim());
  assert.equal(n, 3, `应该重试到第3次才成功, 实际调用次数=${n}`);
});

test("lock-refresh 连续3次都失败 → 重试3次后仍告警(不中断整批)", { skip: SKIP }, () => {
  const { home, env } = setup(3);
  const r = spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  assert.match(r.stderr, /锁心跳续期3次仍未确认成功/, `stderr=${r.stderr}`);
  const n = Number(readFileSync(join(home, "lockrefresh-count"), "utf8").trim());
  assert.equal(n, 3, `应该恰好重试3次, 实际调用次数=${n}`);
  assert.equal(r.status, 0, "续期3次失败不应让整批脚本非0退出(30分钟TTL buffer原则不变)");
});

test("lock-refresh 首次即成功 → 不多余重试", { skip: SKIP }, () => {
  const { home, env } = setup(0);
  spawnSync(ZSH, [HK, "P", encodeURIComponent("kw"), "1", "TAG"], { encoding: "utf8", env, timeout: 30000 });
  const n = Number(readFileSync(join(home, "lockrefresh-count"), "utf8").trim());
  assert.equal(n, 1, `首次成功不应发起额外重试, 实际调用次数=${n}`);
});
