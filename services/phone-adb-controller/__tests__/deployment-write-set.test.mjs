import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {buildWriteSet,parseDeployArrays} from '../deployment-write-set.mjs';
const root=fileURLToPath(new URL('../../..',import.meta.url));
const service=fileURLToPath(new URL('..',import.meta.url));
const groups=parseDeployArrays(readFileSync(service+'/deploy.sh','utf8'));
const build=()=>buildWriteSet({groups,sha:'b'.repeat(40),homes:{mmv:'/Users/mmv','xian-m4':'/Users/m4'},
 read:path=>readFileSync(root+'/'+path),mode:()=>0o644,
 commanderFiles:['wf-v2.py','AGENTS.md','contracts/workflow-report.json','skills/workflow-commander/SKILL.md'],
 commanderManifest:Buffer.from('{"protocol":"commander-v2"}')});

test('frozen deployment write set includes every physical alias and all metadata',()=>{
 const result=build();
 for(const host of ['mmv','xian-m4']){
  assert.ok(result[host].length>150);
  assert.equal(new Set(result[host].map(e=>e.path)).size,result[host].length);
  assert.ok(result[host].some(e=>e.path==='bin-harvest/deployment-manifest.json'));
 }
 for(const path of ['bin-harvest/douyin-phone-adb','.local/bin/douyin-phone-adb','bin-harvest/text-input-focus.py','.local/bin/text-input-focus.py'])
  assert.equal(result['xian-m4'].find(e=>e.path===path)?.after.mode,0o755,path);
 for(const path of ['.openclaw/commander/runtime-manifest.json','.openclaw/commander/wf-v2.py',
 'openclaw-root/workspaces-root/clawd-work-commander/skills/workflow-commander/SKILL.md',
 'openclaw-root/workspaces-root/clawd-work-commander/AGENTS.md','.openclaw/cmdr-escort.txt',
 'bin/escort-claude-escalation.sh','.codex-team1/skills/multi-platform-publish','.openclaw/skills/multi-platform-publish'])
  assert.ok(result.mmv.some(e=>e.path===path),path);
 assert.equal(result.mmv.find(e=>e.path==='.codex-team1/skills/multi-platform-publish').after.kind,'symlink');
 assert.ok(result.mmv.some(e=>e.path.startsWith('.openclaw/leadgen-scripts/release-evidence/')));
 assert.ok(!result.mmv.some(e=>e.path.includes('credentials')||e.path.includes('node_modules')));
});

test('write set parser refuses missing arrays or executable shell fragments',()=>{
 const text=readFileSync(service+'/deploy.sh','utf8');
 assert.throws(()=>parseDeployArrays(text.replace('MMV_TOPLEVEL_FILES=(', 'OTHER_FILES=(')),/MMV_TOPLEVEL_FILES/);
 assert.throws(()=>parseDeployArrays(text.replace('MMV_TOPLEVEL_FILES=(cmdr-escort.txt','MMV_TOPLEVEL_FILES=($(touch /tmp/untrusted) cmdr-escort.txt')),/literal/);
});

test('write set preserves source modes and never includes directories or traversal',()=>{
 const bad=structuredClone(groups);bad.DEVICE_CTL_FILES.push('../outside');
 assert.throws(()=>buildWriteSet({groups:bad,sha:'b'.repeat(40),homes:{mmv:'/Users/mmv','xian-m4':'/Users/m4'},read:()=>Buffer.from('x'),mode:()=>0o644,commanderFiles:[],commanderManifest:Buffer.from('{}')}),/path/);
});


test('write set matches the actual dynamic MMV union including JS-only runtime files',()=>{
 const result=build();
 const runtime=new Set([...groups.DEVICE_SH_FILES,...groups.DEVICE_NODE_FILES,...groups.DEVICE_PLAN_FILES,
  ...groups.DEVICE_RPC_PROBE_FILES,...groups.DEVICE_CTL_FILES,...groups.MMV_JS_FILES,...groups.MMV_PROBE_FILES]);
 for(const file of runtime)for(const root of ['bin-harvest','.openclaw/leadgen-scripts'])
  assert.ok(result.mmv.some(entry=>entry.path===root+'/'+file),root+'/'+file);
});
test('受限维护公开入口及全部同namespace依赖实际进入双机包，不只存在开发树',()=>{
 const result=build();
 const files=readdirSync(service).filter(p=>/^qualification-maintenance(?:-[a-z-]+)?\.(?:mjs|py)$/.test(p));
 assert.ok(files.includes('qualification-maintenance.mjs'));
 for(const name of files) {
  const actual=readFileSync(service+'/'+name);
  for(const [host,root]of [['xian-m4','bin-harvest'],['mmv','bin-harvest'],['mmv','.openclaw/leadgen-scripts']]) {
   const entry=result[host].find(e=>e.path===root+'/'+name);
   assert.ok(entry,'部署包缺维护依赖 '+host+':'+name);
   assert.equal(entry.after.kind,'file');
   assert.equal(entry.after.sha256,createHash('sha256').update(actual).digest('hex'));
  }
 }
});
