import {closeSync,constants,fstatSync,linkSync,lstatSync,mkdirSync,mkdtempSync,openSync,readSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

const extensions=/\.(xml|png|jpe?g|json|txt|wav|mkv|m4a)$/i;
const digest=data=>createHash('sha256').update(data).digest('hex');
const maxBytes=128*1024*1024;

export function readArtifact(path,startMs) {
  if(realpathSync(path)!==path)throw Error('unsafe path');
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=fstatSync(fd);
    if(!before.isFile()||before.uid!==process.getuid()||before.nlink!==1
      ||before.mode&0o022||before.mtimeMs<startMs||before.size<1||before.size>maxBytes)
      throw Error('unsafe artifact');
    const bytes=Buffer.alloc(before.size);
    const count=readFileSyncBounded(fd,bytes);
    const after=fstatSync(fd),named=lstatSync(path);
    if(count!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs
      ||after.ctimeMs!==before.ctimeMs||!named.isFile()||named.ino!==before.ino||named.dev!==before.dev)
      throw Error('changed artifact');
    return bytes;
  }finally{closeSync(fd);}
}

function readFileSyncBounded(fd,buffer) {
  let offset=0;
  while(offset<buffer.length) {
    const count=readSync(fd,buffer,offset,buffer.length-offset,null);
    if(count===0)break;
    offset+=count;
  }
  return offset;
}

export function fetchStandaloneNativeEvidence({input,evidenceRoot,runDirectory,startSeconds,returnedEvidenceIds}) {
  try {
    const file=input?.args?.[0];
    if(Object.keys(input??{}).join(',')!=='args'||!Array.isArray(input.args)||input.args.length!==1
      ||typeof file!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(file)||!extensions.test(file)
      ||!Number.isSafeInteger(startSeconds)||startSeconds<0
      ||![...returnedEvidenceIds].some(id=>file.startsWith(id+'.')||file.startsWith(id+'-')))
      throw Error('unissued artifact');
    const bytes=readArtifact(join(evidenceRoot,file),startSeconds*1000);
    return publishNativeFile(runDirectory,file,bytes);
  } catch {
    const code='STANDALONE_COLLECTION_NATIVE_FILE_SCOPE';
    throw Object.assign(Error(code),{code});
  }
}


export function publishNativeFile(runDirectory,file,bytes,folder='native') {
  const native=join(runDirectory,folder);
  mkdirSync(native,{mode:0o700,recursive:true});
  const directory=lstatSync(native);
  if(!directory.isDirectory()||directory.uid!==process.getuid()||(directory.mode&0o777)!==0o700
    ||realpathSync(native)!==native)throw Error('unsafe destination');
  const path=join(native,file),sha256=digest(bytes);
  const staging=mkdtempSync(join(native,'.artifact-'));
  try{
    const stagedFile=join(staging,file);
    writeFileSync(stagedFile,bytes,{mode:0o600,flag:'wx'});
    try{linkSync(stagedFile,path);}
    catch(error){if(error.code!=='EEXIST'||digest(readArtifact(path,0))!==sha256)throw error;}
  }finally{rmSync(staging,{recursive:true,force:true});}
  return {path:folder+'/'+file,sha256,bytes:bytes.length};
}

const receiptCommands=new Set(['current-video-link','record-start','record-stop','record-extract-audio']);

export function withStandaloneQualificationReceipt({runDirectory,command,args,result,qualificationReceipts}) {
  if(!receiptCommands.has(command))return result;
  try {
    const id=args[0];
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,119}$/.test(id)||result.code!==0
      ||typeof result.stdout!=='string'||Buffer.byteLength(result.stdout)>1024*1024)
      throw Error('invalid phone result');
    const bytes=Buffer.from(JSON.stringify({args:[command,...args.map(String)],exit_code:result.code,stdout:result.stdout})+'\n');
    const reference=publishNativeFile(runDirectory,`receipt-${command}-${id}.json`,bytes);
    qualificationReceipts.set(command,reference);
    return {...result,native_receipt:reference};
  } catch {
    const code='STANDALONE_COLLECTION_NATIVE_RECEIPT_WRITE';
    throw Object.assign(Error(code),{code});
  }
}

function proofError(reason) {
  const code='STANDALONE_COLLECTION_PROOF_'+reason;
  return Object.assign(Error(code),{code});
}

function verifyProofReferences(value,runDirectory) {
  if(!value||typeof value!=='object')return;
  if(!Array.isArray(value)&&Object.hasOwn(value,'path')){
    const path=value.path;
    if(typeof path!=='string'||!['native','receipts'].some(root=>path.startsWith(join(runDirectory,root)+'/'))
      ||!/^([a-f0-9]{64})$/.test(value.sha256??'')||digest(readArtifact(path,0))!==value.sha256)
      throw proofError('REFERENCE_MISMATCH');
  }
  for(const child of Object.values(value))verifyProofReferences(child,runDirectory);
}

export function publishStandaloneQualificationProof({input,runDirectory,runIdentity,videoId,recording,qualificationReceipts,fetchedArtifacts}) {
  try {
    if(Object.keys(input??{}).join(',')!=='args'||!Array.isArray(input.args)||input.args.length!==1
      ||typeof input.args[0]!=='string'||Buffer.byteLength(input.args[0])>65536||!videoId||!recording?.audioOutput)
      throw proofError('INPUT');
    const proposal=JSON.parse(input.args[0]),spec=proposal?.qualification_evidence?.[videoId];
    if(Object.keys(proposal??{}).join(',')!=='qualification_evidence'||spec?.video_id!==videoId
      ||spec.expected_run!==runIdentity.run_tag||spec.evidence_id!==recording.id)
      throw proofError('SCOPE');
    for(const [command,key] of [['current-video-link','video_identity'],['record-start','start'],
      ['record-stop','stop'],['record-extract-audio','extraction']]){
      const issued=qualificationReceipts.get(command);
      if(!issued||spec[key]?.path!==join(runDirectory,issued.path)||spec[key].sha256!==issued.sha256)
        throw proofError('RECEIPT_MISMATCH');
    }
    const native=join(runDirectory,'native'),visual=proposal.qualification_evidence;
    if(spec.wav?.path!==join(native,recording.id+'.16k.wav')||spec.recording?.path!==join(native,recording.id+'.rec.mkv')
      ||!Object.keys(spec.sidecars??{}).length||!(spec.coverage_json??visual.coverage_json)?.path
      ||!(spec.coverage_image??visual.coverage_image)?.path||!(spec.visual_observations??visual.visual_observations)?.length)
      throw proofError('MEDIA_MISSING');
    for(const asset of [spec.wav,spec.recording,...Object.values(spec.sidecars)]){
      if(!asset?.path||fetchedArtifacts.get(asset.path)!==asset.sha256)
        throw proofError('REFERENCE_MISMATCH');
    }
    verifyProofReferences(proposal,runDirectory);
    const bytes=Buffer.from(JSON.stringify({schema:'activity-evidence/v1',identity:runIdentity,...proposal})+'\n');
    return {proof_manifest:publishNativeFile(runDirectory,'qualification-proof.json',bytes),supplied_raw_references:true,acceptance_not_asserted:true};
  } catch(error) {
    if(error.code?.startsWith('STANDALONE_COLLECTION_PROOF_'))throw error;
    throw proofError('INVALID');
  }
}
