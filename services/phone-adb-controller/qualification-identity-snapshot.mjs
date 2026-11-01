import {createHash} from 'node:crypto';
import {closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,writeSync} from 'node:fs';
import {join} from 'node:path';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const videoIdPattern=/^\d{16,24}$/;
const runPattern=/^[A-Za-z0-9_-]+$/;
const shaPattern=/^[a-f0-9]{64}$/;

function assertIdentity(identity,run,videoId){
  const prefix=`${run}-v${videoId}-`;
  if(identity?.verified!==true||identity.expected_video_id!==videoId
    ||identity.observed_video_id!==videoId||identity.content_type!=='video'
    ||identity.excluded_non_video!==false||typeof identity.evidence_id!=='string'
    ||!identity.evidence_id.startsWith(prefix)
    ||!/^(?:identity|qualification)(?:-recovery[1-9]\d*)?-identity$/.test(identity.evidence_id.slice(prefix.length)))
    throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
}

function readPrivateFile(file){
  const stat=lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077)!==0||stat.size>1000000)
    throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
  return readFileSync(file);
}

export function readQualificationIdentitySnapshot({dir,run,videoId,sha256}){
  if(!runPattern.test(run||'')||!videoIdPattern.test(videoId||'')||!shaPattern.test(sha256||''))
    throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
  const file=join(dir,`${run}-qualification-identity-${videoId}-${sha256}.json`);
  const bytes=readPrivateFile(file);
  if(digest(bytes)!==sha256)throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
  let identity;
  try{identity=JSON.parse(bytes.toString('utf8'));}catch{throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');}
  assertIdentity(identity,run,videoId);
  return {identity,sha256};
}

export function freezeQualificationIdentity({dir,run,videoId}){
  if(!runPattern.test(run||'')||!videoIdPattern.test(videoId||''))
    throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
  const bytes=readPrivateFile(join(dir,`${run}-identity-${videoId}.json`));
  let identity;
  try{identity=JSON.parse(bytes.toString('utf8'));}catch{throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');}
  assertIdentity(identity,run,videoId);
  const sha256=digest(bytes),file=join(dir,`${run}-qualification-identity-${videoId}-${sha256}.json`);
  if(!existsSync(file)){
    const fd=openSync(file,'wx',0o600);
    try{writeSync(fd,bytes);fsyncSync(fd);}finally{closeSync(fd);}
  }
  const snapshot=readQualificationIdentitySnapshot({dir,run,videoId,sha256});
  if(snapshot.sha256!==sha256)throw Error('SAMPLING_ADMISSION_IDENTITY_INVALID');
  return {sha256};
}
