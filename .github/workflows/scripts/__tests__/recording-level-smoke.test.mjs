import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';
const root=new URL('../../../../',import.meta.url);
const path=p=>new URL(p,root);
// Actual media decoding and owned recorder behavior run from the required
// phone-controller suites; the removed shell's grep block had no runtime consumer.
function decoderDependency(ci,installer){
 const step=YAML.parse(ci).jobs['openclaw-scripts-test'].steps.find(s=>s.id==='openclaw-os-packages');
 assert.match(step.run,/for pair in zsh:zsh xmllint:libxml2-utils ffmpeg:ffmpeg;/);
 assert.match(step.run,/missing\+=\("\$\{pair#\*:\}"\)/);
 assert.match(step.run,/timeout 300s bash \.github\/workflows\/scripts\/prepare-openclaw-os-packages\.sh[^\n]*"\$\{missing\[@\]\}"/);
 assert.match(step.run,/ffmpeg -version/);
 assert.match(installer,/stage official-install sudo env DEBIAN_FRONTEND=noninteractive LC_ALL=C apt-get "\$\{isolated\[@\]\}" "\$\{opts\[@\]\}" install -y "\$@"/);
}
const ci=readFileSync(path('.github/workflows/ci-l3-code.yml'),'utf8');
const installer=readFileSync(path('.github/workflows/scripts/prepare-openclaw-os-packages.sh'),'utf8');
test('OpenClaw CI安装实际decoder回归的ffmpeg依赖',()=>decoderDependency(ci,installer));
test('decoder依赖守卫拒绝删除ffmpeg映射、断helper/参数或漏真实版本核验',()=>{
 for(const mutated of [ci.replace('ffmpeg:ffmpeg',''),ci.replace('bash .github/workflows/scripts/prepare-openclaw-os-packages.sh','bash unrelated.sh'),ci.replace('"${missing[@]}"','"zsh"'),ci.replace('ffmpeg -version','true')])assert.throws(()=>decoderDependency(mutated,installer));
 assert.throws(()=>decoderDependency(ci,installer.replace('install -y "$@"','install -y zsh')));
});
