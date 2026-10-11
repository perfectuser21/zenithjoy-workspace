import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCopiedShareLink,handleRpc} from '../leadgen-rpc.mjs';

const short='https://v.douyin.com/yjrYaiSbMcg/';
const actual='https://www.iesdouyin.com/share/video/7617105883093603314/?region=CN';
const headers=location=>`HTTP/2 302\r\nLocation: ${location}\r\n\r\n`;
test('实际失败短链在同版本执行端只读HEAD得到实际ID，无PG或正文抓取',async()=>{
 const calls=[];
 const execute=async(cmd,args,opts)=>{calls.push({cmd,args,opts});return {stdout:headers(actual)};};
 const r=await resolveCopiedShareLink(short,{execute});
 assert.deepEqual(r,{resolved_url:'https://www.douyin.com/video/7617105883093603314',content_id:'7617105883093603314',content_type:'video'});
 assert.equal(calls.length,1);assert.equal(calls[0].cmd,'curl');assert.ok(calls[0].args.includes('-I'));assert.ok(calls[0].args.includes('10'));assert.ok(calls[0].opts.timeout<=12000);
});
for(const url of ['http://v.douyin.com/test/','https://v.douyin.com.evil.com/test/','https://user@v.douyin.com/test/','https://v.douyin.com:444/test/','https://localhost/test/','https://evil.com/?url=https://v.douyin.com/test/']){
 test('拒绝非受信短链且不发请求 '+url,async()=>{
  let called=false;await assert.rejects(resolveCopiedShareLink(url,{execute:async()=>{called=true;}}),/RPC_SHARE_LINK_INVALID/);assert.equal(called,false);
 });
}
test('不跟随不受信跳转，也不把200的Location当真实跳转',async()=>{
 await assert.rejects(resolveCopiedShareLink(short,{execute:async()=>({stdout:headers('https://evil.com/video/7617105883093603314')})}),/RPC_SHARE_LINK_UNTRUSTED/);
 await assert.rejects(resolveCopiedShareLink(short,{execute:async()=>({stdout:`HTTP/2 200\r\nLocation: ${actual}\r\n`})}),/RPC_SHARE_LINK_HTTP/);
});
test('最多两跳；中间受信短链可跟随，缺真实ID则不编造',async()=>{
 let calls=0;const execute=async()=>({stdout:headers(++calls===1?'https://v.douyin.com/next/':actual)});
 const r=await resolveCopiedShareLink(short,{execute});assert.equal(calls,2);assert.equal(r.content_id,'7617105883093603314');
 calls=0;await assert.rejects(resolveCopiedShareLink(short,{execute:async()=>{calls++;return {stdout:headers('https://v.douyin.com/next/')};}}),/RPC_SHARE_LINK_ID_MISSING/);assert.equal(calls,2);
});
test('源未核验不请求；解析分支无需PG',async()=>{
 let calls=0;const execute=async()=>{calls++;return {stdout:headers(actual)};};
 await assert.rejects(handleRpc({kind:'resolve_share_link',url:short},{verify:()=>{throw Error('UNVERIFIED');},resolveExec:execute}),/UNVERIFIED/);assert.equal(calls,0);
 const r=await handleRpc({kind:'resolve_share_link',url:short},{verify:()=>{},resolveExec:execute});assert.equal(r.ok,true);assert.equal(r.result.content_id,'7617105883093603314');assert.equal(calls,1);
});
