// 认证材料只供固定私有实例；JSON描述本身不产生任何网络或启动授权。
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {join,dirname,resolve,basename} from 'node:path';
import {lstatSync,realpathSync,openSync,fstatSync,readSync,writeSync,closeSync,fsyncSync,constants,mkdirSync,existsSync} from 'node:fs';
import {digest,canonical} from './device-epoch-fence-reference.mjs';
const need=(v,c)=>{if(!v)throw Object.assign(Error('AUTH_'+c),{code:'AUTH_'+c});};
const same=(a,b)=>canonical(a)===canonical(b),sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const names={keypair:'ImportKeyPair-ack',attach:'AttachKeyPair-ack',keypair_readback:'AttachKeyPair-independent-keypair-readback',target:'AttachKeyPair-independent-target-readback',mapping:'AttachKeyPair-independent-adb-mapping-readback'};
function privateBytes(path,root){
 need(typeof path==='string'&&resolve(path)===path&&realpathSync(path)===path,'PATH');
 if(root){need(path.startsWith(root+'/')&&!path.split('/').includes('.android'),'PRIVATE_ROOT');let d=dirname(path);while(d!==dirname(root)){const s=lstatSync(d);need(s.isDirectory()&&!s.isSymbolicLink()&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o777)===0o700,'DIRECTORY');d=dirname(d);}}
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const s=fstatSync(fd);need(s.isFile()&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o777)===0o600&&s.nlink===1&&s.size<=4*1024*1024,'FILE');const b=Buffer.alloc(s.size+1);let size=0,n;while(size<b.length&&(n=readSync(fd,b,size,b.length-size,null))>0)size+=n;const e=fstatSync(fd);need(size===s.size&&s.dev===e.dev&&s.ino===e.ino&&s.mtimeMs===e.mtimeMs&&s.ctimeMs===e.ctimeMs,'FILE_DRIFT');return b.subarray(0,size);}finally{closeSync(fd);}
}
const json=(path,root)=>{try{return JSON.parse(privateBytes(path,root));}catch{need(false,'JSON');}};
const bigint=b=>BigInt('0x'+b.toString('hex'));
function little(n,size){const b=Buffer.alloc(size);for(let i=0;i<size;i++){b[i]=Number(n&255n);n>>=8n;}need(n===0n,'RSA_SIZE');return b;}
export function adbPublicKeyBytes(privatePem){
 try{const key=createPublicKey(createPrivateKey(privatePem)).export({format:'jwk'});need(key.kty==='RSA','KEY_TYPE');const n=bigint(Buffer.from(key.n,'base64url')),e=bigint(Buffer.from(key.e,'base64url'));need(n>=(1n<<2047n)&&n<(1n<<2048n)&&e===65537n,'RSA_SIZE');const modulus=1n<<32n;let a=n%modulus,b=modulus,x=1n,y=0n;while(b){const q=a/b;[a,b]=[b,a-q*b];[x,y]=[y,x-q*y];}need(a===1n,'RSA_INVERSE');const inverse=((x%modulus)+modulus)%modulus,n0=(modulus-inverse)%modulus,out=Buffer.alloc(524);out.writeUInt32LE(64,0);out.writeUInt32LE(Number(n0),4);little(n,256).copy(out,8);little((1n<<4096n)%n,256).copy(out,264);out.writeUInt32LE(Number(e),520);return out;}catch{need(false,'PRIVATE_KEY');}
}
function publicBytes(raw){const text=raw.toString('utf8').trim();need(!text.includes('\n')&&/^[A-Za-z0-9+/]+=*(?:[ \t]+[^\r\n]+)?$/.test(text),'PUBLIC_KEY');const encoded=text.split(/[ \t]/)[0],b=Buffer.from(encoded,'base64');need(b.length===524&&b.toString('base64')===encoded,'PUBLIC_KEY');return b;}
function body(raw){need(raw?.statusCode===200&&raw.headers?.['content-type']?.startsWith('application/json')&&typeof raw.body?.RequestId==='string'&&raw.body.RequestId===raw.headers['x-acs-request-id'],'PROVIDER_RESPONSE');return raw.body;}
function binding(task){
 const p=task?.result?.private_adb_auth_preparation,a=task?.result?.private_adb_import_attach_approval,e=task?.result?.private_adb_import_attach_execution;
 need(p?.vault_readback_verified===true&&p.secret_disclosed===false&&p.private_adb_port===5042&&p.compromised!==true&&p.revoked!==true&&typeof p.cache_directory==='string','PREPARATION');
 need(a?.protocol==='aliyun-adb-import-attach-operator-approval/v1'&&a.maintenance_task_id===task.id&&a.instance_id===p.instance_id&&a.onepassword_item_id===p.item_id&&a.public_key_sha256===p.public_key_sha256&&sha(a.plan_sha256)&&same(a.allowed_actions,['ImportKeyPair_once','AttachKeyPair_once_exact_singleton'])&&a.approved_by&&Number.isFinite(Date.parse(a.approved_at)),'PROVIDER_APPROVAL');
 need(e?.status==='cloud_binding_verified_only'&&e.plan_sha256===a.plan_sha256&&e.onepassword_item_id===p.item_id&&e.public_key_fingerprint_sha256===p.public_key_sha256&&e.target?.instance_id===p.instance_id&&e.target.adb_endpoint===p.endpoint&&e.target.new_key_pair_id!==e.target.old_key_pair_id&&e.import?.calls===1&&e.import.http_status===200&&e.import.independent_keypair_readback_verified===true&&e.attach?.calls===1&&e.attach.http_status===200&&e.attach.independent_instance_keypair_mapping_readbacks_verified===true&&e.forbidden_actions_performed===false&&e.original_execution_stopped===false&&e.epoch_published===false,'PROVIDER_EXECUTION');
 return {preparation:p,execution:e};
}
function verifyProofs(proofs,e){
 const imported=body(proofs.keypair),attached=body(proofs.attach),pair=body(proofs.keypair_readback),target=body(proofs.target),mapping=body(proofs.mapping),t=e.target,id=t.new_key_pair_id;
 need(imported.RequestId===e.import.request_id&&imported.Data?.KeyPairId===id&&imported.Data.KeyPairName===t.key_pair_name,'IMPORT_READBACK');
 need(attached.RequestId===e.attach.request_id&&attached.Data?.KeyPairId===id&&attached.Data.TotalCount===1&&attached.Data.FailCount===0&&same(attached.Data.AttachedInstanceIds,[t.instance_id]),'ATTACH_READBACK');
 need(pair.TotalCount===1&&pair.Data?.length===1&&pair.Data[0].KeyPairId===id&&pair.Data[0].KeyPairName===t.key_pair_name,'KEYPAIR_READBACK');
 need(target.TotalCount===1&&target.InstanceModel?.length===1&&target.InstanceModel[0].AndroidInstanceId===t.instance_id&&target.InstanceModel[0].KeyPairId===id&&target.InstanceModel[0].RegionId===t.region&&target.InstanceModel[0].AndroidInstanceStatus==='RUNNING','TARGET_READBACK');
 need(mapping.TotalCount===1&&mapping.Data?.length===1&&mapping.Data[0].InstanceId===t.instance_id&&mapping.Data[0].IpProtocol==='tcp'&&mapping.Data[0].ExternalIp+':'+mapping.Data[0].ExternalPort===t.adb_endpoint,'MAPPING_READBACK');
}
function authRoot(instance){need(instance?.policy?.endpoint==='tcp:127.0.0.1:5042'&&/^[a-z][a-z0-9-]{2,63}$/.test(instance.instance_id||'')&&resolve(instance.policy_path)===instance.policy_path,'INSTANCE');return join(dirname(instance.policy_path),'adb-auth',instance.instance_id);}
export function validateAuthReference({refPath,task,instance,now=Date.now()}={}){
 const root=authRoot(instance),raw=privateBytes(refPath,root),ref=JSON.parse(raw),{preparation:p,execution:e}=binding(task);
 need(same(Object.keys(ref).sort(),['credential','instance_id','key','protocol','provenance','resource'])&&ref.protocol==='device-epoch-fence-auth-ref/v1'&&ref.instance_id===instance.instance_id&&same(ref.resource,{serial:e.target.adb_endpoint,cloud_instance_id:e.target.instance_id,region_id:e.target.region}),'REF_SCOPE');
 const key=ref.key,c=ref.credential;
 need(same(Object.keys(key).sort(),['key_pair_id','path','public_file_sha256','public_key_sha256','public_path','sha256'])&&key.key_pair_id===e.target.new_key_pair_id&&sha(key.sha256)&&sha(key.public_file_sha256)&&key.public_key_sha256===p.public_key_sha256,'KEY_SCOPE');
 need(same(Object.keys(c).sort(),['compromised','expires_at','item_id','provider','valid_from','version'])&&c.provider==='1password'&&c.item_id===p.item_id&&Number.isSafeInteger(c.version)&&c.version>0&&c.compromised===false,'CREDENTIAL');
 for(const name of ['valid_from','expires_at'])if(c[name]!==0){need(typeof c[name]==='string'&&Number.isFinite(Date.parse(c[name])),'CREDENTIAL_DATE');need(name==='valid_from'?Date.parse(c[name])<=now:Date.parse(c[name])>now,'CREDENTIAL_DATE');}
 const pem=privateBytes(key.path,root),pub=privateBytes(key.public_path,root),decoded=publicBytes(pub);
 need(digest(pem)===key.sha256&&digest(pub)===key.public_file_sha256&&digest(decoded)===key.public_key_sha256&&adbPublicKeyBytes(pem).equals(decoded),'KEY_MATH');
 need(same(Object.keys(ref.provenance).sort(),Object.keys(names).sort()),'PROVENANCE_SET');const proofs={};
 for(const [name,source] of Object.entries(names)){const d=ref.provenance[name],expected=e.evidence?.files?.[source];need(same(Object.keys(d).sort(),['path','sha256'])&&sha(d.sha256)&&d.sha256===expected?.sha256,'PROVENANCE_BINDING');const b=privateBytes(d.path,root);need(digest(b)===d.sha256,'PROVENANCE_BYTES');proofs[name]=JSON.parse(b);}
 verifyProofs(proofs,e);
 return {ref,auth:{ref_path:refPath,ref_sha256:digest(raw),key_path:key.path,key_sha256:key.sha256,public_key_sha256:key.public_key_sha256}};
}
function ensure(path){if(!existsSync(path))mkdirSync(path,{mode:0o700});const s=lstatSync(path);need(s.isDirectory()&&!s.isSymbolicLink()&&realpathSync(path)===path&&[0,process.getuid()].includes(s.uid)&&(s.mode&0o777)===0o700,'DIRECTORY');}
function put(path,raw){if(existsSync(path)){need(digest(privateBytes(path))===digest(raw),'EXISTING_BYTES');return;}const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{let n=0;while(n<raw.length){const k=writeSync(fd,raw,n,raw.length-n);need(k>0,'WRITE');n+=k;}fsyncSync(fd);}finally{closeSync(fd);}const d=openSync(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{fsyncSync(d);}finally{closeSync(d);}need(digest(privateBytes(path))===digest(raw),'WRITE_READBACK');}
export async function prepareAuthReference({task,instance,credentialVersion,assertAuthority}={}){
 need(typeof assertAuthority==='function'&&Number.isSafeInteger(credentialVersion)&&credentialVersion>0,'PREPARATION_AUTHORITY');await assertAuthority();const {preparation:p,execution:e}=binding(task),root=authRoot(instance);ensure(dirname(instance.policy_path));ensure(dirname(root));ensure(root);
 const privateRaw=privateBytes(join(p.cache_directory,'adbkey'),p.cache_directory),publicRaw=privateBytes(join(p.cache_directory,'adbkey.pub'),p.cache_directory),decoded=publicBytes(publicRaw);need(digest(decoded)===p.public_key_sha256&&adbPublicKeyBytes(privateRaw).equals(decoded),'PREPARATION_KEY');
 const keyPath=join(root,'adbkey-'+p.public_key_sha256),publicPath=keyPath+'.pub';put(keyPath,privateRaw);put(publicPath,publicRaw);const provenance={};
 for(const [name,source] of Object.entries(names)){const d=e.evidence?.files?.[source];need(d&&sha(d.sha256),'PROVENANCE_BINDING');const b=privateBytes(d.path);need(digest(b)===d.sha256,'PROVENANCE_BYTES');const target=join(root,name+'-'+d.sha256+'.json');put(target,b);provenance[name]={path:target,sha256:d.sha256};}
 const ref={protocol:'device-epoch-fence-auth-ref/v1',instance_id:instance.instance_id,resource:{serial:e.target.adb_endpoint,cloud_instance_id:e.target.instance_id,region_id:e.target.region},key:{path:keyPath,sha256:digest(privateRaw),public_path:publicPath,public_file_sha256:digest(publicRaw),public_key_sha256:p.public_key_sha256,key_pair_id:e.target.new_key_pair_id},credential:{provider:'1password',item_id:p.item_id,version:credentialVersion,compromised:false,valid_from:0,expires_at:0},provenance},refPath=join(root,'auth-reference-'+digest(ref)+'.json');put(refPath,Buffer.from(canonical(ref)+'\n'));await assertAuthority();const verified=validateAuthReference({refPath,task,instance});return {...verified.auth,instance_id:instance.instance_id};
}
