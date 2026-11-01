import {createHash} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import{authorizedImageBytes}from'./authorized-media.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=new Set(['保存草稿','提交并上架','编辑','下架','改库存','改价','发送','聊天','全选','立即复制','添加账号','管理']);

export function createNativeTransport(config,bridge){
 const root=resolve(config.root);mkdirSync(root,{recursive:true,mode:0o700});let sequence=0;
 function draftWrites(){if(config.allowDraftWrites!==true)throw new Error('DRAFT_WRITES_NOT_AUTHORIZED');}
 function approval(value){if(!/^[a-f0-9]{64}$/.test(value?.approvedScreenSha256||''))throw new Error('FRESH_VISUAL_APPROVAL_REQUIRED');return value.approvedScreenSha256;}
 function saveFrame(result){
  if(result.frame?.screenSha256!==result.picture?.sha256||result.frame?.xmlSha256!==result.tree?.sha256)throw new Error('FRAME_DIGEST_MISMATCH');
   const id=String(++sequence).padStart(4,'0');
   for(const[key,extension]of[['picture','png'],['tree','xml'],...(result.statusBarRaw?[['statusBarRaw','txt']]:[])]){
    const bytes=Buffer.from(result[key].bytesBase64,'base64');if(hash(bytes)!==result[key].sha256)throw new Error('EVIDENCE_HASH_MISMATCH');
    if(key==='picture'&&(bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a'))throw new Error('INVALID_SCREENSHOT');
    const path=join(root,`frame-${id}.${extension}`);writeFileSync(path,bytes,{flag:'wx',mode:0o600});result[key].localPath=path;delete result[key].bytesBase64;
   }
   const path=join(root,`frame-${id}.json`);writeFileSync(path,JSON.stringify(result,null,2),{flag:'wx',mode:0o600});return{...result,manifest:path};
 }
 function saveObserved(result){if(result.observedFrame){try{result.observedFrame=saveFrame(result.observedFrame);}catch(error){error.deviceActionCompleted=true;error.requiresReadback=true;throw error;}}return result;}
 return{
  productionEnabled:false,
  async capture(){return saveFrame(await bridge.host('observe'));},
  async bootstrapBack(proof){return bridge.host('bootstrap-back',{approvedScreenSha256:approval(proof),preparationOnly:proof.preparationOnly===true});},
  async resolveBack(proof){return bridge.host('resolve-back',{approvedScreenSha256:approval(proof)});},
  async launch(){return bridge.host('launch');},
  async navigate(label,proof){
   if(denied.has(label)||typeof label!=='string')throw new Error('FORBIDDEN_CONTROL');
   return bridge.host('navigate',{label,approvedScreenSha256:approval(proof)});
  },
  async approveDraft(proof){draftWrites();return bridge.host('approve-draft',{approvedScreenSha256:approval(proof)});},
  async setField(field,value,proof){
   draftWrites();if(!['title','groupPrice','inventory'].includes(field))throw new Error('FORBIDDEN_FIELD');
   value=String(value);
   if((field==='title'&&(!value.trim()||Array.from(value).reduce((n,c)=>n+(c.codePointAt(0)>127?2:1),0)>60||/[\u0000-\u001f]/.test(value)))||(field==='inventory'&&!/^\d{1,7}$/.test(value))||(field==='groupPrice'&&(!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(value)||Number(value)<=0)))throw new Error('INVALID_FIELD_VALUE');
   const result=await bridge.host('set-field',{field,value,approvedScreenSha256:approval(proof)});
   if(result.ok!==true||result.value!==value||!result.evidence?.length)throw new Error('NATIVE_READBACK_MISMATCH');return result;
  },
  async stageImage(image,prepare=false){
   if(prepare){if(config.allowMaterialPreparation!==true)throw new Error('MATERIAL_PREPARATION_NOT_AUTHORIZED');}else draftWrites();const bytes=authorizedImageBytes(config,image);
   if(hash(bytes)!==image.sha256)throw new Error('MEDIA_HASH_MISMATCH');
   const readback=await bridge.host(prepare?'prepare-media':'stage-and-push-media',{name:image.name,bytesBase64:bytes.toString('base64'),sha256:image.sha256});const actual=readback.media.find(x=>x.name===image.name);
   if(!actual||actual.phoneSha256!==image.sha256)throw new Error('PHONE_MEDIA_HASH_MISMATCH');
   return{status:'staged-to-device',pddUploadVerified:false,...actual,leaseProof:readback.leaseProof};
  },
  async picker(action,proof){draftWrites();if(!['more','permission','select','confirm'].includes(action))throw new Error('FORBIDDEN_PICKER_ACTION');return saveObserved(await bridge.host('picker-'+action,{approvedScreenSha256:approval(proof),...(action==='select'?{mediaId:String(proof.mediaId)}:{})}));},
  async gallery(action,proof){draftWrites();if(!['state','menu','album','select','upload','back','refresh'].includes(action))throw new Error('FORBIDDEN_GALLERY_ACTION');return saveObserved(await bridge.host('gallery-'+action,{approvedScreenSha256:approval(proof),...(action==='select'?{visualBinding:structuredClone(proof.visualBinding)}:{})}));},
  async organizeMedia(prepare=false){if(prepare){if(config.allowMaterialPreparation!==true)throw new Error('MATERIAL_PREPARATION_NOT_AUTHORIZED');}else draftWrites();return bridge.host(prepare?'prepare-album':'organize-media');},
  async discardDraft(proof){draftWrites();return bridge.host('discard-draft',{approvedScreenSha256:approval(proof)});},
  async back(){return bridge.host('back');},
  async submit(){throw new Error('PRODUCTION_GATE_CLOSED');},
  async finish(){return bridge.finish();},
 };
}
