import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareTransport} from './fixtures/m4-deploy-transport.mjs';
import {withDeploymentPrefixFixture} from './deployment-prefix-fixture.mjs';

test('正式部署在系统 bash nounset 下组装完整去重的 MMV 运行包，SSH 前不报空数组错误', () => {
 return withDeploymentPrefixFixture((root,env)=>{
  const path = join(root,'services/phone-adb-controller/deploy.sh');
  const source = readFileSync(path, 'utf8');
  const marker = '# 在任何SSH前核验部署源字节';
  assert.ok(source.includes(marker));
  const prefix = source.slice(0, source.indexOf(marker));
  const result = spawnSync('/bin/bash', ['-c', prefix + `
    printf 'RUNTIME:%s\n' "\${MMV_RUNTIME_FILES[@]}"
    printf 'EXPECTED:%s\n' "\${DEVICE_SH_FILES[@]}" "\${DEVICE_NODE_FILES[@]}" "\${DEVICE_PLAN_FILES[@]}" "\${DEVICE_RPC_PROBE_FILES[@]}" "\${DEVICE_CTL_FILES[@]}" "\${MMV_JS_FILES[@]}" "\${MMV_PROBE_FILES[@]}"
  `, path], {encoding:'utf8',env});
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split('\n');
  const runtime = lines.filter(x=>x.startsWith('RUNTIME:')).map(x=>x.slice(8));
  const expected = lines.filter(x=>x.startsWith('EXPECTED:')).map(x=>x.slice(9));
  assert.equal(runtime.length, new Set(runtime).size);
  assert.deepEqual(new Set(runtime), new Set(expected));
  assert.ok(runtime.includes('leadgen-workflow.mjs'));
  assert.ok(runtime.includes('company-config-sync-lib.js'),'公司同步lib必须进入MMV发布源manifest');
  assert.ok(!runtime.some(path=>/company-config-sync\.test\./.test(path)),'测试不作为生产运行包发布');
  assert.ok(runtime.includes('plans/douyin_comment_scoring.plan'));
 });
});

// Execute the syntax command selected by each real deployment loop locally.
// SSH only redirects the destination; the actual Node/Python parser still runs.
for (const [array, host, destination] of [
  ['MMV_JS_FILES', 'mmv', '.openclaw/leadgen-scripts'],
  ['DEVICE_NODE_FILES', '"$host"', 'bin-harvest'],
]) {
  const cases = [
    ['outreach-order-lock.py', readFileSync(new URL('../outreach-order-lock.py', import.meta.url), 'utf8'), true],
    ['invalid.py', 'def broken(:\n', false],
    ['valid.js', 'const value = 1;\n', true],
    ['invalid.js', 'const value = ;\n', false],
  ];
  if (array === 'DEVICE_NODE_FILES') cases.push(
    ['valid.json', '{"value":1}', true], ['invalid.json', '{"value":}', false],
  );
  for (const [filename, content, valid] of cases) test(`${array} 使用真实语法解析器检查 ${filename}`, () => {
    const source = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8');
    if (array === 'DEVICE_NODE_FILES') {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'deployment-node-syntax-')));
      try {
        const {home,env} = prepareTransport(root), input = join(root,'source');
        mkdirSync(input); writeFileSync(join(input,filename),content);
        const service = new URL('../',import.meta.url).pathname;
        const block = source.slice(source.indexOf('echo "=== [3/3]'),source.indexOf('echo "=== [4/4]'));
        assert.ok(block.includes('deploy_m4_payload "$host"'), 'actual M4 deployment block must invoke the installer');
        const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
        const script = `set -euo pipefail\nD=${quote(input)}\nFAILED=0\nsource ${quote(join(service,'deployment-functions.sh'))}\n` +
          `DEVICE_SH_FILES=()\nDEVICE_NODE_FILES=(${quote(filename)})\nDEVICE_RPC_PROBE_FILES=()\nDEVICE_PLAN_FILES=()\n${block}\nexit "$FAILED"\n`;
        const result = spawnSync('/bin/bash',['-c',script],{encoding:'utf8',env});
        assert.equal(result.error,undefined);
        assert.equal(result.status === 0,valid,result.stderr);
        assert.equal(readFileSync(join(home,destination,filename),'utf8'),content);
        assert.match(result.stdout,/M4_FILE /,'the actual uploaded Python installer must check the file');
      } finally { rmSync(root,{recursive:true,force:true}); }
      return;
    }
    const marker = `for f in "\${${array}[@]}"; do`;
    const start = source.indexOf(marker);
    assert.ok(start >= 0, 'actual deployment loop must exist');
    const body = source.slice(start + marker.length);
    const push = body.indexOf('push_atomic ');
    const selectionStart = body.indexOf('\n', push) + 1;
    const check = body.indexOf(`if ssh ${host} `, selectionStart);
    assert.ok(push >= 0 && check > selectionStart, 'actual remote syntax check must exist');
    const selection = body.slice(selectionStart, check);
    const command = body.slice(check).match(/^if ssh (?:mmv|"\$host") "([^\n]+)" 2>/)?.[1];
    assert.ok(command, 'actual syntax command must be captured');
    const home = mkdtempSync(join(tmpdir(), 'deployment-syntax-'));
    try {
      mkdirSync(join(home, destination), {recursive:true});
      writeFileSync(join(home, destination, filename), content);
      const script = `f=${filename}\nhost=fixture\n${selection}\n` +
        'ssh() { shift; local cmd="$1"; case "$cmd" in /opt/homebrew/bin/node*) cmd="node${cmd#/opt/homebrew/bin/node}";; esac; bash -c "$cmd"; }\n' +
        `ssh ${host} "${command}"\n`;
      const result = spawnSync('/bin/bash', ['-c', script], {
        encoding:'utf8', env:{...process.env, HOME:home, PATH:dirname(process.execPath)+':'+process.env.PATH},
      });
      assert.equal(result.status === 0, valid, result.stderr);
    } finally { rmSync(home, {recursive:true, force:true}); }
  });
}
test('新widget、producer及0353恢复的实际部署数组覆盖双机和RPC冻结闭包',async()=>{
 const {RPC_FILES}=await import('../leadgen-client.mjs');const root=new URL('../',import.meta.url).pathname,source=readFileSync(join(root,'deploy.sh'),'utf8');
 const arrays=source.slice(source.indexOf('MMV_JS_FILES=('),source.indexOf('# 在任何SSH前'));
 const r=spawnSync('/bin/bash',['-c',arrays+'\nprintf "MMV:%s\\n" "${MMV_RUNTIME_FILES[@]}";printf "DEVICE:%s\\n" "${DEVICE_CTL_FILES[@]}" "${DEVICE_NODE_FILES[@]}";printf "RPC:%s\\n" "${RPC_FILES[@]}"'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 const lines=r.stdout.trim().split('\n');for(const name of ['producer-descriptor.mjs','no-comments-evidence.mjs','comment-count-evidence.py','single-video-recovery-0353.js','single-video-recovery-0353-authority.js']){for(const group of ['MMV','DEVICE','RPC'])assert.ok(lines.includes(group+':'+name),group+':'+name);assert.ok(RPC_FILES.includes(name));}
 for(const group of ['MMV','DEVICE'])assert.ok(lines.includes(group+':clipboard-widget-cancel.py'));
});
