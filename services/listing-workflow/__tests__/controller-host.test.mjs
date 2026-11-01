import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync}from'node:child_process';
import{existsSync}from'node:fs';
const helper=new URL('../controller-host.py',import.meta.url).pathname;
function run(body){if(!existsSync(helper))return{error:'HELPER_UNAVAILABLE'};const script=`import importlib.util,json,tempfile,pathlib,hashlib,base64\ns=importlib.util.spec_from_file_location('h',${JSON.stringify(helper)});h=importlib.util.module_from_spec(s);s.loader.exec_module(h)\n${body}`;const r=spawnSync('python3',['-c',script],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout);}
test('creates an isolated truthful profile without changing the central registry',()=>{
 const result=run(`with tempfile.TemporaryDirectory() as t:\n p=pathlib.Path(t);(p/'.config/openclaw').mkdir(parents=True);source=p/'.config/openclaw/douyin-phone-profiles.tsv';source.write_text('#profile\\tserial\\tmodel\\twidth\\theight\\tenabled\\nxiaolongxia\\tSERIAL\\tMODEL\\t1200\\t2664\\ttrue\\n');before=source.read_bytes();row=h.read_profile(p,'xiaolongxia');root=p/'private';root.mkdir();target=h.private_profile(root,'pddrun',row);print(json.dumps({'row':row,'same':source.read_bytes()==before,'private':target.read_text()}))`);
 assert.equal(result.same,true);assert.equal(result.row.serial,'SERIAL');assert.match(result.private,/pddrun\tSERIAL\tMODEL\t1200\t2664/);
});
test('stages only expected immutable bytes and rejects changed bytes or traversal names',()=>{
 const result=run(`with tempfile.TemporaryDirectory() as t:\n c={'remoteRoot':t,'ownedMedia':[]};b=b'\\xff\\xd8\\xffimage';q={'bytesBase64':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest(),'name':'IMG_20261101_070000_1.jpg'};first=h.stage_media(c,q);errors=[]\n for changed in [dict(q,sha256='0'*64),dict(q,name='../escape.jpg')]:\n  try:h.stage_media(c,changed)\n  except ValueError as e:errors.append(str(e))\n print(json.dumps({'first':first,'count':len(c['ownedMedia']),'errors':errors}))`);
 assert.equal(result.count,1);assert.match(result.first.path,/IMG_20261101_070000_1.jpg$/);assert.deepEqual(result.errors,['MEDIA_HASH_MISMATCH','INVALID_MEDIA_NAME']);
});
test('host executable rejects arbitrary controller commands before reading profiles or touching a device',()=>{
 if(!existsSync(helper)){assert.fail('HELPER_UNAVAILABLE');return;}const r=spawnSync('python3',[helper],{input:JSON.stringify({action:'controller',command:'tap',args:['1','1']}),encoding:'utf8'});assert.equal(r.status,0);assert.equal(JSON.parse(r.stdout).error,'FORBIDDEN_CONTROLLER_COMMAND');
});

test('phone readback binds the exact MediaStore identity and persists verified ownership',()=>{
 const r=run(`with tempfile.TemporaryDirectory() as t:
 c={'remoteRoot':t,'ownedMedia':[{'name':'IMG_20261101_070000_1.jpg','phonePath':'/sdcard/DCIM/Camera/IMG_20261101_070000_1.jpg','sha256':'a'*64,'phonePlanned':True}]};h.held=lambda c:None
 def adb(c,args,check=True):
  if 'sha256sum' in args:return type('R',(),{'stdout':('a'*64+'  path').encode()})()
  return type('R',(),{'stdout':b'Row: 0 _id=42, _data=/storage/emulated/0/DCIM/Camera/IMG_20261101_070000_1.jpg\\n'})()
 h.adb=adb;result=h.phone_readback(c);print(json.dumps({'result':result,'verified':c['ownedMedia'][0].get('phoneVerified')}))`);
 assert.equal(r.verified,true);assert.equal(r.result.media[0].mediaId,'42');
});
