import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {pathToFileURL} from 'node:url';

const archive = JSON.parse(fs.readFileSync(new URL('../leadgen-foundation/sources/102.json',import.meta.url)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'qualification-visual-input-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const host=path.join(root,'host');
  for(const folder of ['native','receipts','qualification']) fs.mkdirSync(path.join(host,folder),{recursive:true,mode:0o700});
  function file(relative,value) {
    const filename=path.join(host,relative);
    const bytes=typeof value==='string'?value:JSON.stringify(value);
    fs.writeFileSync(filename,bytes,{mode:0o600});
    return {path:filename,sha256:hash(bytes)};
  }
  for(const fileName of ['helper.mjs','process-lock.mjs','visual-evidence.mjs']) {
    const name='qualification/'+fileName, entry=archive.files[name];
    assert.equal(hash(entry.source),entry.sha256);
    file(name,entry.source);
  }
  file('qualification/runtime-deps.mjs','export async function createRuntimeDeps(){ throw new Error("fixture needs injected dependencies"); }');
  const {main}=await import(pathToFileURL(path.join(host,'qualification/helper.mjs')));
  const videoId='7710295517595719291', identity={task_id:'fixture-task',run_id:'visual-run',run_tag:'visual-run'};
  const audio=file('native/source.wav','audio fixture');
  const video=file('receipts/video.json',{
    state:'terminal',binding:{activity:'qualification',args:['current-video-link'],identity},
    result:{exit_code:0,stdout:`video_id=${videoId}\n`},
  });
  const panels=['A','B','C','D','E'].map((label,index)=>{
    const frame=`receipts/${label}.png`,asset=file(frame,label+' fixture image bytes');
    return {label,frame,sha256:asset.sha256,pts_seconds:index+10};
  });
  const recording=file('native/source.mkv','video fixture'),sheet=file('receipts/sheet.jpg','five frames fixture');
  const coverage=file('receipts/coverage.json',{panels,recording,sheet_sha256:sheet.sha256});
  const proof={schema:'activity-evidence/v1',identity:{...identity,workflow:'102'},qualification_evidence:{
    audio,video_identity:video,coverage_json:coverage,coverage_image:sheet,recording,
    visual_observations:[{label:'B',text:'AI 简历工作台'},{label:'D',text:'PDF 导出'}],
  }};
  const proofPath=path.join(root,'proof.json');
  const save=(value=proof)=>fs.writeFileSync(proofPath,JSON.stringify(value),{mode:0o600});
  save();
  const policy={company_id:'company',tenant_id:'tenant',policy_id:'policy',version:34};
  const context={...policy,line:'example',source_commit:'a'.repeat(40),business_deadline_ms:Date.now()+20000,
    tasks:{'102':identity},verification:{proof_manifest_path:proofPath}};
  const input={context,video_id:videoId,audio:audio.path,artifact_dir:path.join(root,'journal')};
  return {main,input,policy,proof,save};
}

test('资格主判同一次接收音频转写和已绑定画面，恢复不重复调用',async t=>{
  const f=await fixture(t);
  const asr='只识别到歌词';
  const counts={asr:0,judge:0,commit:0};
  const deps={
    authority:async()=>{},
    freeze:async()=>f.policy,
    validateAudio:async()=>({duration:26}),
    asr:async(_audio,{audit})=>{ counts.asr++; audit({}); return asr; },
    judge:async(state,_policy,{audit})=>{
      counts.judge++;
      assert.ok(state.includes(asr));
      assert.ok(state.includes('AI 简历工作台'));
      assert.ok(state.includes('PDF 导出'));
      audit({});
      return {verdict:'MATCHED',reason:'fixture'};
    },
    commit:async({transcript})=>{counts.commit++;assert.equal(transcript,asr);return {verified:true};},
    readback:async()=>({verified:true}),
  };
  const decision=await f.main(f.input,deps);
  assert.equal(decision.verdict,'matched');
  assert.deepEqual(counts,{asr:1,judge:1,commit:1});
  const journal=JSON.parse(fs.readFileSync(decision.journal.path,'utf8'));
  assert.equal(journal.scope.visual_evidence_sha256,journal.visual_evidence.sha256);
  assert.equal((await f.main(f.input,deps)).verdict,'matched');
  assert.deepEqual(counts,{asr:1,judge:1,commit:1});
  f.proof.qualification_evidence.visual_observations[0].text='different observation';
  f.save();
  await assert.rejects(f.main(f.input,deps),/JOURNAL_SCOPE_CHANGED/);
  assert.deepEqual(counts,{asr:1,judge:1,commit:1});
});

test('证据缺失或属于其他视频时保持不调用 ASR 或主判',async t=>{
  const f=await fixture(t);
  const neverCall=async()=>assert.fail('拒绝路径不能发生外部调用或写入');
  const deps={authority:neverCall,asr:neverCall,judge:neverCall,commit:neverCall};
  delete f.proof.qualification_evidence.visual_observations;
  f.save();
  await assert.rejects(f.main(f.input,deps),/QUALIFICATION_VISUAL_OBSERVATIONS_REQUIRED/);
  await assert.rejects(f.main({...f.input,video_id:'7710295517595719292'},deps),/QUALIFICATION_VISUAL_VIDEO_BINDING/);
});
