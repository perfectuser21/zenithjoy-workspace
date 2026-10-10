import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const script=new URL('../douyin-phone-adb',import.meta.url).pathname;
const fixture=new URL('./fixtures/real-ai30-screen3-grid-no-duration.xml',import.meta.url);
function parse(xml,{directory=false,missing=false}={}){
 const dir=mkdtempSync(join(tmpdir(),'video-card-optional-')),reg=join(dir,'profiles.tsv'),path=directory?dir:join(dir,'grid.xml');
 writeFileSync(reg,'legacy\tSER1\tANY-MODEL\t1199\t2663\n');if(!directory&&!missing)writeFileSync(path,xml);
 return spawnSync('zsh',[script,'--profile','legacy','video-cards-from-xml',path],{encoding:'utf8',env:{...process.env,HOME:dir,DOUYIN_PHONE_REGISTRY:reg,TMPDIR:dir,DOUYIN_ADB_BIN:'/usr/bin/false'}});
}
test('原AI30第三屏61节点零时长：纯CLI解析正常输出2张几何有效真实卡片且DUR为空',()=>{
 const xml=readFileSync(fixture,'utf8');assert.equal((xml.match(/<node\b/g)||[]).length,61);assert.equal((xml.match(/text="\d{1,2}:\d{2}"/g)||[]).length,0);
 const r=parse(xml);assert.equal(r.status,0,r.stderr);const rows=r.stdout.trim().split('\n').map(x=>x.split('\t'));
 assert.equal(rows.length,2);assert.deepEqual(rows.map(r=>r.slice(0,2)),[["303","2261"],["897","1359"]]);for(const row of rows){assert.equal(row.length,5);assert.equal(row[2],'');assert.ok(row[3].length>=8);}
});
const fullGrid=readFileSync(new URL('./fixtures/real-search-results-grid.xml',import.meta.url),'utf8');
for(const [name,xml] of Object.entries({text:fullGrid.replace(/text="[^"]*"/g,'text=""'),likes:fullGrid.replace(/喜欢/g,'其他'),long_title:fullGrid.replace(/text="([^"]*)"/g,(m,t)=>/^\d{1,2}:\d{2}$/.test(t)?m:'text="X"'),related_search:'<hierarchy><node text="相关搜索：AI是什么" bounds="[0,0][1000,500]" /></hierarchy>'}))test('可选字段无匹配正常空清单且相关搜索不误当卡片：'+name,()=>{
 const r=parse(xml);assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'');
});
test('纯解析不可读输入或真实grep2读取目录仍失败，不把IO错误吞成空清单',()=>{
 for(const opts of [{missing:true},{directory:true}]){const r=parse('',opts);assert.equal(r.status,opts.directory?2:1);assert.equal(r.stdout.trim(),'');}
});
