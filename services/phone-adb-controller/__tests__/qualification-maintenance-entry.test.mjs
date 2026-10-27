import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {readNativeOperation} from '../native-operation-receipt.mjs';

const entry=new URL('../qualification-maintenance.mjs',import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const module=await import(entry).catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND'&&error.message.includes('qualification-maintenance.mjs'))return null;
  throw error;
});

test('正式维护preflight在缺真实OpsTask时给结构化拒绝，不续租取锁或联系手机',()=>{
  const result=spawnSync(process.execPath,[entry.pathname,'preflight'],{encoding:'utf8',timeout:3000,env:{PATH:process.env.PATH,HOME:process.env.HOME}});
  assert.equal(result.status,2,'缺正式维护任务必须以明确参数错误拒绝，不能缺入口或启动业务');
  assert.deepEqual(JSON.parse(result.stdout),{ok:false,code:'MAINTENANCE_TASK_REQUIRED'});
});

test('本次真实214字节资格输出支持固定353在judge之前的上传失败分支',()=>{
  assert.equal(typeof module?.parseQualificationFailure,'function','缺少正式有限资格失败证据解析入口');
  const run='cicd353b_102_pending_20261028_e62fd171',video='7689863996204591985';
  const audio='/private/tmp/openclaw-phone/evidence/legacy/'+run+'-v'+video+'-qualification-record.16k.wav';
  const raw='AUDIO\\t'+video+'\\t'+audio+'\nQUAL\t'+video+'\tpending\taudio_upload_failed\n';
  assert.equal(Buffer.byteLength(raw),214);
  assert.equal(hash(raw),'fb100ef4d41d9253550eff84014a48dff7aabce87442c710ec3cfe335813e99a');
  assert.deepEqual(module.parseQualificationFailure(raw,{run,video_id:video,evidence_root:'/private/tmp/openclaw-phone/evidence/legacy'}),{video_id:video,audio_path:audio,reason:'audio_upload_failed'});
  for(const changed of [raw+'QUAL\t'+video+'\tmatched\tjudged\n',raw.replace('pending','matched'),raw.replace('audio_upload_failed','judged'),raw.replace(video,'7700112581541257551')]){
    assert.throws(()=>module.parseQualificationFailure(changed,{run,video_id:video,evidence_root:'/private/tmp/openclaw-phone/evidence/legacy'}),/MAINTENANCE_FAILURE_EVIDENCE/);
  }
});

test('旧observed_only原件不得洗成native全停，读者零改原件',()=>{
  const dir=mkdtempSync(join(tmpdir(),'qualification-maintenance-native-'));
  try{
    mkdirSync(join(dir,'native-operations'));
    const path=join(dir,'native-operations','original.json');
    const receipt={version:1,operation_id:'original',run_dir:dir,run_id:'original__a1',task_id:null,profile:'legacy',serial:'serial',source_commit:'353b910f11ce3852b2ef69c8ead5c37e97850b4a',owner:'original',activity:'qualification',status:'unknown',process_coverage:'observed_only',execution_stopped:false,observed_processes_stopped:true,wait_code:5,processes:[{pid:123,start_identity:'100:1',pgid:123,termination:{confirmed:true}}]};
    writeFileSync(path,JSON.stringify(receipt));const before=hash(readFileSync(path));
    assert.equal(readNativeOperation(dir,'original').execution_stopped,false);
    assert.equal(hash(readFileSync(path)),before);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
