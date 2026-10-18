// 独立进程服务真实TCP；spawnSync控制器测试阻塞父event loop时仍能响应。
import net from 'node:net';
import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const workerPath=fileURLToPath(import.meta.url);
if(process.argv[1]===workerPath){
const [file,parent]=process.argv.slice(2);
const s=net.createServer(c=>{let b=Buffer.alloc(0);c.on('error',()=>{});c.on('data',value=>{
 b=Buffer.concat([b,value]);if(b.length<4)return;const n=parseInt(b.subarray(0,4).toString(),16);if(b.length<4+n)return;
 const q=b.subarray(4,4+n).toString(),v=q==='host:version'?'0029':q==='host:devices'?'SER1\tdevice\n47.100.213.173:10001\tdevice\n':null;
 if(v===null){c.end('FAIL0007invalid');return;}const data=Buffer.from(v);c.end(Buffer.concat([Buffer.from('OKAY'+data.length.toString(16).padStart(4,'0')),data]));
});});
s.listen(0,'127.0.0.1',()=>writeFileSync(file,String(s.address().port)));
setInterval(()=>{try{process.kill(Number(parent),0);}catch{process.exit(0);}},500).unref();

}
