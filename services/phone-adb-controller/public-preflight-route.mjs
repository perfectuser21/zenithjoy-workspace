// A route is fixed by the released registry and protected profile, never a
// Task input, environment override, discovered port or borrowed legacy server.
import {readFileSync,lstatSync,realpathSync,openSync,closeSync,fstatSync,constants} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {digest,canonical} from './runtime-definition.mjs';
const fail=()=>{throw Error('PUBLIC_PREFLIGHT_ROUTE_SOURCE');};
export function freezePublicPreflightRoute({root,files,scope}){
 const policy=scope?.policy;
 if(policy?.schema_version===1&&!policy.instance_id)return null;
 if(policy?.schema_version!==2||typeof policy.instance_id!=='string')fail();
 const registry_path='config/adb-host-instances.json',path=join(root,registry_path),s=lstatSync(path),raw=readFileSync(path),expected=files?.[registry_path];
 if(!expected||digest(raw)!==expected||!s.isFile()||s.isSymbolicLink()||(s.mode&0o022)||realpathSync(path)!==path)fail();
 const registry=JSON.parse(raw),rows=registry.instances?.filter(r=>r.instance_id===policy.instance_id);
 if(registry.schema_version!==1||rows?.length!==1||rows[0].kind!=='managed'||canonical(rows[0].policy)!==canonical(policy)||!isAbsolute(rows[0].policy_path||''))fail();
 const policy_path=rows[0].policy_path;
 if(realpathSync(policy_path)!==policy_path)fail();const fd=openSync(policy_path,constants.O_RDONLY|constants.O_NOFOLLOW);
 let bytes;try{const before=fstatSync(fd);if(!before.isFile()||before.uid!==process.getuid()||(before.mode&0o777)!==0o600||before.nlink!==1||before.size>65536)fail();bytes=readFileSync(fd);const after=fstatSync(fd),current=lstatSync(policy_path);if(bytes.length!==before.size||['dev','ino','size','mtimeMs','ctimeMs'].some(k=>before[k]!==after[k]||before[k]!==current[k]))fail();}finally{closeSync(fd);}
 if(canonical(JSON.parse(bytes))!==canonical(policy))fail();
 return {instance_id:policy.instance_id,policy_path,policy_sha256:digest(bytes),registry_path,registry_sha256:digest(raw)};
}
