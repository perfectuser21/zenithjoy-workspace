// harvest-keyword.sh 逐视频循环的「回列表」按发现类型分派（决策 7f842d12，对标链接获客组装跑通的衔接件）。
// 对标发现（DISCOVER_CMD=…/discover-benchmark.sh）的列表页是对标主页作品网格：必须用 back-to-profile 归位；
// back-to-results 只认搜索结果页，兜底会拿对标链接当关键词重搜（主页场景下会把人退出抖音）。
// 对标归位失败 → 本对标号剩余候选作废（CARD_ARR 清空），不重搜、不拿废坐标瞎点。
// 关键词发现（默认）行为不变：仍走 back-to-results。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const HK = join(HERE, "..", "harvest-keyword.sh");
const ZSH = spawnSync("bash", ["-lc", "command -v zsh"], { encoding: "utf8" }).stdout.trim();
const PY = spawnSync("bash", ["-lc", "command -v python3"], { encoding: "utf8" }).stdout.trim();
const SKIP = (!ZSH && "no zsh (CI: sudo apt-get install -y zsh)") || (!PY && "no python3");

function run(discoverCmd, backRc) {
  const home = mkdtempSync(join(tmpdir(), "hkback-"));
  const ctl = join(home, "ctl");
  writeFileSync(ctl, `#!/bin/sh\nshift; shift\nprintf '%s\\n' "$*" >> "${home}/calls.log"\nexit ${backRc}\n`);
  chmodSync(ctl, 0o755);
  const script = [
    `set -- legacy https%3A%2F%2Fwww.douyin.com%2Fuser%2FAAA 3 TAG`,
    `HARVEST_KEYWORD_LIB=1 source ${HK}`,
    `C=${ctl}; ${discoverCmd ? `DISCOVER_CMD=${discoverCmd}` : "unset DISCOVER_CMD"}`,
    `typeset -a CARD_ARR; CARD_ARR=("1\t2\t\t" "3\t4\t\t"); i=1`,
    `back_to_results_and_maybe_rescan EVID`,
    `print -- "CARDS_LEFT=\${#CARD_ARR[@]}"`,
  ].join("\n");
  const r = spawnSync(ZSH, ["-c", script], { encoding: "utf8", env: { ...process.env, HOME: home } });
  const calls = existsSync(join(home, "calls.log")) ? readFileSync(join(home, "calls.log"), "utf8") : "";
  return { r, calls };
}

test("对标发现：归位走 back-to-profile，不走 back-to-results，成功时保留剩余卡片", { skip: SKIP }, () => {
  const { r, calls } = run("/x/bin-harvest/discover-benchmark.sh", 0);
  assert.equal(r.status, 0, r.stderr);
  assert.match(calls, /^back-to-profile /m);
  assert.doesNotMatch(calls, /back-to-results/);
  assert.match(r.stdout, /CARDS_LEFT=2/);
});

test("对标发现：归位失败 → 本对标号剩余候选作废（不重搜）", { skip: SKIP }, () => {
  const { r, calls } = run("/x/bin-harvest/discover-benchmark.sh", 1);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(calls, /back-to-results|search-video/);
  assert.match(r.stdout, /CARDS_LEFT=0/);
});

test("关键词发现（默认）：仍走 back-to-results（行为不变）", { skip: SKIP }, () => {
  const { r, calls } = run("", 0);
  assert.equal(r.status, 0, r.stderr);
  assert.match(calls, /^back-to-results 4 /m);
  assert.doesNotMatch(calls, /back-to-profile/);
});
