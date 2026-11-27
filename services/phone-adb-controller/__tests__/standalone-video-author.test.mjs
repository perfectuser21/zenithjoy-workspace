import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

test('作者入口只从真机作品标题节点定位，重复、关注或非作品节点被拒绝',async()=>{
  const {authorXmlReader}=await import('../standalone-video-author.mjs');
  const parse=(xml,kind)=>JSON.parse(execFileSync('python3',['-c',authorXmlReader,kind],{input:xml,encoding:'utf8'}));
  for(const name of ['real-copy-guide-restored-detail-41.xml','video-detail-from-search.xml']){
    const xml=readFileSync(new URL('fixtures/'+name,import.meta.url),'utf8');
    assert.deepEqual(Object.keys(parse(xml,'detail')).sort(),['x','y']);
  }
  const node='<node enabled="true" package="com.ss.android.ugc.aweme" class="android.widget.TextView" resource-id="com.ss.android.ugc.aweme:id/title" clickable="true" text="@test" bounds="[10,10][20,20]" />';
  assert.throws(()=>parse('<hierarchy>'+node+node+'</hierarchy>','detail'));
  assert.throws(()=>parse('<hierarchy>'+node.replace('@test','关注')+'</hierarchy>','detail'));
  const profile='<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：test102" /><node package="com.ss.android.ugc.aweme" content-desc="私信" /></hierarchy>';
  assert.deepEqual(parse(profile,'profile'),{douyin_id:'test102'});
  assert.throws(()=>parse(profile.replace('私信','评论'),'profile'));
});

test('作者工具只点原生作品标题，读主页后回到同一 VID',async t=>{
  const {createVideoAuthorReader}=await import('../standalone-video-author.mjs');
  const {createHash}=await import('node:crypto');
  const {mkdtempSync,realpathSync,writeFileSync,rmSync}=await import('node:fs');
  const {tmpdir}=await import('node:os');
  const {join}=await import('node:path');
  const python=realpathSync(execFileSync('/bin/sh',['-c','command -v python3'],{encoding:'utf8'}).trim());
  const evidenceRoot=realpathSync(mkdtempSync(join(tmpdir(),'102-author-evidence-')));
  t.after(()=>rmSync(evidenceRoot,{recursive:true,force:true}));
  const detail=readFileSync(new URL('fixtures/video-detail-from-search.xml',import.meta.url),'utf8');
  const profile='<hierarchy><node package="com.ss.android.ugc.aweme" text="抖音号：test102" /><node package="com.ss.android.ugc.aweme" content-desc="私信" /></hierarchy>';
  const videoId='1234567890123456789',actions=[];
  let wrongVideo=false;
  const run=createVideoAuthorReader({
    scope:{profile:'cloud',run_tag:'r-102',run_start_ts:0},evidenceRoot,
    python:{path:python,sha256:createHash('sha256').update(readFileSync(python)).digest('hex')},
    async phone({command,args}){
      actions.push(command);
      if(command==='current-video-link')return {stdout:`video_id=${wrongVideo?'9999999999999999999':videoId}\ncontent_type=video\n`};
      if(command!=='ui-evidence')return {stdout:''};
      const path=join(evidenceRoot,args[0]+'.xml');
      writeFileSync(path,args[0].endsWith('-detail')?detail:profile,{mode:0o600});
      return {stdout:path+'\n'};
    },
    async execute(file,args,options){
      return {code:0,stdout:execFileSync(file,args,{input:options.input,encoding:'utf8'})};
    },
  });
  const result=await run(videoId);
  assert.equal(result.video_id,videoId);
  assert.equal(result.douyin_id,'test102');
  assert.match(result.profile.sha256,/^[a-f0-9]{64}$/);
  assert.deepEqual(actions,['current-video-link','ui-evidence','tap-evidence','ui-evidence','back-evidence','current-video-link']);
  actions.length=0;wrongVideo=true;
  await assert.rejects(run(videoId),{code:'STANDALONE_COLLECTION_AUTHOR_UNVERIFIED'});
  assert.deepEqual(actions,['current-video-link']);
});
