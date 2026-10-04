// 10-03 采收保底全天拒跑却只留一行「拒跑: 工作流定义版本冻结失败」：prepare 的真实报错走 stderr、
// crontab 又丢到 /dev/null，且这一处拒跑不升级分身（任务 ed591256）。
// 修后：日志带脱敏后的原因（不含 token）；仍保持「固定版本失败只留本地错误、拒跑前零外部动作」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');
const WR = join(SRC, 'wf-run.sh');
const ZSH = spawnSync('bash', ['-lc', 'command -v zsh'], { encoding: 'utf8' }).stdout.trim();
const SKIP = !ZSH && 'no zsh (CI: sudo apt-get install -y zsh)';
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '');

function setup(prepareBody) {
  const home = mkdtempSync(join(tmpdir(), 'wfprep-'));
  const bin = join(home, '.local', 'bin');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nprintf 'ssh' >> "$HOME/ssh-argv.log"; for a in "$@"; do printf '\\t%s' "$a" >> "$HOME/ssh-argv.log"; done; printf '\\n' >> "$HOME/ssh-argv.log"\nexit 0\n`);
  writeFileSync(join(bin, 'adb'), '#!/bin/sh\nexit 1\n');
  const wfr = join(home, 'fake-wfr.sh');
  writeFileSync(wfr, `#!/bin/bash\ncase "$1" in\n  locate-run) exit 0;;\n  prepare) ${prepareBody};;\n  *) exit 0;;\nesac\n`);
  for (const f of ['ssh', 'adb']) chmodSync(join(bin, f), 0o755);
  chmodSync(wfr, 0o755);
  const env = { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`, WALL_REPORT: join(home, 'no-wall'), WFR: wfr, WF_PLAN_DIR: join(SRC, 'plans') };
  return { home, env };
}

test('prepare 失败：日志带脱敏后的真实原因、不含 token，且拒跑前零外部动作', { skip: SKIP }, () => {
  const { home, env } = setup(`echo "WFR_RUNTIME_ERROR Command failed: curl -sS -m 8 http://x/api/brain/releases/r -H Authorization: Bearer SECRET-TOK-9 -w code" >&2; echo "curl: (28) Operation timed out after 8001 milliseconds" >&2; exit 1`);
  const r = spawnSync(ZSH, [WR, 'keyword_acquisition', 'p1', 'SER1', 'biz', '--tag', 'auto10032215'], { encoding: 'utf8', env, timeout: 30000 });
  assert.equal(r.status, 1, r.stderr);
  const log = read(join(home, 'harvest-cron.log'));
  assert.match(log, /拒跑: 工作流定义版本冻结失败: .*curl: \(28\) Operation timed out/);
  assert.doesNotMatch(log, /SECRET-TOK-9/);
  assert.equal(read(join(home, 'ssh-argv.log')), '', '固定版本失败只留本地错误，拒跑前不得有任何 ssh');
  assert.doesNotMatch(r.stderr, /SECRET-TOK-9/);
});
