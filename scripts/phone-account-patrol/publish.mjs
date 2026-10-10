import fs from 'node:fs';
import {getToken,notionReq} from '/app/src/recurring-notion-sync.js';
const incoming = __INPUT__;
const token=getToken();
const sources={'小黄':'3d8c40c2ba6380ddb4b9d9363c97d683','小白':'3d8c40c2ba6380739e97e02ebfbcc0b3','小彩':'3d8c40c2ba638065a580f653f99fddbb','小蓝':'3d8c40c2ba63808385b9cea11200e3cf'};
const platforms=['抖音','小红书','微信','视频号','快手','今日头条','知乎','微博','B站'];
const txt=s=>({rich_text:Array.from({length:Math.ceil(s.length/1700)},(_,i)=>({type:'text',text:{content:s.slice(i*1700,(i+1)*1700)}}))});
const val=p=>(p?.rich_text??[]).map(x=>x.plain_text??x.text?.content??'').join('');
const report=[];
for(const [nickname,data] of Object.entries(incoming.phones)) {
 const id=sources[nickname];if(!id)throw Error('Unknown phone');
 const page=await notionReq(token,`/pages/${id}`);
 let previous={};try{previous=JSON.parse(val(page.properties['账号巡查快照']));}catch{}
 const results={};
 for(const platform of platforms){
  const old=previous.results?.[platform]??{};
  const obs={...(data.results?.[platform]??{state:'待确认',reason:'本轮未查',checked_at:incoming.checked_at})};
  let last=old.last_verified??null;
  if(obs.state==='已登录'&&(obs.nickname_trusted||(obs.account_id && (obs.account_id_trusted||obs.account_id===last?.account_id)))){
   const same=obs.account_id&&obs.account_id===last?.account_id;
   // A nickname is only accepted from an explicit account field/manual on-site check.
   const name=obs.nickname_trusted?obs.nickname:same?last.nickname:null;
   const retainId=obs.nickname_trusted && name===last?.nickname && !obs.account_id;
   const id=obs.account_id_trusted||same?obs.account_id:retainId?last?.account_id:null;
   const idTime=obs.account_id_trusted||same?obs.checked_at:retainId?last?.id_verified_at??last?.verified_at:null;
   last={nickname:name??null,account_id:id??null,id_verified_at:idTime,verified_at:obs.nickname_trusted?obs.checked_at:same?(last?.verified_at??obs.checked_at):obs.checked_at,evidence:obs.evidence};
  }
  if(obs.state==='已登录'&&!obs.nickname_trusted&&obs.account_id&&!obs.account_id_trusted&&obs.account_id!==last?.account_id){obs.state='待确认';obs.reason='本人页可访问，但OCR账号ID与上次记录不一致，需复核';}
  if(obs.state==='未登录'||obs.state==='未安装')last=last?{...last,historical:true}:null;
  results[platform]={...obs,last_verified:last};
 }
 const snapshot={version:1,schedule_status:previous.schedule_status??'active',recurring_task_id:previous.recurring_task_id??null,registry_id:previous.registry_id??null,actor:incoming.actor??'phone-account-patrol',task_id:incoming.task_id,checked_at:incoming.checked_at,schedule:incoming.schedule??'每天22:00（Asia/Shanghai）',serial:data.serial,results};
 const props={'账号核验时间':{date:{start:incoming.checked_at}}};
 const conflicts=[];snapshot.rendered_props={};
 for(const p of platforms){const o=results[p];const last=o.last_verified;const identity=last?`${last.nickname??'昵称待确认'}${last.account_id?'（'+(last.id_verified_at&&last.id_verified_at!==last.verified_at?'上次ID：':'')+last.account_id+'）':''}`:'';
  props[p+'账号']=txt(o.state==='已登录'?`${identity||'已登录，当前身份待确认'}；已登录（本轮核验）`:`${o.state}：${o.reason??''}${identity?'；上次确认 '+identity:''}`);
 }
 for(const p of platforms){const field=p+'账号',current=val(page.properties[field]),desired=val(props[field]);
  if(previous.rendered_props && Object.hasOwn(previous.rendered_props,field) && current!==previous.rendered_props[field] && current!==desired){conflicts.push({field,human_value:current,machine_value:desired});delete props[field];snapshot.rendered_props[field]=previous.rendered_props[field];}
  else snapshot.rendered_props[field]=desired;
 }
 snapshot.conflicts=conflicts;props['账号巡查快照']=txt(JSON.stringify(snapshot));
 await notionReq(token,`/pages/${id}`,'PATCH',{properties:props});
 report.push({phone:nickname,conflicts,states:Object.fromEntries(platforms.map(p=>[p,results[p].state]))});
}
console.log(JSON.stringify({published:report}));
