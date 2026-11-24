import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const native=require('./queued-recipient-evidence.js');
const own=require('./own-accounts-lib.js');
const fail=reason=>{
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};
const sha=value=>createHash('sha256').update(value).digest('hex');
const fields=value=>Object.fromEntries([...String(value).matchAll(/^([a-z_]+)=(.*)$/gm)]
  .map(([,key,text])=>[key,text]));

function readEvidence({evidenceRoot,path,basename,start,limit=4*1024*1024}){
  if(path!==join(evidenceRoot,basename))fail('COMMENT_FILE');
  try{
    const stat=lstatSync(path);
    if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(path)!==path||stat.size>limit||stat.size===0
      ||stat.uid!==process.getuid()||stat.mode&0o022||stat.mtimeMs<start*1000)fail('COMMENT_FILE');
    return new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path));
  }catch{
    fail('COMMENT_FILE');
  }
}

export function createStandaloneCommentObserver({scope,evidenceRoot,root,frozen,phone,execute}){
  const {run_tag:run,line,profile,run_start_ts:start}=scope;
  const excluded=own.loadOwnAccounts(join(root,'config','own-accounts.json'));
  let lastPanel=null,opened=false,sequence=0,identityAttempts=0;
  const call=(command,args)=>phone({command,args,profile,owner:run});
  const name=suffix=>run+'-comment-'+(++sequence)+'-'+suffix;
  const read=(path,basename,limit)=>readEvidence({evidenceRoot,path,basename,start,limit});
  async function readPanel(){
    const eid=name('panel'),result=await call('ui-evidence',[eid]);
    const path=String(result.stdout).trim();
    const panel=native.parseNativeCommentXml(read(path,eid+'.xml'));
    if(panel.strict_layout!==true||!Array.isArray(panel.rows))fail('COMMENT_PANEL');
    return {rows:panel.rows.filter(row=>!row.author&&row.nickname&&row.body&&row.x&&row.y&&row.nickname_b64
      &&!own.isOwnAccount(row.nickname,undefined,excluded)).slice(0,50),footer:panel.footer_reached===true,viewport:panel.scroll_viewport};
  }
  async function verifyProfileLink(video,row,identity,eid){
    const body=sha(row.body),args=[video.video_id,identity.douyin_id,row.nickname_b64,body,eid];
    const link=fields((await call('commenter-profile-card-link',args)).stdout);
    const raw=read(link.profile_link_evidence,eid+'-profile-link-proof.json',20*1024*1024);
    if(sha(raw)!==link.profile_link_evidence_sha256)fail('PROFILE_LINK');
    const proof=JSON.parse(raw);
    const source=frozen.files;
    if(proof.scope?.evidence_id!==eid||proof.controller_sha256!==source['runtime/douyin-phone-adb']
      ||proof.helper_sha256!==source['runtime/profile-card-link.py'])fail('PROFILE_LINK');
    const expected={video_id:video.video_id,douyin_id:identity.douyin_id,nickname:row.nickname,
      comment_body_sha256:body,profile,run};
    const python=frozen.collection_phone_scope?.executables?.python?.path;
    const pythonHash=frozen.collection_phone_scope?.executables?.python?.sha256;
    if(!python||!pythonHash||realpathSync(python)!==python||sha(readFileSync(python))!==pythonHash)fail('PROFILE_LINK');
    const verification=await execute(python,[join(root,'profile-card-link.py'),'verify'],{
      input:JSON.stringify({proof,expected}),timeoutMs:10000,
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},
    });
    if(verification.code!==0||JSON.parse(verification.stdout).profile_url!==link.profile_url
      ||!/^https:\/\/v\.douyin\.com\/[A-Za-z0-9_-]+\/$/.test(link.profile_url))fail('PROFILE_LINK');
    return link.profile_url;
  }
  return {
    reset(){opened=false;lastPanel=null;},
    async scan(){
      if(!opened){
        const result=fields((await call('open-comments',[name('open')])).stdout);
        if(result.comments_opened!=='1')fail('COMMENT_PANEL');
        opened=true;
      }
      lastPanel=await readPanel();
      return {comments:lastPanel.rows.map(({nickname,body,time,region},index)=>({index,nickname,body,time,region})),
        exhausted:lastPanel.footer,can_scroll:Boolean(lastPanel.viewport)&&!lastPanel.footer};
    },
    async advance(){
      if(!lastPanel?.viewport||lastPanel.footer)fail('COMMENT_PANEL');
      const {left,right,top,bottom}=lastPanel.viewport;
      await call('swipe',[Math.round((left+right)/2),Math.round(bottom-(bottom-top)*0.2),
        Math.round((left+right)/2),Math.round(top+(bottom-top)*0.2),550]);
      lastPanel=null;
    },
    async identify(index,video,binding){
      if(!Number.isSafeInteger(index)||!lastPanel?.rows[index]||identityAttempts>=3*scope.comment_limit)fail('COMMENT_SCOPE');
      const selected=lastPanel.rows[index];
      const current=await readPanel();
      const matches=current.rows.filter(row=>row.nickname===selected.nickname&&row.body===selected.body);
      if(matches.length!==1)fail('COMMENT_SCOPE');
      const row=matches[0],ordinal=++identityAttempts;
      const stem=run+'-v'+video.video_id+'-collection',profileEid=stem+'-person'+ordinal+'-t1',videoEid=stem+'-after-card'+ordinal;
      const identity=fields((await call('commenter-identity',[row.x,row.y,row.nickname_b64,profileEid])).stdout);
      lastPanel=null;
      if(identity.account_type!=='personal'||!identity.douyin_id||identity.nickname!==row.nickname
        ||own.isOwnAccount(row.nickname,identity.douyin_id,excluded))return {excluded:true};
      const pid=identity.douyin_id;
      const raw={profile:read(identity.profile_evidence,profileEid+'-profile.xml'),
        returned:read(identity.return_evidence,profileEid+'-returned.xml')};
      const result=fields((await call('current-video-link',[videoEid])).stdout);
      if(result.video_id!==video.video_id||result.content_type!=='video'||result.resolved_url!==video.video_url)fail('VIDEO_IDENTITY');
      const evidence={version:1,receipt_id:randomUUID(),status:'verified',scope:{line_key:line,run,source_run:null,
        profile,video_id:video.video_id,video_url:video.video_url,douyin_id:pid,nickname:row.nickname,comment_body_sha256:sha(row.body),
        comment_encoding:'canonical',profile_eid:profileEid,video_identity_eid:videoEid},company_binding:binding,
        raw,sha256:{profile:sha(raw.profile),returned:sha(raw.returned)},video_identity:{verified:true,content_type:'video',
          expected_video_id:video.video_id,observed_video_id:video.video_id,evidence_id:videoEid},observed_at:new Date().toISOString()};
      native.validateEvidence(evidence,{...evidence.scope,comment_body:row.body},{companyBinding:binding});
      const profileUrl=await verifyProfileLink(video,row,identity,run+'-resume1-card'+ordinal);
      return {comment:{nickname:row.nickname,douyinId:pid,commentBody:row.body,commentTime:row.time,region:row.region,
        profileUrl,sourceVideo:video.title,sourceVideoUrl:video.video_url,recipientEvidence:evidence}};
    },
  };
}
