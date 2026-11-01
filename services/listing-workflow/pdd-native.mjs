import {createHash} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=new Set(['保存草稿','提交并上架','编辑','下架','改库存','改价','发送','聊天','全选','立即复制','添加账号','管理']);

export function createNativeTransport(config,bridge){
 const root=resolve(config.root);mkdirSync(root,{recursive:true,mode:0o700});let sequence=0;
 function draftWrites(){if(config.allowDraftWrites!==true)throw new Error('DRAFT_WRITES_NOT_AUTHORIZED');}
 function approval(value){if(!/^[a-f0-9]{64}$/.test(value?.approvedScreenSha256||''))throw new Error('FRESH_VISUAL_APPROVAL_REQUIRED');return value.approvedScreenSha256;}
 return{
  productionEnabled:false,
  async capture(){
   const result=await bridge.host('observe');const id=String(++sequence).padStart(4,'0');
   for(const[key,extension]of[['picture','png'],['tree','xml']]){
    const bytes=Buffer.from(result[key].bytesBase64,'base64');if(hash(bytes)!==result[key].sha256)throw new Error('EVIDENCE_HASH_MISMATCH');
    if(key==='picture'&&(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw new Error('INVALID_SCREENSHOT');
    const path=join(root,`frame-${id}.${extension}`);writeFileSync(path,bytes,{flag:'wx',mode:0o600});result[key].localPath=path;delete result[key].bytesBase64;
   }
   const path=join(root,`frame-${id}.json`);writeFileSync(path,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});return{...result,manifest:path};
  },
  async launch(){return bridge.host('launch');},
  async navigate(label,proof){
   if(denied.has(label)||typeof label!=='string')throw new Error('FORBIDDEN_CONTROL');
   return bridge.host('navigate',{label,approvedScreenSha256:approval(proof)});
  },
  async approveDraft(proof){draftWrites();return bridge.host('approve-draft',{approvedScreenSha256:approval(proof)});},
  async setField(field,value,proof){
   draftWrites();if(!['title','groupPrice','inventory'].includes(field))throw new Error('FORBIDDEN_FIELD');
   value=String(value);
   if((field==='title'&&(!value.trim()||Array.from(value).length>60||/[\u0000-\u001f]/.test(value)))||(field==='inventory'&&!/^\d{1,7}$/.test(value))||(field==='groupPrice'&&(!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)||Number(value)<=0)))throw new Error('INVALID_FIELD_VALUE');
   const result=await bridge.host('set-field',{field,value,approvedScreenSha256:approval(proof)});
   if(result.ok!==true||result.value!==value||!result.evidence?.length)throw new Error('NATIVE_READBACK_MISMATCH');return result;
  },
  async stageImage(image){
   draftWrites();const bytes=image.bytesBase64?Buffer.from(image.bytesBase64,'base64'):readFileSync(image.path);
   if(hash(bytes)!==image.sha256)throw new Error('MEDIA_HASH_MISMATCH');
   const staged=await bridge.host('stage-media',{name:image.name,bytesBase64:bytes.toString('base64'),sha256:image.sha256});
   const readback=await bridge.host('push-owned-media',{name:staged.name});const actual=readback.media.find(x=>x.name===image.name);
   if(!actual||actual.phoneSha256!==image.sha256)throw new Error('PHONE_MEDIA_HASH_MISMATCH');
   return{status:'staged-to-device',pddUploadVerified:false,...actual};
  },
  async back(){return bridge.host('back');},
  async submit(){throw new Error('PRODUCTION_GATE_CLOSED');},
  async finish(){return bridge.finish();},
 };
}
