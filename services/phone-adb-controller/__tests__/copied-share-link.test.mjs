import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const controller=readFileSync(new URL('../douyin-phone-adb',import.meta.url),'utf8');
function parse(text){
 const fn=controller.match(/extract_copied_share_link\(\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(fn,'必须从实际分享文案识别受信直接链接');
 const r=spawnSync('zsh',['-c',`set -eu;${fn};extract_copied_share_link "$COPY_TEXT"`],{env:{...process.env,COPY_TEXT:text,PYTHON_BIN:'/usr/bin/python3'},encoding:'utf8'});
 return {...r,fields:Object.fromEntries(r.stdout.trim().split('\n').filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}))};
}
test('实际第12条 iesdouyin 长链接保留真实ID并规范化，不依赖 HEAD',()=>{
 const r=parse(readFileSync(new URL('./fixtures/copied-iesdouyin-video.txt',import.meta.url),'utf8'));
 assert.equal(r.status,0,r.stderr);assert.equal(r.fields.canonical_url,'https://www.douyin.com/video/7619696979182935153');
 assert.equal(r.fields.share_url_kind,'direct');assert.equal(r.fields.short_url,'');
 assert.match(r.fields.shared_url,/^https:\/\/www\.iesdouyin\.com\/share\/video\/7619696979182935153\//);
});
test('原短链接继续保留原URL供有界HEAD解析',()=>{
 const r=parse('复制打开抖音 https://v.douyin.com/SfT2BKxGlpM/ 文案');
 assert.equal(r.status,0,r.stderr);assert.equal(r.fields.short_url,'https://v.douyin.com/SfT2BKxGlpM/');assert.equal(r.fields.canonical_url,'');assert.equal(r.fields.share_url_kind,'short');
});
test('直接视频与图文链接识别类型路径，查询参数不进入规范输出',()=>{
 for(const kind of ['video','note']){const r=parse(`https://www.douyin.com/${kind}/7619696979182935153?from=copy`);assert.equal(r.status,0,r.stderr);assert.equal(r.fields.canonical_url,`https://www.douyin.com/${kind}/7619696979182935153`);}
});
for(const text of ['https://www.iesdouyin.com.evil.com/share/video/7619696979182935153/','https://www.iesdouyin.com@evil.com/share/video/7619696979182935153/','https://evil@www.iesdouyin.com/share/video/7619696979182935153/','https://www.iesdouyin.com:444/share/video/7619696979182935153/','http://www.iesdouyin.com/share/video/7619696979182935153/','https://www.iesdouyin.com/share/video/123/','https://www.iesdouyin.com/share/video/7619696979182935153123456789/','https://www.iesdouyin.com/share/user/7619696979182935153/','https://evil.com/?url=https://www.iesdouyin.com/share/video/7619696979182935153/','clipnonce123'])test('拒绝非受信或非内容URL：'+text,()=>{const r=parse(text);assert.notEqual(r.status,0);assert.equal(r.fields.shared_url,undefined);});
test('多个不同受信URL拒绝猜测归属',()=>{const r=parse('https://v.douyin.com/A/ https://www.iesdouyin.com/share/video/7619696979182935153/');assert.notEqual(r.status,0);assert.match(r.stderr,/SHARE_LINK_AMBIGUOUS/);});
