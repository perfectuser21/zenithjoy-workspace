import {createHash} from 'node:crypto';
import {publishNativeFile} from './standalone-native-evidence.mjs';

const fail=reason=>{
  const code='STANDALONE_COLLECTION_'+reason;
  throw Object.assign(Error(code),{code});
};
const argsOnly=(input,count)=>Object.keys(input??{}).join(',')==='args'&&Array.isArray(input.args)&&input.args.length===count;

export function standaloneCollectionHandoff({runDirectory,runIdentity,scope,readCentralLease,readDevice,prepareComment,readComments}) {
  const tools=[];
  if(readCentralLease)tools.push('brain');
  if(readDevice)tools.push('native-readback');
  if(prepareComment)tools.push('collection-evidence','collection-readback');

  function receipt(label,result){
    const bytes=Buffer.from(JSON.stringify({identity:runIdentity,tool:label,result})+'\n');
    const sha=createHash('sha256').update(bytes).digest('hex');
    return publishNativeFile(runDirectory,label+'-'+sha+'.json',bytes);
  }
  return {
    tools,
    async call(kind,input) {
      if(kind==='brain'){
        if(!argsOnly(input,1)||input.args[0]!=='device-locks')fail('BRAIN_READ_SCOPE');
        const lease=await readCentralLease();
        if(lease?.locked_by!==runIdentity.task_id||lease.device_name!==scope.serial||lease.lease_version==null)
          fail('DEVICE_CONTEXT');
        const lock={device_name:lease.device_name,locked_by:lease.locked_by,lease_version:lease.lease_version};
        return {locks:[lock],receipt:receipt('central-lease-readback',lock)};
      }
      if(kind==='native-readback'){
        if(!argsOnly(input,0))fail('NATIVE_READBACK_SCOPE');
        const result=await readDevice();
        return {...result,receipt:receipt('device-context',result),release_owner:'standalone-host'};
      }
      if(kind==='collection-evidence'){
        if(!argsOnly(input,1)||typeof input.args[0]!=='string'||Buffer.byteLength(input.args[0])>1024)fail('COMMENT_SCOPE');
        let selection;
        try {selection=JSON.parse(input.args[0]);} catch {fail('COMMENT_SCOPE');}
        if(Object.keys(selection??{}).join(',')!=='index'||!Number.isSafeInteger(selection.index)||selection.index<0)
          fail('COMMENT_SCOPE');
        return prepareComment(selection.index);
      }
      if(!argsOnly(input,0))fail('COMMENT_READBACK');
      const result=await readComments();
      return {...result,receipt:receipt('collection-readback',result)};
    },
  };
}

export function createCollectionEvidenceReceipt({runDirectory,runIdentity,videoId,id,comment,originals}) {
  const bytes=Buffer.from(JSON.stringify({identity:runIdentity,comment,originals:originals??null})+'\n');
  return {reference:id,video_id:videoId,evidence:publishNativeFile(runDirectory,'comment-evidence-'+id+'.json',bytes)};
}

export async function readCommittedCollection({owned,qualified,pendingLookups,committedLookups,readComment,scope}) {
  if(!owned||!qualified||pendingLookups.size)fail('COMMENT_READBACK');
  for(const [id,comment] of committedLookups){
    const read=await readComment(comment);
    if(read.verified!==true||read.comment_id!==id||read.video_id!==owned.video_id)fail('COMMENT_READBACK');
  }
  const complete=committedLookups.size===scope.comment_limit;
  return {source_run:scope.source_run,video_id:owned.video_id,video_url:owned.video_url,comment_ids:[...committedLookups.keys()],
    qualification:'matched',sample_target:scope.comment_limit,coverage:complete?'sampled':'partial'};
}

export function createCollectionDeviceReader(readDeviceContext,setReady) {
  let snapshot;
  return async ({refresh=false}={})=>{
    if(snapshot&&!refresh)return snapshot;
    setReady(false);
    snapshot=undefined;
    const current=await readDeviceContext(),state=String(current.device).split('\n');
    if(state.filter(line=>line.startsWith('state=')).join('')!=='state=device'
      ||state.filter(line=>line.startsWith('call_state=')).join('')!=='call_state=idle')fail('DEVICE_CONTEXT');
    snapshot=current;
    setReady(true);
    return snapshot;
  };
}

export const collectionHostToolInputs={
  brain:{args:['device-locks']},
  'native-readback':{args:[]},
  'fetch-native':{args:['<本轮手机原件 basename>']},
  proof:{args:['<JSON: qualification_evidence 按 VID 索引，本轮原件引用用绝对路径和 SHA-256>']},
  'qualify-prepare':{args:['<VID>','<本轮绝对 WAV 路径>'],action_name:'<准备动作名>'},
  'qualify-submit':{args:['<VID>','<同一 WAV 路径>','<正式资格提案 JSON>'],action_name:'<提交动作名>'},
  'collection-evidence':{args:['{"index":0}']},
  'collection-readback':{args:[]},
};
