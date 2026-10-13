// 方法身份只由正式完整workflow闭包推导；物理MMV不等于独立release target。
import {digest} from './runtime-definition.mjs';
import {DEPLOY_REPO} from './deployment-preflight.mjs';
export const METHOD_PROTOCOL='commander-method-v1';
const need=(v,m)=>{if(!v)throw Error('方法包: '+m);};
const same=(a,b)=>digest(a)===digest(b);
export const orderBindings=rows=>[...rows].sort((a,b)=>{for(const k of ['kind','repo','path','revision','digest']){const n=Buffer.compare(Buffer.from(a[k]||''),Buffer.from(b[k]||''));if(n)return n;}return 0;});
export const safetyBinding=p=>(p.startsWith('services/phone-adb-controller/commander/')&&p.split('/').at(-1)!=='wf-report.py'&&(/^(wf-v2|wf-agent|wf-launch|wf-status|wf-method)/.test(p.split('/').at(-1))||p.includes('/skills/workflow-commander/')))||['services/phone-adb-controller/douyin-phone-adb','services/phone-adb-controller/text-input-focus.py'].includes(p);
export function methodManifest(release){
 const p=release.payload;need(p.workflows?.length===1,'必须唯一完整业务Workflow');const w=p.workflows[0];
 need(w.payload.key!=='workflow_commander.internal'&&w.source_repo===DEPLOY_REPO&&/^[a-f0-9]{40}$/.test(w.source_commit),'方法来源无效');
 need(!w.payload.contract?.skill,'unsupported_method_skill: business skill entry');
 const refs=w.payload.activities,ids=new Set(refs.map(r=>r.activity_version_id)),rows=p.activities;
 need(ids.size&&rows.length===ids.size&&new Set(rows.map(a=>a.id)).size===ids.size&&refs.every(r=>rows.some(a=>a.id===r.activity_version_id&&a.activity_id===r.activity_id)),'活动闭包不完整');
 const bindings=new Map();
 for(const a of rows){
  need(!a.payload.contract?.skill,'unsupported_method_skill: activity skill entry');
  need(a.source_repo===w.source_repo&&a.source_commit===w.source_commit,'跨版本活动拼装');const values=a.payload.implementation_bindings||[];
  need(values.every(b=>b.kind!=='skill'||(safetyBinding(b.path||'')&&b.field==='implementation_bindings')),'unsupported_method_skill: business skill execution closure');
  need(values.some(b=>b.scope==='activity'&&b.kind==='code'&&b.status==='verified'),'缺冻结入口');
  for(const b of values){
   if(b.kind==='raw'&&b.status==='unresolved')continue;
   const row={kind:b.kind,repo:b.repo??b.raw?.repo??a.source_repo,path:b.path,revision:b.revision,digest:b.digest};
   need(['code','skill'].includes(row.kind)&&b.status==='verified'&&row.repo===w.source_repo&&row.revision===w.source_commit&&/^sha256:[a-f0-9]{64}$/.test(row.digest||''),'未验证绑定');
   need(typeof row.path==='string'&&/^[A-Za-z0-9_.\/-]+$/.test(row.path)&&!row.path.startsWith('/')&&!row.path.split('/').some(x=>['','.','..'].includes(x)),'不支持的源码路径');
   need(row.kind!=='skill'||(safetyBinding(row.path)&&b.field==='implementation_bindings'),'unsupported_method_skill: business skill execution closure');
   need(!bindings.has(row.path)||same(bindings.get(row.path),row),'源码路径冲突');bindings.set(row.path,row);
  }
 }
 const list=orderBindings([...bindings.values()]),source={repo:w.source_repo,revision:w.source_commit};
 need(list.some(b=>b.kind==='code'&&!safetyBinding(b.path)),'方法缺实际业务code入口，仅安全上下文');
 need(same(orderBindings(p.components),orderBindings([{kind:'repo',...source},...list])),'组件不是完整冻结闭包');
 return{protocol:METHOD_PROTOCOL,workflow:{key:w.payload.key,workflow_id:w.workflow_id,workflow_definition_version_id:w.id,snapshot_sha256:w.payload_sha256},source,bindings:list};
}
export function methodComponents(definitions,sha){
 const entries=[];
 for(const a of definitions.activities)for(const b of a.payload.implementation_bindings||[]){if(b.kind==='raw'&&b.status==='unresolved')continue;entries.push({kind:b.kind,repo:b.repo??b.raw?.repo??a.source_repo,path:b.path,revision:b.revision,digest:b.digest});}
 const unique=[...new Map(entries.map(b=>[JSON.stringify(b),b])).values()];return orderBindings([{kind:'repo',repo:DEPLOY_REPO,revision:sha},...unique]);
}
export function methodObservation(release,observed,home){
 const manifest=methodManifest(release),sha=digest(manifest),target='mmv--method--'+sha,root=home+'/.local/share/zenithjoy/commander-methods/'+sha;
 need(release.target===target&&release.payload.verification?.status==='verified','方法正式release未验证');
 const bindings=manifest.bindings.map(b=>({...b,absolute_path:root+'/'+b.path})),files=bindings.map(b=>({path:b.path,deployed_path:b.path,content_sha256:b.digest.slice(7)}));
 const m=observed.method_instance,i=observed.installation;
 need(m?.target===target&&m.physical_host==='mmv'&&m.method_root===root&&m.manifest_sha256===sha&&same(m.resolved_bindings,bindings)&&m.resolved_bindings_sha256===digest(bindings),'实际方法路径/绑定不符');
 need(i&&m.installation_sha256===digest(i)&&i.observed_hostname===observed.observed_hostname&&i.source_repo===manifest.source.repo&&i.source_commit===manifest.source.revision&&same(i.files,files),'原始安装事实不符');
 need(i.physical_host==='mmv'&&i.method_root===root&&i.manifest_sha256===sha&&i.resolved_bindings_sha256===digest(bindings),'安装实例身份不符');
 need([i.root_identity,...(i.file_identities||[])].every(x=>Number.isSafeInteger(x?.st_dev)&&Number.isSafeInteger(x?.st_ino)&&x.st_ino>0)&&i.file_identities?.length===bindings.length&&same(i.file_identities.map(x=>x.path),bindings.map(b=>b.absolute_path)),'缺实机inode原件');
 need(same(observed.files,files),'实际闭包字节不符');
 const metadata=Object.fromEntries(['physical_host','method_root','manifest_sha256','resolved_bindings_sha256','installation_sha256'].map(k=>[k,m[k]]));
 // 这里字段名均ASCII；仍用共享canonical以保持evidence_ref可跨语言重算。
 return {target,metadata,manifest:{source_repo:manifest.source.repo,source_commit:manifest.source.revision,files}};
}
