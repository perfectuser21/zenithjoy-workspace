// Only an exact historical 104 source plus a known local transport can be assembled.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {hash,need,regular,asset,scope,validateScope,KEYS} from './activity-104-context.mjs';
import {wire104State} from './activity-104-state-wiring.mjs';
import {businessModuleSources} from './leadgen-foundation/business-module-sources.mjs';
const HERE=path.dirname(fileURLToPath(import.meta.url));
const BASE={"tools.py": "b198139524d3d3e2eeb13f2c05cce59c9fa8696130d3cb56f82ebf0e6e6bfb9c", "tool_scope.py": "b5d39b61efc42dac48ca76a3d77d7f1bef63eed734ea076231facaf554b6386b", "outreach104/tool_extension.py": "926e9ce8772233da3335bd5238eed6c51087abbe145b60c1385f050b95e0eefa", "outreach104/TOOLS104.txt": "c91f090db35064a0befed28aaae43b7d5f4c89e77f82b4d76c43448626f2a789", "outreach104/__init__.py": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "outreach104/process-lock.mjs": "41ac13250ee3e8dd53fd79f4d1d28882666b02b07f6fdd9779301a84e178fd0c", "outreach104/phone_guard.py": "ce7f448fe869bb31fc5918ad492a86bec66dc3047f624834ce7f3dad94f457fd", "outreach104/outreach-cli.mjs": "22090ee5c825c0929e4e9109f271e87ba67cb7efac8381a53e4432af33a80a60", "outreach104/profile-input.mjs": "01e2f7d52ac1334bf81a476daa969c68f6a312cde73287879427069b8809b13d", "outreach104/runtime-deps.mjs": "e750e1953ed4260870fe3d2383c513c66f1a2811e385987d31e8134bdd8bbd0d", "outreach104/order-adapter.mjs": "05e1f9d24b7aa4e3231d0f8d20ee18c28ab42d5cd4e2f1220d2e1246550a7faa", "outreach104/io.mjs": "1ea9ab3b97469aef3dcc8cba1a81a745685a59697a97d949b3c9e97fbf0800ba"};
const LOCAL={"local_transport.py": "4ecc7d737a3bf0c4e871bd100c97bfac86a08920b685dff683cfb19309114bfc", "local-transport.mjs": "4805897be1fff7c2cc2b54ff5580897dbd2a3cad5d3e7f85ea0da22d4c7506a0", "lock-readback.mjs": "dc55ce9f47fe186b694b34f1f6a84a89cbf83c880a2b59e6407875c706814897", "native-probe.py": "bd2cce27be94d4997336371a1986d669de29c28916d9a8e87fa42e373def5b5d"};
function replace(text,old,next){need(text.split(old).length===2,'BASE_LAYOUT');return text.replace(old,next);}
function baseline(root,pins){need(path.isAbsolute(root)&&fs.realpathSync(root)===root,'BASE_ROOT');return Object.fromEntries(Object.entries(pins).map(([n,h])=>{const b=regular(path.join(root,n));need(hash(b)===h,'BASE_SOURCE');return[n,b.toString()];}));}
export async function assembleActivity104Host({baseRoot,localBaseRoot,targetRoot,context:c,pgHelper}){
 need(typeof targetRoot==='string'&&path.isAbsolute(targetRoot)&&!fs.existsSync(targetRoot),'TARGET');
 const files={...baseline(baseRoot,BASE),...baseline(localBaseRoot,LOCAL)};validateScope(c);const pg=asset(pgHelper);
 const ownPg=regular(path.join(HERE,'activity-host-pg.mjs'));need(hash(pg)===hash(ownPg),'SOURCE_PG_HELPER');
 const binding=JSON.stringify(scope(c),null,2)+'\n',bindingHash=hash(binding);
 files['outreach-host-binding.json']=binding;
 files['activity-104-context.mjs']=replace(regular(path.join(HERE,'activity-104-context.mjs')).toString(),'ASSEMBLY_REPLACES_BINDING_SHA',bindingHash);
 files['activity-104-runtime.mjs']=regular(path.join(HERE,'activity-104-runtime.mjs')).toString();
 files['activity-104-transport.py']=replace(replace(regular(path.join(HERE,'activity-104-transport.py')).toString(),'ASSEMBLY_REPLACES_BINDING_SHA',bindingHash),'KEYS=[] # ASSEMBLY_REPLACES_KEYS','KEYS='+JSON.stringify(KEYS));
 files['activity-host-pg.mjs']=pg.toString();
 // 104 reads the same frozen 103 scoring proof format even when the phone runtime is older.
 Object.assign(files,businessModuleSources(c));
 let r=files['outreach104/runtime-deps.mjs'];
 r=replace(r,",score=req('./leadgen-policy-review.js')",'');
 r=replace(r,'const result=await score.verifyStoredScore',"const score=createRequire(new URL('../business-runtime/package.json',import.meta.url))('./leadgen-policy-review.js');\n   const result=await score.verifyStoredScore");
 r=replace(r,"const COMMIT='97eac7e35dc3e098a4d7fdde76cdca6dbfb691fd';\nconst ROOT='/Users/administrator/.local/share/zenithjoy/leadgen-api-candidates/'+COMMIT+'/services/phone-adb-controller';\nconst AUTH='/Users/administrator/.codex-team1/artifacts/leadgen-101-104-foundation-20261114/104-authorized-input.json';\nconst AUTH_SHA='ac20a68a650d830b5a8bf354cbfa3aa0d59d3f8f213636a47fde298f2d7d0037';",'');
 // Remove the M4-only observer; all authorization, qualification and order behavior stays below.
 const start=r.indexOf('const remoteRead='),end=r.indexOf('export async function createRuntimeDeps');need(start>=0&&end>start,'BASE_LAYOUT');r=r.slice(0,start)+r.slice(end);
 r=replace(r," need(c.runtime_root===ROOT&&c.source_commit===COMMIT&&fs.realpathSync(ROOT)===ROOT,'RUNTIME_NOT_PINNED');"," verify104Context(c);need(canonical(s)===canonical(c.verification['104']),'ACTIVITY_104_CONTEXT_SCOPE');const ROOT=c.runtime_root;");
 r=replace(r," const req=createRequire(ROOT+'/package.json')"," verify104Runtime(c);\n const req=createRequire(ROOT+'/package.json')");
 r=replace(r," const pool=req('./leadgen-db-connect.js').getPool();let outbox;"," const {Pool}=await loadActivityHostPg(c);const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000,max:1});let outbox;");
 r=replace(r," const authAsset=c.authorization_asset||{path:AUTH,sha256:AUTH_SHA};need(authAsset.sha256===AUTH_SHA,'AUTHORIZATION_SOURCE_CHANGED');"," const authAsset=c.authorization_asset;");
 r=replace(r,'  const auth=jsonAsset(authAsset);','  verify104Context(c);const auth=jsonAsset(authAsset);');
 r=replace(r,'const raw=await sshRead(c),locks=', 'const raw=observe104Runtime(c,{orders:all}),locks=');
 r=replace(r,'raw.verified=raw.today_ambiguous_sender_orders===0','raw.verified=raw.verified===true&&raw.today_ambiguous_sender_orders===0');
 r=replace(r,"import {checkPreflight,checkNative} from './native-checker.mjs';","import {readPreflightFacts,readSendFacts} from '../activity-native-facts.mjs';");
 r=r.replaceAll('checkPreflight','readPreflightFacts').replaceAll('checkNative','readSendFacts');
 files['activity-native-facts.mjs']=regular(path.join(HERE,'activity-native-facts.mjs')).toString();
 files['outreach104/runtime-deps.mjs']="import {verify104Context,verify104Runtime,canonical} from '../activity-104-context.mjs';\nimport {observe104Runtime} from '../activity-104-runtime.mjs';\nimport {loadActivityHostPg} from '../activity-host-pg.mjs';\n"+r;
 // Reuse only read-only Task admission; the 104 dispatcher/authorization/OPS stay dedicated.
 for(const name of ['activity-host-tools.py','activity-tool-result.py'])files[name]=regular(path.join(HERE,name)).toString();
 const authorityPatch="import importlib.util,sys,json\ns=importlib.util.spec_from_file_location('authority',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ntools,scope=json.load(sys.stdin)\nprint(json.dumps([*m.patch_phone_access(m.patch_task_authority(tools,main_only=True),scope),m.PHONE_INSTRUCTIONS]))\n";
 const patched=spawnSync(c.python,['-c',authorityPatch,path.join(HERE,'activity-host-tools.py')],{input:JSON.stringify([files['tools.py'],files['tool_scope.py']]),encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'}});
 need(patched.status===0,'AUTHORITY_ASSEMBLY');
 const [phoneTools,phoneScope,phoneInstructions]=JSON.parse(patched.stdout);files['tool_scope.py']=phoneScope;
 let t="import importlib.util,pathlib\n_a=importlib.util.spec_from_file_location('authority',pathlib.Path(__file__).parent/'activity-host-tools.py')\n_host=importlib.util.module_from_spec(_a);_a.loader.exec_module(_host)\n"+phoneTools;t=replace(t,'import os,sys,json,pathlib,hashlib,subprocess,shlex,time,urllib.request,fcntl,re','import os,sys,json,pathlib,hashlib,subprocess,shlex,time,urllib.request,fcntl,re,shutil\nimport importlib.util\n_sp=importlib.util.spec_from_file_location("host104",pathlib.Path(__file__).parent/"activity-104-transport.py")\n_host104=importlib.util.module_from_spec(_sp);_sp.loader.exec_module(_host104)');
 const sshStart=t.indexOf('def ssh(c,args):'),sshEnd=t.indexOf('def central(c):');t=t.slice(0,sshStart)+'def ssh(c,args):\n return _host104.command(c,args)\n'+t.slice(sshEnd);
 t=replace(t," c=read(P/'context.json');f="," c=read(P/'context.json');_host104.verify_context(c);f=");
 t=replace(t,"read(H/'.credentials/zenithjoy-db.json')","read(c['credentials']['database'])");t=replace(t,"str(H/'.credentials/leadgen-feishu-yuesheng-live.json')","c['credentials']['feishu']");
 t=replace(t," for f in ['cecelia-internal.env','openrouter.env','dashscope.env']:e.update(envfile(H/'.credentials'/f))"," for f in [c['credentials']['brain']]+c['credentials']['provider_env_files']:e.update(envfile(f))");
 t=replace(t," e=envfile(H/'.credentials/cecelia-internal.env');token="," c=read(P/'context.json');_host104.verify_context(c);e=envfile(c['credentials']['brain']);token=");
 const old=t.split('\n').find(l=>l.startsWith("  r=subprocess.run(['scp'"));need(old,'BASE_LAYOUT');
 t=replace(t,old+"\n  if r.returncode:return r","  _host104.verify_context(c)\n  source=pathlib.Path(remote)\n  if source.is_symlink() or source.resolve().parent!=pathlib.Path(c['native_root']).resolve() or not source.is_file():raise ValueError('NATIVE_FILE_SCOPE')\n  shutil.copy2(source,partial)");t=replace(t,'  return subprocess.run(ssh(c,approved),capture_output=True,text=True,timeout=min(420,remaining))',"  result=subprocess.run(ssh(c,approved),capture_output=True,text=True,timeout=min(420,remaining))\n  return _host104.preflight_result(c,result,subprocess.run) if cmd=='preflight' else result");files['tools.py']=t;
 files['activity-104-state.mjs']=regular(path.join(HERE,'activity-104-state.mjs')).toString();wire104State(files);
 files['outreach104/order-adapter.mjs']=files['outreach104/order-adapter.mjs'].replaceAll('checkPreflight','readPreflightFacts').replaceAll('checkNative','readSendFacts').replaceAll('native.verified','native.source_verified').replaceAll('native-check.json','native-report.json');
 files['TOOLS.txt']='104本轮工具仅通过commander_host_tools.invoke(kind, action_name, args字符串数组)。下面python tools.py例子仅说明参数顺序，禁止shell直调；逐次等待每个工具终态。\n'+files['outreach104/TOOLS104.txt'].replace('在同一次shell执行中按顺序等待各既有工具终态','通过宿主工具按顺序等待各既有工具终态')+'\n'+phoneInstructions+'\n';
 const receipt={schema:'activity-host-104/v1',status:'assembled_not_started',binding_sha256:bindingHash,base_sha256:BASE,local_sha256:LOCAL,sha256:Object.fromEntries(Object.entries(files).map(([n,b])=>[n,hash(b)]))};
 fs.mkdirSync(targetRoot,{mode:0o700});for(const[n,b]of Object.entries({...files,'activity-host-104-receipt.json':JSON.stringify(receipt,null,2)+'\n'})){fs.mkdirSync(path.dirname(path.join(targetRoot,n)),{recursive:true,mode:0o700});fs.writeFileSync(path.join(targetRoot,n),b,{flag:'wx',mode:0o600});}return receipt;
}
