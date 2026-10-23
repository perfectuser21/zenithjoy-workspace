// 可选的单VID原producer描述符；只是冻结来源，不授予恢复/设备/发送权限。
import {openSync,readFileSync,fstatSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
const fixed={schema_version:1,workflow_key:'douyin_video_discovery',run_tag:'cicd24c9_101_20261023_2013',source_commit:'24c9e6b97b81ae144985474d9e33665bf65a6a8e',profile:'legacy',serial:'ANGYVB4402004137',line:'jinuo',company_id:'ef8e14b0-4018-4e54-bc7a-866e51a0ce0b',tenant_id:'a4ca8914-f5a7-4928-b1e3-6b69f9c0ab61',company_config_version:14,policy_id:'jinoshengyuan-existing-acquisition-rules-v1'};
const keys=[...Object.keys(fixed),'snapshot_sha256','progress_sha256','video_ids'].sort(),fail=()=>{throw Error('PRODUCER_DESCRIPTOR_INVALID');};
export function validateProducerDescriptor(d){
 if(!d||typeof d!=='object'||Array.isArray(d)||JSON.stringify(Object.keys(d).sort())!==JSON.stringify(keys)||Object.entries(fixed).some(([k,v])=>d[k]!==v)
  ||!['snapshot_sha256','progress_sha256'].every(k=>/^[a-f0-9]{64}$/.test(d[k]||''))||!Array.isArray(d.video_ids)||d.video_ids.length!==1||d.video_ids[0]!=='7699316353698753663')fail();
 return structuredClone(d);
}
export function readProducerDescriptor(path){
 if(typeof path!=='string'||!path.startsWith('/'))fail();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const s=fstatSync(fd);if(!s.isFile()||s.nlink!==1||s.uid!==process.getuid()||(s.mode&0o777)!==0o600||s.size>32768)fail();return validateProducerDescriptor(JSON.parse(readFileSync(fd,'utf8')));}finally{closeSync(fd);}
}
export function verifyProducerDescriptor(d,{upstream,progressRaw,progress,env,company}){
 d=validateProducerDescriptor(d);const r=upstream.run_identity;
 if(upstream.deployment.source_commit!==d.source_commit||upstream.snapshot_sha256!==d.snapshot_sha256||r?.capability!==d.workflow_key||r.tag!==d.run_tag||r.profile!==d.profile||r.serial!==d.serial
  ||createHash('sha256').update(progressRaw).digest('hex')!==d.progress_sha256||progress.run!==d.run_tag||progress.profile!==d.profile||env.LEADGEN_SOURCE_RUN!==d.run_tag||env.P!==d.profile||env.SERIAL!==d.serial||env.LEADGEN_LINE!==d.line
  ||company?.company_id!==d.company_id||company.tenant_id!==d.tenant_id||company.version!==d.company_config_version||company.policy_id!==d.policy_id||d.video_ids.some(id=>!progress.videos?.some(v=>v.videoId===id)))fail();
 return d;
}
export function verifyProducerCompany(d,p){
 if(p?.verified!==true||p.run_id!==d.run_tag||p.company_id!==d.company_id||p.tenant_id!==d.tenant_id||p.version!==d.company_config_version||p.policy_id!==d.policy_id)fail();
}
