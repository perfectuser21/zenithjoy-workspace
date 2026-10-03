import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync,copyFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
const script=new URL('../douyin-phone-adb',import.meta.url).pathname;
const xml=name=>readFileSync(new URL('./fixtures/discovery-fresh-target/'+name,import.meta.url),'utf8');
const kw='人工智能训练师考证',owner='fixture-discovery';
const initial=xml('initial.xml'),moved=xml('moved.xml');
function fixture(frame=moved,opts={}){
 const dir=mkdtempSync(path.join(tmpdir(),'discovery-target-cli-')),reg=path.join(dir,'profiles.tsv'),adb=path.join(dir,'adb'),log=path.join(dir,'calls.jsonl'),framePath=path.join(dir,'frame.xml'),stop=path.join(dir,'stop');
 writeFileSync(reg,'legacy\tSER1\tMOCK\t1199\t2663\n');writeFileSync(framePath,frame);writeFileSync(log,'');
 const lock=path.join(dir,'phone/locks/SER1.lock');mkdirSync(lock,{recursive:true});writeFileSync(path.join(lock,'owner'),opts.foreign?'foreign':owner);
 if(opts.stop)writeFileSync(stop,'');
 writeFileSync(adb,`#!${process.execPath}\nconst fs=require('node:fs'),a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');
if(a.includes('get-state'))console.log('device');else if(a.includes('getprop'))console.log('MOCK');
else if(a.includes('stat'))console.log(fs.statSync(${JSON.stringify(framePath)}).size);
else if(a.includes('pull')){if(a.at(-2).endsWith('.xml'))fs.copyFileSync(${JSON.stringify(framePath)},a.at(-1));else fs.writeFileSync(a.at(-1),'mock-image');${opts.foreignAfterDump?`fs.writeFileSync(${JSON.stringify(path.join(lock,'owner'))},'foreign');`:''}${opts.stopAfterDump?`fs.writeFileSync(${JSON.stringify(stop)},'');`:''}${opts.delayAfterDump?`const until=Date.now()+1100;while(Date.now()<until){}`:''}}
`,{mode:0o755});
 const env={...process.env,DOUYIN_PHONE_REGISTRY:reg,DOUYIN_PHONE_TMP_ROOT:path.join(dir,'phone'),DOUYIN_ADB_BIN:adb,DOUYIN_SIPS_BIN:'/usr/bin/false',DOUYIN_LOCATE_SCRIPT:'/nonexistent-mock-only',DOUYIN_LOCATE_KEY_FILE:'/nonexistent-mock-only'};
 const run=args=>spawnSync('zsh',[script,'--profile','legacy',...args],{env,encoding:'utf8',timeout:15000});
 return {run,stop,dir,calls:()=>readFileSync(log,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse),dispose:()=>rmSync(dir,{recursive:true,force:true})};
}
function target(){const f=fixture(initial);try{const r=f.run(['search-video-cards','initial']);assert.equal(r.status,0,r.stderr);const row=r.stdout.split('\n').find(l=>l.includes('免费培训项目')).split('\t');assert.deepEqual(row.slice(0,2),['303','2385']);return {title:row.slice(3).join('\t'),duration:row[2]};}finally{f.dispose();}}
const card=target();
const args=(f,deadline=Date.now()+30000)=>['tap-search-video-target',Buffer.from(kw).toString('base64'),Buffer.from(card.title).toString('base64'),card.duration,'target',owner,f.stop,String(deadline),'0'];
const taps=f=>f.calls().filter(a=>a.includes('tap'));
test('真实旧CLI复现303,2385；新操作用同一fresh XML点303,1302且只dump一次',()=>{
 const f=fixture();try{const old=f.run(['tap-evidence','303','2385','old','0']);assert.equal(old.status,0,old.stderr);assert.deepEqual(taps(f).at(-1).slice(-2),['303','2385']);
 const r=f.run(args(f));assert.equal(r.status,0,r.stderr);assert.deepEqual(taps(f).at(-1).slice(-2),['303','1302']);assert.equal(f.calls().filter(a=>a.includes('uiautomator')).length,1);
 }finally{f.dispose();}
});
const titleNode=/<node\b[^>]*text="[^\"]*免费培训项目[^\"]*"[^>]*>/;
for(const [name,frame] of [
 ['错词',xml('wrong-keyword.xml')],['header错词且旧卡仍在',moved.replace('text="'+kw+'"','text="人工智能训练师报考流程"')],['未选视频tab',moved.replace('text="视频"','text="综合"')],['视频tab未选且卡仍在',moved.replace(/<node\b[^>]*text="视频"[^>]*>/,node=>node.replace('selected="true"','selected="false"'))],['缺少真实喜欢按钮',moved.replace('content-desc="未点赞，喜欢2223，按钮"','content-desc=""')],
 ['loading','<hierarchy><node text="加载中"/></hierarchy>'],['loading覆盖旧卡',moved.replace('</hierarchy>','<node text="加载中"/></hierarchy>')],['空白','<hierarchy></hierarchy>'],
 ['目标消失',moved.replace(titleNode,'<node text="别的视频" bounds="[39,1237][567,1368]">')],
 ['重名歧义',moved.replace('</hierarchy>',moved.match(titleNode)[0].replace(/>$/,'/>')+'</hierarchy>')],
 ['越界',moved.replace('[39,1237][567,1368]','[39,1237][9999,1368]')],
 ['倒置',moved.replace('[39,1237][567,1368]','[567,1237][39,1368]')],
 ['数字起始属性名',moved.replace('index="0"','9bad="x" index="0"')],['XML禁用裸控制字符',moved.replace('index="0"','index="0\u0001"')],['XML禁用数字实体',moved.replace('index="0"','index="0&#1;"')],
 ['属性缺少空白',moved.replace('index="0" text=', 'index="0"text=')],['属性值裸小于号',moved.replace('index="0"','index="0<"')],
 ['坏XML',moved.replace('</hierarchy>','')],['时长不一致',moved.replaceAll('text="'+card.duration+'"','text="99:99"')],
])test(name+'拒绝并且无tap',()=>{const f=fixture(frame);try{const r=f.run(args(f));assert.notEqual(r.status,0);assert.deepEqual(taps(f),[]);}finally{f.dispose();}});
for(const [name,opts] of [['foreign锁',{foreign:true}],['dump后foreign锁',{foreignAfterDump:true}],['stop',{stop:true}],['dump后stop',{stopAfterDump:true}]])test(name+'无tap',()=>{const f=fixture(moved,opts);try{assert.notEqual(f.run(args(f)).status,0);assert.deepEqual(taps(f),[]);}finally{f.dispose();}});
test('耗尽deadline无tap',()=>{const f=fixture();try{assert.notEqual(f.run(args(f,Date.now()-1)).status,0);assert.deepEqual(taps(f),[]);}finally{f.dispose();}});
test('只部署控制器缺parser时真实CLI拒绝，无仓库fallback',()=>{const f=fixture();try{const lone=path.join(f.dir,'douyin-phone-adb');copyFileSync(script,lone);const r=spawnSync('zsh',[lone,'--profile','legacy',...args(f)],{env:{...process.env,DOUYIN_PHONE_REGISTRY:path.join(f.dir,'profiles.tsv'),DOUYIN_PHONE_TMP_ROOT:path.join(f.dir,'phone'),DOUYIN_ADB_BIN:path.join(f.dir,'adb')},encoding:'utf8'});assert.notEqual(r.status,0);assert.deepEqual(taps(f),[]);}finally{f.dispose();}});

