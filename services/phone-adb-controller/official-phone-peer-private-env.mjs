import {openSync,readFileSync,fstatSync,closeSync,constants,lstatSync} from 'node:fs';
import {join} from 'node:path';
const allowed=new Set(['BRAIN_URL','BRAIN_INTERNAL_TOKEN','KERNEL_FLEET_BRIDGE_TOKEN']);
export function readPhonePeerPrivateEnvironment(home){
 const path=join(home,'.credentials','official-phone-peer.env'),before=lstatSync(path);
 const safe=s=>s.isFile()&&!s.isSymbolicLink()&&s.uid===process.getuid()&&(s.mode&0o777)===0o600&&s.nlink===1&&s.size<=16384;
 if(!safe(before))throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);let text;
 try{const s=fstatSync(fd);if(!safe(s)||s.ino!==before.ino||s.dev!==before.dev)throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');text=readFileSync(fd,'utf8');}finally{closeSync(fd);}
 const result={};
 for(const line of text.split('\n')){if(!line.trim()||line.trim().startsWith('#'))continue;const m=line.match(/^(?:export )?([A-Z_]+)=(.*)$/);if(!m||!allowed.has(m[1])||Object.hasOwn(result,m[1]))throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');let value=m[2];if(value.startsWith("'")&&value.endsWith("'"))value=value.slice(1,-1);else if(value.startsWith('"')&&value.endsWith('"'))value=value.slice(1,-1);if(!value||/[\r\n\0`$\\]/.test(value))throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');result[m[1]]=value;}
 if([...allowed].some(k=>!result[k])||result.KERNEL_FLEET_BRIDGE_TOKEN.length<32)throw Error('OFFICIAL_PHONE_PEER_PRIVATE_ENV');
 const u=new URL(result.BRAIN_URL);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||u.pathname!=='/'||['localhost','127.0.0.1','::1','[::1]'].includes(u.hostname))throw Error('OFFICIAL_PHONE_PEER_BRAIN_ROUTE');
 return Object.freeze(result);
}
