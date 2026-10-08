import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../', import.meta.url));
const ZSH = spawnSync('bash', ['-lc', 'command -v zsh'], { encoding: 'utf8' }).stdout.trim();
const read = path => existsSync(path) ? readFileSync(path, 'utf8') : '';

for (const capability of ['keyword_acquisition', 'benchmark_link_acquisition']) {
  for (const allowMissing of [false, true]) {
    test(`正式退役计划 ${capability}${allowMissing ? ' 带 --allow-missing' : ''}：拒跑且零设备、escort、队列动作`, () => {
      assert.ok(ZSH, '运行回归测试需要 zsh');
      const home = mkdtempSync(join(tmpdir(), 'wf-retired-'));
      const bin = join(home, '.local/bin');
      mkdirSync(bin, { recursive: true });
      const spy = '#!/bin/sh\nprintf "%s\\n" "$0 $*" >> "$HOME/external-actions.log"\nexit 0\n';
      for (const command of ['ssh', 'adb', 'douyin-phone-adb', 'openclaw', 'queue', 'wall']) {
        writeFileSync(join(bin, command), spy, { mode: 0o755 });
      }
      const wfr = join(bin, 'wfr');
      writeFileSync(wfr, '#!/bin/sh\nprintf "%s\\n" "$1" >> "$HOME/runtime-actions.log"\ncase "$1" in locate-run) exit 0;; *) printf "%s\\n" "$1" >> "$HOME/external-actions.log"; exit 98;; esac\n', { mode: 0o755 });
      const planDir = join(SRC, 'plans');
      assert.match(readFileSync(join(planDir, `${capability}.plan`), 'utf8'), /^WF_RETIRED='1'$/m);
      const env = {
        ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}`,
        WF_PLAN_DIR: planDir, WFR: wfr, C: join(bin, 'douyin-phone-adb'),
        WALL_REPORT: join(bin, 'wall'), LEADGEN_QUEUE: join(bin, 'queue'),
        WFR_HOME: join(home, 'runtime'), WF_FORCE_OUTSIDE_WINDOW: '1',
      };
      delete env.WF_FROZEN_ROOT;
      delete env.WFR_RUN_DIR;
      const args = [join(SRC, 'wf-run.sh'), capability, 'p1', 'SER1', '业务', '--tag', 'retired-test', '--commander', 'existing-escort'];
      if (allowMissing) args.push('--allow-missing');
      const result = spawnSync(ZSH, args, { env, encoding: 'utf8', timeout: 10000 });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /旧获客流程已退役/);
      assert.doesNotMatch(result.stdout, /WF_RUN_STARTED/);
      assert.equal(read(join(home, 'external-actions.log')), '', '退役拒跑必须先于设备、escort、队列和控制塔动作');
      assert.equal(read(join(home, 'runtime-actions.log')), 'locate-run\n', '不能开始 prepare、绑定或执行活动');
      assert.equal(existsSync(join(env.WFR_HOME, 'ledger')), false);
    });
  }
}

for(const capability of ['keyword_acquisition','benchmark_link_acquisition'])test('退役门禁必须先于历史冻结运行索引：'+capability,()=>{
 const home=mkdtempSync(join(tmpdir(),'wf-retired-resume-')),bin=join(home,'.local/bin'),old=join(home,'old-run/runtime');
 mkdirSync(bin,{recursive:true});mkdirSync(old,{recursive:true});
 writeFileSync(join(old,'wf-run.sh'),'#!/bin/zsh\nprint old-run-executed > "$HOME/external-actions.log"\n',{mode:0o755});
 const wfr=join(bin,'wfr');writeFileSync(wfr,'#!/bin/sh\ncase "$1" in locate-run) printf "%s\n" "$HOME/old-run";; esac\n',{mode:0o755});
 const env={...process.env,HOME:home,PATH:bin+':'+process.env.PATH,WF_PLAN_DIR:join(SRC,'plans'),WFR:wfr};delete env.WF_FROZEN_ROOT;
 const result=spawnSync(ZSH,[join(SRC,'wf-run.sh'),capability,'p1','SER1','业务','--tag','retired-resume'],{env,encoding:'utf8',timeout:10000});
 assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/旧获客流程已退役/);assert.equal(read(join(home,'external-actions.log')),'');
});
