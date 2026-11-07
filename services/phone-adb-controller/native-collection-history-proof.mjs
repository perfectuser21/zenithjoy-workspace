// Code-only predicate adapter. The injected existing producer owns authority,
// nofork execution, deadlines and close facts; this module issues none of them.
import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {dirname,join,resolve,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=reason=>Object.assign(Error('NATIVE_COLLECTION_HISTORY_'+reason),{code:'NATIVE_COLLECTION_HISTORY_'+reason});
const panelPattern='发条评论|放大评论区|回复 按钮|展开[0-9]+条回复|text="评论 ?[0-9]+"|[0-9]+ ?条评论|暂无评论';
const panelPrimitive='comment_panel_open() {\n  local xml="$1"\n  [[ -r "$xml" ]] || return 1\n  /usr/bin/grep -qE \''+panelPattern+'\' "$xml"\n}';
export function createNativeCollectionHistoryPredicate({root,source,runOwned}={}){
 const src=structuredClone(source),cache=new Set();let invalid=false;
 if(typeof runOwned!=='function'||!isAbsolute(root||'')||root!==resolve(root)||realpathSync(root)!==root||root!==dirname(fileURLToPath(import.meta.url))||!/^[a-f0-9]{40}$/.test(src?.commit||'')||!Array.isArray(src.files)||src.files.length>512||new Set(src.files.map(f=>f.path)).size!==src.files.length)throw fail('SOURCE');
 for(const name of ['native-collection-history-proof.mjs','queued-comment-history.js','douyin-phone-adb'])if(!src.files.some(f=>f.path===name))throw fail('SOURCE');
 function check(){if(invalid)throw fail('SOURCE');try{const bytesByName=new Map();for(const f of src.files){if(!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(f.path||'')||f.path.split('/').some(p=>p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(f.sha256||''))throw Error();const path=join(root,f.path);if(realpathSync(path)!==path)throw Error();const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const a=fstatSync(fd),s=lstatSync(path),bytes=readFileSync(fd),z=fstatSync(fd);if(!a.isFile()||s.isSymbolicLink()||a.nlink!==1||![0,process.getuid()].includes(a.uid)||(a.mode&0o022)||a.size>8*1024*1024||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>a[k]!==z[k]||a[k]!==s[k])||sha(bytes)!==f.sha256)throw Error();if(['queued-comment-history.js','douyin-phone-adb'].includes(f.path))bytesByName.set(f.path,bytes);}finally{closeSync(fd);}}return bytesByName;}catch{invalid=true;cache.clear();throw fail('SOURCE');}}const initialBytes=check();
 const original=initialBytes.get('queued-comment-history.js').toString('utf8'),proof=original.match(/\nfunction proof\([^]*?\n\/\/ 注销/)?.[0],matches=proof?[...proof.matchAll(/const parsed=spawnSync\('python3',\['-c',`([^]*?)`\],\{input:/g)]:[];
 if(matches.length!==1||matches[0][1].includes('${')||matches[0][1].includes('\\'))throw fail('PYTHON_SOURCE');
 const primitive=initialBytes.get('douyin-phone-adb').toString('utf8').match(/^comment_panel_open\(\) \{[^]*?^\}/m)?.[0];
 // This reviewed ERE has only literals, ASCII [0-9], ?, + and alternation.
 // Future ERE syntax or primitive changes require explicit review, not translation.
 if(primitive!==panelPrimitive)throw fail('PANEL_SOURCE');
 const script=matches[0][1]+'\nassert re.search('+JSON.stringify(panelPattern)+",p['returned']) is not None\n";
 function input(profile,returned,oid){check();if(!Buffer.isBuffer(profile)||!Buffer.isBuffer(returned)||profile.length>4*1024*1024||returned.length>4*1024*1024||typeof oid!=='string'||!oid)throw fail('INPUT');return {key:JSON.stringify([sha(profile),sha(returned),oid]),stdin:JSON.stringify({profile:profile.toString('utf8'),returned:returned.toString('utf8'),oid})};}
 async function prepare(profile,returned,oid){const value=input(profile,returned,oid);if(cache.has(value.key))return true;const result=await runOwned(Object.freeze({role:'original-history-proof',script,stdin:value.stdin}));check();if(!result||!Number.isInteger(result.code)||result.signal!==null||!(Buffer.isBuffer(result.stdout)||typeof result.stdout==='string')||!(Buffer.isBuffer(result.stderr)||typeof result.stderr==='string'))throw fail('RESULT');if(result.code!==0)throw fail('REJECTED');cache.add(value.key);return true;}
 function verify(profile,returned,oid){const value=input(profile,returned,oid);return cache.has(value.key);}
 return Object.freeze({prepare,verify});
}
