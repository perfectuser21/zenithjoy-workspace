#!/usr/bin/env node
import{readFileSync,appendFileSync}from'node:fs';
import{join}from'node:path';
import{createInterface}from'node:readline';
import{createControllerBridge}from'./controller-bridge.mjs';
import{createNativeTransport}from'./pdd-native.mjs';
const[file]=process.argv.slice(2);
if(file==='--help'){
 process.stdout.write('原生草稿验证：node pdd-native-cli.mjs 受信任配置.json\n每行JSON命令：capture、launch、navigate(label,approvedScreenSha256)、approve-draft、set-field(field,value)、stage-image(path,sha256,name)、organize-media（先暂存全部素材，随后固定本run相册）、back、finish。\n只允许本任务新建未提交表单，不能保存/发布/发送消息。输入上传须独立实屏批准与双锁。\n');
}else{
 const config=JSON.parse(readFileSync(file,'utf8'));
 const bridge=createControllerBridge(config),native=createNativeTransport(config,bridge);
 const output=x=>{const line=JSON.stringify({at:new Date().toISOString(),...x})+'\n';appendFileSync(join(config.root,'commands.ndjson'),line,{mode:0o600});process.stdout.write(line);};
 try{
  await bridge.begin();output({event:'ready',owner:bridge.state.owner,statePath:bridge.statePath});
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
   if(!line.trim())continue;
   try{
    const q=JSON.parse(line);let result;
    switch(q.command){
     case'capture':result=await native.capture();break;
     case'launch':result=await native.launch();break;
     case'navigate':result=await native.navigate(q.label,q);break;
     case'approve-draft':result=await native.approveDraft(q);break;
     case'set-field':result=await native.setField(q.field,q.value,q);break;
     case'stage-image':result=await native.stageImage(q);break;
     case'organize-media':result=await native.organizeMedia();break;
     case'back':result=await native.back();break;
     case'finish':result=await native.finish();output({command:q.command,result});process.exit(0);break;
     default:throw new Error('FORBIDDEN_NATIVE_COMMAND');
    }
    output({command:q.command,result});
   }catch(error){output({error:error.message,statePath:bridge.statePath,remoteUnknown:bridge.state.remoteUnknown});}
  }
  output({event:'input-closed',lockReleased:bridge.state.lockReleased,statePath:bridge.statePath});process.exitCode=2;
 }catch(error){output({error:error.message,statePath:bridge.statePath});process.exitCode=2;}
}