test('真实部署控制器校验分支使用Node校验平铺JS，非法helper拒绝',()=>{
 const deployment=readFileSync(new URL('../deploy.sh',import.meta.url),'utf8');
 const start=deployment.indexOf('      if [[ "$f" == *.py ]]');
 const end=deployment.indexOf('\n      if ssh',start);assert.ok(start>0&&end>start);
 const branch=deployment.slice(start,end);const dir=mkdtempSync(path.join(tmpdir(),'discovery-helper-deploy-'));
 try{mkdirSync(path.join(dir,'bin-harvest'));const file=path.join(dir,'bin-harvest/search-video-target.js');writeFileSync(file,"'use strict';\nconst n=1;\n");
 const run=()=>spawnSync('/bin/bash',['-c',`f=search-video-target.js; dir=bin-harvest\n${branch}\n_ctl_check="\${_ctl_check//\\~\\//$TEST_HOME/}"\n_ctl_check="\${_ctl_check//\\/opt\\/homebrew\\/bin\\/node/$TEST_NODE}"\neval "$_ctl_check"`],{encoding:'utf8',env:{...process.env,TEST_HOME:dir,TEST_NODE:process.execPath}});
 assert.equal(run().status,0,'实际CTL_JS分支不能把JS交给zsh -n');writeFileSync(file,'const broken = ;');assert.notEqual(run().status,0,'非法JS不得通过真实平铺部署门禁');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('dump期间耗尽deadline时已有fresh XML仍不tap',()=>{const f=fixture(moved,{delayAfterDump:true});try{const r=f.run(args(f,Date.now()+1000));assert.notEqual(r.status,0);assert.equal(f.calls().filter(a=>a.includes('uiautomator')).length,1);assert.deepEqual(taps(f),[]);}finally{f.dispose();}});

test('旧scan TSV的XML实体经解码后与fresh帧的完整标题相等',()=>{
 const encoded=card.title+' &amp; &#x1F600; &quot;同词&quot;',decoded=card.title+' & 😀 "同词"';
 const frame=moved.replace('text="'+card.title+'"','text="'+encoded+'"');const f=fixture(frame);
 try{const scan=f.run(['search-video-cards','entity-scan']);assert.equal(scan.status,0,scan.stderr);assert.ok(scan.stdout.includes(encoded));
 const a=args(f);a[2]=Buffer.from(decoded).toString('base64');const r=f.run(a);assert.equal(r.status,0,r.stderr);assert.deepEqual(taps(f).at(-1).slice(-2),['303','1302']);
 }finally{f.dispose();}
});
