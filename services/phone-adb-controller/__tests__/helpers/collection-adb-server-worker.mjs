// 真ADB server独立于Commander观察循环；夹具也使用独立事件循环，保留原socket时限。
import {parentPort,workerData} from 'node:worker_threads';
import {createServer} from 'node:net';
const sockets=new Set();
const server=createServer(client=>{
 sockets.add(client);client.on('error',()=>{});client.on('close',()=>sockets.delete(client));let bytes=Buffer.alloc(0),answered=false;
 client.on('data',chunk=>{
  if(answered)return;bytes=Buffer.concat([bytes,chunk]);if(bytes.length<4)return;
  const length=parseInt(bytes.subarray(0,4).toString(),16);if(!Number.isSafeInteger(length)||length<1||length>1024){answered=true;client.end('FAIL0003bad');return;}if(bytes.length<4+length)return;
  answered=true;const query=bytes.subarray(4,4+length).toString(),value=query==='host:version'?'0029':query==='host:devices'?workerData.serial+'\tdevice\n':null;
  if(value===null){client.end('FAIL0003bad');return;}client.end('OKAY'+Buffer.byteLength(value).toString(16).padStart(4,'0')+value);
 });
});
server.listen(0,'127.0.0.1',()=>parentPort.postMessage({port:server.address().port}));
parentPort.on('message',message=>{if(message!=='close')return;for(const socket of sockets)socket.destroy();server.close(()=>parentPort.close());});
