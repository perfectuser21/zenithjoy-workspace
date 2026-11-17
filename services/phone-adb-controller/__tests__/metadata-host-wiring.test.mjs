import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,copyFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';import {metadataFixture} from './helpers/comment-metadata-fixture.mjs';
const require=createRequire(import.meta.url),m=require('../leadgen-committed-partial.js'),hash=b=>createHash('sha256').update(b).digest('hex'),fixture=JSON.parse(readFileSync(new URL('./fixtures/metadata-host-wiring.json',import.meta.url)));
const probe=String.raw`import sys,json,pathlib,hashlib,subprocess,os,re
packet=json.load(sys.stdin);P=pathlib.Path(packet['root']);H=P/'home';out=[]
for name,item in packet['sources'].items():
 if name=='tool_scope.py':exec(item['source'],globals())
exec(packet['sources']['tools.py']['source'],globals())
def read(p):return {'DATABASE_URL':'fixture','TENCENT_VPS_SECRET_ID':'fixture','TENCENT_VPS_SECRET_KEY':'fixture'}
def envfile(p):return {}
def resource_authority(c):out.append('resource')
def ssh(c,args):return ['fixed-controller']+args
def run(*args,**kw):out.append({'command':args[0],'input':kw.get('input'),'root':kw.get('env',{}).get('LEADGEN_METADATA_RUN_ROOT')});return {'ok':True}
subprocess.run=run
c=packet['context'];t=c['recovery']['collection'];base={'op':'complete_collected_comment_metadata','comment_id':t['existing_comment_id'],'video_id':t['video_id'],'video_url':'https://www.douyin.com/video/'+t['video_id']}
for kind,args in [('business',[json.dumps({**base,'op':'collect_partial'})]),('business',[json.dumps({**base,'comment_id':'other'})]),('qualify',[t['video_id'],'file.wav']),('phone',['record-start',t['evidence_prefix']+'-rec']),('phone',['commenter-identity','1','1',t['expected_nickname_b64'],t['evidence_prefix']+'-identity']),('outreach',[])]:
 try:invoke(c,'collection',kind,args);raise AssertionError('unsafe action accepted')
 except ValueError:pass
 assert not out
invoke(c,'collection','business',[json.dumps(base)]);business=out[-1];assert json.loads(business['input'])['before_snapshot']==t['before_snapshot'];assert business['root']==str(P)
out.clear();invoke(c,'collection','phone',['commenter-profile-card-link',t['video_id'],t['expected_douyin_id'],t['expected_nickname_b64'],t['comment_body_sha256'],t['evidence_prefix']+'-card']);assert out[-1]['command'][1:5]==['--profile',c['profile'],'--lock-owner',c['local_owner']]
print(json.dumps({'rejected':6,'correct_business':True,'correct_card':True}))`;
test('actual host invoke and scope reject new work before dispatch and inject frozen repair bindings',()=>{const root=mkdtempSync(join(tmpdir(),'metadata-host-')),f=metadataFixture();try{mkdirSync(join(root,'native'));mkdirSync(join(root,'output'));const guard=readFileSync(new URL('../qualification-artifacts.py',import.meta.url));writeFileSync(join(root,'qualification-artifacts.py'),guard);const row=f.row,run=row.harvest_batch,producer={task_id:'old-task',run_id:'old-run',run_tag:run},raw=JSON.stringify({schema:'activity-evidence/v1',identity:{...producer,workflow:'102'}}),manifest=join(root,'producer.json');writeFileSync(manifest,raw);const before=m.metadataSnapshot(row),target={video_id:f.video.video_id,person_index:2,existing_comment_id:row.id,expected_douyin_id:row.douyin_id,expected_nickname_b64:Buffer.from(row.nickname).toString('base64'),comment_body_sha256:hash(row.comment_body),recipient_evidence_sha256:m.metadataSnapshotHash(row.recipient_evidence),before_snapshot:before,before_sha256:m.metadataSnapshotHash(before),evidence_prefix:run+'-resume1-r9'};const c={line:row.line_key,assigned_workflow:'102',node:process.execPath,profile:'wuying_android14',local_owner:'fixture-owner',max_candidates:1,comment_limit:1,max_new_comments:0,native_root:join(root,'native'),tasks:{'102':{task_id:'new-task',run_id:'new-run',run_tag:run}},verification:{qualification_sha256:{'qualification-artifacts.py':hash(guard)},'102':{video_ids:[target.video_id]}},recovery:{mode:'qualification-readonly-v1',producer,producer_manifest:{path:manifest,sha256:hash(raw)},collection:target,output_root:join(root,'output')}};
 const sources=structuredClone(fixture),candidate=process.env.METADATA_HOST_CANDIDATE;if(candidate){for(const[name,item]of Object.entries(sources)){const actual=readFileSync(join(candidate,name),'utf8');assert.equal(hash(actual),item.sha256,name+' candidate source pin');if(name==='tool_scope.py')assert.equal(actual,item.source);else for(const part of item.source.split('\n\ndef '))assert.ok(actual.includes(part.startsWith('def ')?part:'def '+part)||actual.includes(part));}}
 const r=spawnSync('/usr/bin/python3',['-c',probe],{input:JSON.stringify({root,context:c,sources}),encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).rejected,6);
 }finally{rmSync(root,{recursive:true,force:true});}});
