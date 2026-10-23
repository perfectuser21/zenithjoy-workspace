import {createServer} from 'node:net';
const listen=(port,host)=>new Promise((resolve,reject)=>{
 const server=createServer();server.once('error',reject);
 server.listen({port,host,ipv6Only:host.startsWith('::')},()=>resolve(server));
});
const close=server=>server?new Promise(resolve=>server.close(resolve)):Promise.resolve();
async function probe(port,adjacent=false){
 let selected=port;
 // Match API wildcard binding and localhost health addresses. BSD permits some
 // wildcard/specific overlaps, so probe the two address sets separately.
 for(const hosts of [['0.0.0.0','::'],['127.0.0.1','::1']]){
  const reserved=[];
  try{
   const first=await listen(selected,hosts[0]);reserved.push(first);selected=first.address().port;
   if(selected>65535||(adjacent&&selected===65535))throw Error('WORKBENCH_PORT_RANGE');
   reserved.push(await listen(selected,hosts[1]));
   if(adjacent){
    reserved.push(await listen(selected+1,hosts[0]));
    reserved.push(await listen(selected+1,hosts[1]));
   }
  }finally{for(const server of reserved.reverse())await close(server);}
 }
 return selected;
}
try{
 const [mode,value]=process.argv.slice(2);let selected;
 if(mode==='check'||mode==='check-pair'){
  if(!/^[1-9][0-9]{0,4}$/.test(value||'')||Number(value)>=65535)throw Error('WORKBENCH_PORT_RANGE');
  selected=await probe(Number(value),mode==='check-pair');
 }else if(mode==='allocate'&&value===undefined){
  for(let attempt=0;attempt<16;attempt++){
   try{selected=await probe(0,true);break;}catch(e){if(e.code!=='EADDRINUSE'&&e.message!=='WORKBENCH_PORT_RANGE')throw e;}
  }
  if(!selected)throw Error('WORKBENCH_PORT_UNAVAILABLE');
 }else throw Error('WORKBENCH_PORT_ARGUMENTS');
 process.stdout.write(String(selected)+'\n');
}catch(error){
 process.stderr.write(error.code==='EADDRINUSE'?'WORKBENCH_PORT_BUSY\n':String(error.message)+'\n');process.exitCode=1;
}
