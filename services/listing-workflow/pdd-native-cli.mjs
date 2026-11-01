#!/usr/bin/env node
import{readFileSync,appendFileSync}from'node:fs';
import{join}from'node:path';
import{createInterface}from'node:readline';
import{createControllerBridge}from'./controller-bridge.mjs';
import{createNativeTransport}from'./pdd-native.mjs';
const[file]=process.argv.slice(2);
if(file==='--help'){
 process.stdout.write('原生草稿验证：node pdd-native-cli.mjs 受信任配置.json\n每行JSON命令：capture、launch、bootstrap-back（仅已知列表回主页；preparationOnly=true须显式素材授权且不启动业务context）、resolve-back（只读核原back已终止与IME当前隐藏）、navigate(label,approvedScreenSha256)、approve-draft、set-field(field,value)、prepare-image/prepare-album（显式素材授权、仅核店前暂存迁移、不点击UI）、stage-image(path,sha256,name)、organize-media（先暂存全部素材，随后固定本run相册）、picker(action=more/permission/select/confirm)、gallery(action=menu/album/state/select/upload/back/refresh（授权后最多一次受控退出重进）)、discard-draft、back、finish。\n只允许本任务新建未提交表单，不能保存/发布/发送消息。输入上传须独立实屏批准与双锁；stage-image只表示手机暂存，gallery upload仅把图片送入本任务未提交表单。图库身份需要当前帧可信视觉绑定和逐项原生序号读回；店名核验时刻保持原值，binding.draftContextMaxSeconds仅未提交试验可显式设至1800秒，绑定run/owner及闭合页面轨迹；未知即停止，不能把连续序号当图片身份。\n');
}else{
 const config=JSON.parse(readFileSync(file,'utf8'));
 const bridge=createControllerBridge(config),native=createNativeTransport(config,bridge);
 const output=x=>{const line=JSON.stringify({at:new Date().toISOString(),...x})+'\n';appendFileSync(join(config.root,'commands.ndjson'),line,{mode:0o600});process.stdout.write(line);};
 try{
  await bridge.begin();output({event:'ready',owner:bridge.state.owner,statePath:bridge.statePath});
  for await(const line of createInterface({input:process.stdin,crlfDelay:Infinity})){
   if(!line.trim())continue;
   let command;const startedAt=new Date().toISOString(),started=performance.now();
   try{
    const q=JSON.parse(line);command=q.command;output({event:'command-start',command,startedAt});let result;
    switch(q.command){
     case'capture':result=await native.capture();break;
     case'bootstrap-back':result=await native.bootstrapBack(q);break;
     case'resolve-back':result=await native.resolveBack(q);break;
     case'launch':result=await native.launch();break;
     case'navigate':result=await native.navigate(q.label,q);break;
     case'approve-draft':result=await native.approveDraft(q);break;
     case'set-field':result=await native.setField(q.field,q.value,q);break;
     case'prepare-image':result=await native.stageImage(q,true);break;
     case'prepare-album':result=await native.organizeMedia(true);break;
     case'stage-image':result=await native.stageImage(q);break;
     case'organize-media':result=await native.organizeMedia();break;
     case'discard-draft':result=await native.discardDraft(q);break;
     case'gallery':result=await native.gallery(q.action,q);break;
     case'picker':result=await native.picker(q.action,q);break;
     case'back':result=await native.back();break;
     case'finish':result=await native.finish();output({command:q.command,result,startedAt,durationMs:performance.now()-started});process.exit(0);break;
     default:throw new Error('FORBIDDEN_NATIVE_COMMAND');
    }
    output({command:q.command,result,startedAt,durationMs:performance.now()-started});
   }catch(error){output({command,startedAt,durationMs:performance.now()-started,deviceActionCompleted:error.deviceActionCompleted===true,requiresReadback:error.requiresReadback===true,error:error.message,statePath:bridge.statePath,remoteUnknown:bridge.state.remoteUnknown});}
  }
  output({event:'input-closed',lockReleased:bridge.state.lockReleased,statePath:bridge.statePath});process.exitCode=2;
 }catch(error){output({error:error.message,statePath:bridge.statePath});process.exitCode=2;}
}
