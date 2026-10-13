import {readFileSync,writeFileSync,existsSync,mkdirSync,chmodSync} from 'node:fs';
import {join,basename,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const {computeDailyCap}=createRequire(import.meta.url)('./dm-rate-ramp-lib.js');

const sha=value=>createHash('sha256').update(value).digest('hex');
const one=(stdout,key)=>{const rows=stdout.split('\n').filter(s=>s.startsWith(key+'='));if(rows.length!==1)throw Error('触达回执字段缺失或不唯一: '+key);return rows[0].slice(key.length+1).trim();};
const day=()=>{const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('');};

// 发送后的输出不能替代发送前永久预留；任一未知结果不得回收为可重发。
export function createOutreachHandlers({env,state,phone,queue,rpc}) {
 const {P:profile,WFR_TAG:run,LEADGEN_LINE:line}=env;
 const stateDir=join(env.HOME,'bin-harvest/state');let policy,order,prepared=false,receipt;
 const risk=()=>{
  if(env.LEADGEN_SEND!=='1')throw Error('本批私信未授权，保持暂停');
  if(existsSync(join(stateDir,`dm-paused-${profile}.flag`))||existsSync(join(stateDir,`dm-halt-${profile}-${day()}.txt`)))throw Error('账号风险暂停标记生效');
 };
 const count=()=>{const path=join(stateDir,`dm-count-${profile}-${day()}.txt`);const value=existsSync(path)?readFileSync(path,'utf8').trim():'0';if(!/^\d+$/.test(value))throw Error('触达计数未知');return {path,value:Number(value)};};
 const cap=()=>{
  const live=join(env.HOME,'bin-harvest/config/dm-rate-ramp.json');
  if(!existsSync(live))return policy.daily_cap;
  const cfg=JSON.parse(readFileSync(live,'utf8'))[profile];if(!cfg)throw Error('手机已有日限额配置缺本profile');
  const actual=computeDailyCap(cfg,new Date());if(!Number.isSafeInteger(actual)||actual<0)throw Error('手机已有日限额配置未知');
  return Math.min(policy.daily_cap,actual);
 };
 const preflight=async()=>{
  risk();if(Number(env.LEADGEN_LIMIT)!==1)throw Error('首版104必须显式单条范围');
  if(!/^[a-f0-9]{40}$/.test(state.source_commit||''))throw Error('触达正式来源证明缺失');
  policy=(await rpc({kind:'outreach_policy',line,profile,sender_douyin_id:state.account})).result;
  if(policy?.profile!==profile||policy.sender_douyin_id!==state.account||!Number.isSafeInteger(policy.daily_cap)||policy.daily_cap<1||!policy.template?.message)throw Error('触达账号或批准话术配置缺失');
  if(count().value>=cap())throw Error('账号日发送上限生效');
  return {outreach_policy_verified:1,send_authorized:1};
 };
 const send_dm=async()=>{
  risk();if(!policy||!state.account)throw Error('触达尚未通过账号及批准话术预检');
  const rows=await queue('claim_outreach',{profile,sender_douyin_id:state.account});
  if(rows.length!==1) return {status:'skipped',reason:'没有符合合同的未发送订单',sent:0,messages_sent_while_paused:0};
  [order]=rows;
  if(order.sender_douyin_id!==state.account||order.line_key!==policy.line_key||order.script_id!==policy.template.id||order.script_version!==policy.template.version||order.message!==policy.template.message)throw Error('领单与批准快照不符');
  risk();const current=count();if(current.value>=cap())throw Error('账号日发送上限生效');
  // 先消费本次尝试额度，再提交原订单永久预留。回复丢失也不允许第二次手机发送。
  mkdirSync(stateDir,{recursive:true});writeFileSync(current.path,String(current.value+1),{mode:0o600});chmodSync(current.path,0o600);
  prepared=true;
  const permit=await queue('prepare_outreach',{id:order.id,profile,sender_douyin_id:state.account,script_id:order.script_id,script_version:order.script_version,message_sha256:sha(order.message),target_douyin_id:order.douyin_id,profile_url:order.profile_url});
  if(permit?.prepared!==true||permit.order?.id!==order.id)throw Error('发送永久预留回执未知');
  const eid=`${run}-a2-dm-1`;
  const stdout=await phone('private-message-send',state.account,order.douyin_id,Buffer.from(order.message).toString('base64'),eid,order.profile_url);
  const outcome=one(stdout,'send_status');
  if(!['sent','restricted','rate_limited'].includes(outcome)||one(stdout,'message_delta_verified')!=='true'||one(stdout,'sender_douyin_id')!==state.account||one(stdout,'target_douyin_id')!==order.douyin_id||one(stdout,'message_sha256')!==sha(order.message))throw Error('私信真实发送身份回执不符');
  const raw=one(stdout,'sent_ui_evidence');const base=resolve(env.PHONE_EVIDENCE_ROOT||'/private/tmp/openclaw-phone/evidence',profile);
  if(resolve(raw)!==join(base,basename(raw))||!basename(raw).startsWith(eid))throw Error('私信原始证据越界');
  const typed=one(stdout,'typed_ui_evidence');
  if(resolve(typed)!==join(base,basename(typed))||basename(typed)!==eid+'-typed.xml')throw Error('私信输入原始证据越界');
  const evidence={typed,sent:raw,risk:one(stdout,'risk_ui_evidence'),send_foreground:one(stdout,'send_foreground_evidence'),risk_foreground:one(stdout,'risk_foreground_evidence')};
  const suffixes={typed:'typed.xml',sent:'sent.xml',risk:'risk.xml',send_foreground:'send-foreground.txt',risk_foreground:'risk-foreground.txt'};
  const target=join(env.WFR_RUN_DIR,'outreach-evidence');mkdirSync(target,{recursive:true,mode:0o700});
  const stored={};for(const [key,path]of Object.entries(evidence)){
   if(resolve(path)!==join(base,basename(path))||basename(path)!==eid+'-'+suffixes[key])throw Error('私信原始证据身份越界');
   const bytes=readFileSync(path);if(!bytes.length)throw Error('私信原始证据为空');
   const dest=join(target,basename(path));writeFileSync(dest,bytes,{flag:'wx',mode:0o600});stored[key]={file:basename(path),sha256:sha(bytes)};
  }
  // 独立解析归档原件，stdout的delta=true不能替代原始XML；这里只读，不操作手机。
  const verify=spawnSync(env.PYTHON_BIN||'python3',['-c',`import sys,re,xml.etree.ElementTree as E
root,msg,expected=sys.argv[1:]
def rows(name):
 r=E.parse(root+'/'+name).getroot()
 if r.tag!='hierarchy': raise ValueError('hierarchy')
 return list(r.iter('node'))
def inp(n): return n.get('resource-id')=='com.ss.android.ugc.aweme:id/msg_et' and n.get('class')=='android.widget.EditText'
before=rows('${eid}-typed.xml'); ins=[n for n in before if inp(n)]
if len(ins)!=1 or ins[0].get('text')!=msg or any(n.get('text')==msg and not inp(n) for n in before): raise ValueError('historical bubble')
out=[]
for name in ['${eid}-sent.xml','${eid}-risk.xml']:
 ns=rows(name); txt=' '.join(n.get('text','')+' '+n.get('content-desc','') for n in ns)
 if '给陌生人发送消息过于频繁' in txt or '今日私信次数' in txt: out.append('rate_limited')
 elif '暂无法给对方发送消息' in txt or ('互相关注' in txt and '发送消息' in txt): out.append('restricted')
 else:
  rem=[n for n in ns if inp(n)]
  if len(rem)!=1 or rem[0].get('text','')==msg or len([n for n in ns if n.get('text')==msg and not inp(n)])!=1: raise ValueError('new bubble missing')
  out.append('sent')
for name in ['${eid}-send-foreground.txt','${eid}-risk-foreground.txt']:
 text=open(root+'/'+name).read(); packages=re.findall(r'(?:^|\\s)([A-Za-z0-9_.]+)/',text)
 if packages!=['com.ss.android.ugc.aweme']: raise ValueError('foreground')
actual='rate_limited' if 'rate_limited' in out else 'restricted' if 'restricted' in out else 'sent'
if actual!=expected: raise ValueError('outcome mismatch')
print('verified')`,target,order.message,outcome],{encoding:'utf8',timeout:5000,maxBuffer:4096});
  if(verify.status!==0||verify.stdout.trim()!=='verified')throw Error('归档私信原始证明独立核验失败');
  if(outcome==='rate_limited')writeFileSync(join(stateDir,`dm-halt-${profile}-${day()}.txt`),eid,{mode:0o600});
  receipt={version:1,source_commit:state.source_commit,line:policy.line_key,run,profile,id:order.id,sender_douyin_id:state.account,target_douyin_id:order.douyin_id,profile_url:order.profile_url,script_id:order.script_id,script_version:order.script_version,message_sha256:sha(order.message),outcome,delivery_verified:false,message_delta_verified:true,raw_evidence:stored,typed_evidence_file:stored.typed.file,typed_evidence_sha256:stored.typed.sha256,evidence_file:stored.sent.file,evidence_sha256:stored.sent.sha256};
  writeFileSync(join(env.WFR_RUN_DIR,`${run}-outreach-receipt.json`),JSON.stringify(receipt),{mode:0o600});
  return {sent:outcome==='sent'?1:0,messages_sent:outcome==='sent'?1:0,orders_prepared:1,attempted:1,outcome,message_delta_verified:1,delivery_result_verified:1,messages_sent_while_paused:0,delivery_verified:false};
 };
 const write_back=async()=>{
  if(!receipt)return {status:'skipped',reason:'无新发送事实，保留待核实',outreach_readback_failures:0};
  let writeError;try{await queue('write_outreach',{id:order.id,receipt});}catch(error){writeError=error;}
  const back=await queue('outreach_readback',{id:order.id,receipt});
  writeFileSync(join(env.WFR_RUN_DIR,`${run}-write_back-readback.json`),JSON.stringify(back),{mode:0o600});
  if(back?.verified!==true)throw writeError||Error('触达原订单独立读回不符');
  return {written:1,outreach_readback_failures:0,delivery_verified:false,recovered_write_reply:!!writeError};
 };
 const cleanup=async()=>{if(order&&!prepared)await queue('release_outreach',{id:order.id});};
 return {preflight,send_dm,write_back,cleanup};
}
