import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseCollection} from '../leadgen-handlers.mjs';
const root=new URL('../',import.meta.url).pathname;
const raw=readFileSync(new URL('./fixtures/honor-e1b-recipient/author-footer.xml',import.meta.url),'utf8');
const controller=readFileSync(join(root,'douyin-phone-adb'),'utf8'),queued=readFileSync(join(root,'queued-video-lib.sh'),'utf8');
const fn=(source,name)=>{const m=source.match(new RegExp('^'+name+'\\(\\) ?\\{[\\s\\S]*?^\\}','m'));assert.ok(m,name);return m[0];};
const vid='7703947893585793947';
test('原生fod唯一作者评论与真实footer：保留作者标记，真实队列过滤后0条且不伪造no_comments',()=>{
 const dir=mkdtempSync(join(tmpdir(),'author-footer-'));
 try{
  const file=join(dir,'panel.xml');writeFileSync(file,raw);
  const parsed=spawnSync('zsh',['-c',`${fn(controller,'comments_from_xml')}; ${fn(controller,'comments_exhausted')}; comments_from_xml "$1" 1200; comments_exhausted "$1" && print exhausted=1`,'zsh',file],{encoding:'utf8',timeout:5000});
  assert.equal(parsed.status,0,parsed.stderr);const rows=parsed.stdout.trim().split('\n');assert.equal(rows.length,2);assert.equal(rows[0].split('\t')[4],'author');assert.equal(rows[1],'exhausted=1');
  writeFileSync(join(dir,'rows'),parsed.stdout);
  const script=`setopt EXTENDED_GLOB; VID=${vid}; TAG=fixture-author; P=fixture; QV_EID=fixture-author; LEADGEN_COMMENT_LIMIT=5;
${fn(queued,'qv_collection_budget')}
${fn(queued,'qv_collect')}
# 仅替代设备边界；实际qv_collect保留作者过滤、完整动作与footer断言。
qv_ctl(){ case "$3" in open-comments) print 'comments_opened=1\ncomment_count=1';; collect-comments) cat "$FIXTURE_ROWS";; lock-refresh) return 0;; *) print -u2 unexpected-phone-action;return 99;; esac; }
qv_field(){ print -r -- "$1" | sed -n "s/^$2=//p"; }; qv_own(){ return 1; }; wf_deadline_reached(){ return 1; }; wf_stop_requested(){ return 1; }; qv_collect`;
  const result=spawnSync('zsh',['-c',script],{env:{...process.env,FIXTURE_ROWS:join(dir,'rows')},encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,`COLLECTION\t${vid}\tcollected\t0\t0\t5\tfooter=1\n`);
  assert.deepEqual(parseCollection({code:0,stdout:result.stdout},vid),[]);assert.doesNotMatch(result.stdout,/LEAD\t|no_comments/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
