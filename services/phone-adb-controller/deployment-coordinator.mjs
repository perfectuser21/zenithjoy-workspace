// 两机没有共享文件系统：以持久决定+封闭准入保证故障后恢复方向唯一。
const HOSTS=['xian-m4','mmv'];
const need=(ok,message)=>{if(!ok)throw Error('手机整包事务: '+message);};
export async function coordinateDeployment(o){
 let decision=await o.readDecision();
 const states={};
 async function inspectAll(){
  // 任何一台失联都不能据单边状态猜测或打开另一台准入。
  for(const host of HOSTS)states[host]=await o.inspect(host);
 }
 async function restore(){
  const prepared=HOSTS.filter(host=>states[host]);
  for(const host of prepared)await o.restore(host);
  for(const host of prepared)await o.verifyRestored(host);
  for(const host of prepared)await o.release(host);
 }
 async function finishCommit(){
  need(HOSTS.every(host=>states[host]),'缺目标journal，不能提交');
  for(const host of HOSTS)await o.verifyInstalled(host);
  for(const host of HOSTS)await o.commit(host);
  for(const host of HOSTS)await o.release(host);
 }
 if(o.recover||o.rollback){
  need(['install','commit','restore'].includes(decision),'缺可信持久决定');
  await inspectAll();
  if(o.rollback){await o.writeDecision('restore');decision='restore';}
  if(decision==='commit')await finishCommit();
  else {
   if(decision!=='restore')await o.writeDecision('restore');
   await restore();
  }
  return {direction:decision==='commit'?'committed':'restored'};
 }
 need(decision===null,'已有事务需显式recover/rollback');
 try{
  for(const host of HOSTS){await o.prepare(host);states[host]='prepared';}
  await o.writeDecision('install');decision='install';
  await o.install();
  for(const host of HOSTS)await o.verifyInstalled(host);
  // 必须先写唯一全局决定，才允许任何主机提交或解除屏障。
  await o.writeDecision('commit');decision='commit';
  for(const host of HOSTS)await o.commit(host);
  for(const host of HOSTS)await o.release(host);
  return {direction:'committed'};
 }catch(error){
  // 写请求ACK丢失时重新读决定；不把“调用抛错”当成“没有提交”。
  decision=await o.readDecision();
  if(decision==='commit')throw error;
  await inspectAll();
  await o.writeDecision('restore');
  await restore();
  throw error;
 }
}
