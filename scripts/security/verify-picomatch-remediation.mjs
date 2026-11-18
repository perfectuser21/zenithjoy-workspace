import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,join,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const brands=new WeakMap();
const MANIFEST='scripts/security/picomatch-remediation/manifest.json';
const ADVISORY='GHSA-fc5q-39xc-vjpf',POLICY='repeated_extglob_rejected';
const UPSTREAM={
 '2.3.2':'sha512-V7+vQEJ06Z+c5tSye8S+nHUfI51xoXIXjHQ99cQtKUkQqqO1kO/KCJUfZXuB47h/YBlDhah2H3hdUGXn8ie0oA==',
 '4.0.7':'sha512-qcJu88Q2IWqJsDD529JKMdwGm/dvInW4HvQnRwiH9JtihJvzGOscDtHE3x1pBKeUOTysQ8kVmLnJ2kJu7yhcGA=='
};
const SITES={
 'package-lock.json':{'node_modules/picomatch':'4.0.7','node_modules/anymatch/node_modules/picomatch':'2.3.2','node_modules/micromatch/node_modules/picomatch':'2.3.2','node_modules/readdirp/node_modules/picomatch':'2.3.2'},
 'apps/dashboard/package-lock.json':{'node_modules/picomatch':'2.3.2','node_modules/@rollup/pluginutils/node_modules/picomatch':'4.0.7','node_modules/tinyglobby/node_modules/picomatch':'4.0.7','node_modules/vite/node_modules/picomatch':'4.0.7','node_modules/vitest/node_modules/picomatch':'4.0.7'}
};
const MARKER='  const extglobOpen = (type, value) => {';
const GUARD="\n    if (type === 'plus' || type === 'star') {\n      throw Object.assign(new SyntaxError('Repeated extglob syntax is disabled by GHSA-fc5q-39xc-vjpf remediation'), { code: 'PICOMATCH_REPEATED_EXTGLOB_BLOCKED' });\n    }";
const hash=b=>createHash('sha256').update(b).digest('hex');
const integrity=b=>'sha512-'+createHash('sha512').update(b).digest('base64');
const fail=code=>{throw Object.assign(Error('PICOMATCH_REMEDIATION_'+code),{code:'PICOMATCH_REMEDIATION_'+code});};
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
const same=(a,b)=>canonical(a)===canonical(b);
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function scope({repositoryRoot,projectRoot}={}){
 if(!isAbsolute(repositoryRoot||'')||!isAbsolute(projectRoot||''))fail('SCOPE');
 const repository=realpathSync(repositoryRoot),project=realpathSync(projectRoot),projectRelative=relative(repository,project)||'.';
 if(!['.','apps/dashboard'].includes(projectRelative))fail('SCOPE');
 return {repository,project,projectRelative,lockfile:projectRelative==='.'?'package-lock.json':'apps/dashboard/package-lock.json'};
}
function safePath(path){if(typeof path!=='string'||!path||isAbsolute(path)||path.includes('\\')||path.split('/').some(x=>!x||x==='.'||x==='..'))fail('PATH');return path;}
function tarFiles(bytes){
 let raw;try{raw=gunzipSync(bytes,{maxOutputLength:4*1024*1024});}catch{fail('ARCHIVE');}
 if(raw.length%512!==0)fail('ARCHIVE_BLOCK');
 const files=new Map(),paths=new Set();let position=0,ended=false;
 while(position+512<=raw.length){
  const header=raw.subarray(position,position+512);position+=512;
  if(header.every(x=>x===0)){if(raw.length-position<512||!raw.subarray(position).every(x=>x===0))fail('ARCHIVE_TRAILING');ended=true;break;}
  const checksumText=header.subarray(148,156).toString().replace(/\0/g,'').trim();
  const checksum=header.reduce((sum,value,index)=>sum+(index>=148&&index<156?32:value),0);
  if(!/^[0-7]+$/.test(checksumText)||parseInt(checksumText,8)!==checksum)fail('ARCHIVE_CHECKSUM');
  const text=(start,end)=>header.subarray(start,end).toString().replace(/\0.*$/s,'');
  const short=text(0,100),prefix=text(345,500),name=prefix?prefix+'/'+short:short,type=text(156,157),sizeText=text(124,136).trim();
  if(!/^[0-7]+$/.test(sizeText))fail('ARCHIVE_SIZE');const size=parseInt(sizeText,8);
  if(!Number.isSafeInteger(size)||size>1024*1024||position+size>raw.length)fail('ARCHIVE_SIZE');
  if(type!=='0'&&type!==''&&type!=='5')fail('ARCHIVE_TYPE');
  const normalized=type==='5'?name.replace(/\/$/,''):name;safePath(normalized);
  if(paths.has(normalized)||type==='5'&&size!==0)fail('ARCHIVE_DUPLICATE');paths.add(normalized);
  if(!normalized.startsWith('package/')&&normalized!=='package')fail('ARCHIVE_PATH');
  if(type!=='5'){if(files.has(normalized)||files.size>=100)fail('ARCHIVE_DUPLICATE');files.set(normalized,Buffer.from(raw.subarray(position,position+size)));}
  position+=Math.ceil(size/512)*512;
 }
 if(!ended||!files.has('package/package.json')||!files.has('package/lib/parse.js'))fail('ARCHIVE');
 return files;
}
function verifyInner(options){
 const s=scope(options),evidence=new Map();
 const read=path=>{safePath(path);const full=join(s.repository,path),stat=lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(full)!==full)fail('FILE');const bytes=readFileSync(full);evidence.set(path,hash(bytes));return bytes;};
 const manifestBytes=read(MANIFEST);let manifest;try{manifest=JSON.parse(manifestBytes);}catch{fail('MANIFEST');}
 if(manifest.schema_version!==1||manifest.advisory_id!==ADVISORY||manifest.package_name!=='picomatch'||manifest.policy_id!==POLICY)fail('MANIFEST');
 if(!Array.isArray(manifest.limitations)||!manifest.limitations.some(x=>typeof x==='string'&&x.includes('raw-regex')))fail('POLICY_LIMITS');
 const index=rows=>{if(!Array.isArray(rows)||rows.length!==2)fail('PACKAGE_SET');const map=new Map();for(const row of rows){if(!row||row.name!=='picomatch'||!Object.hasOwn(UPSTREAM,row.version)||map.has(row.version))fail('PACKAGE_SET');map.set(row.version,row);}return map;};
 const original=index(manifest.upstream_packages),patched=index(manifest.patched_packages),packages=[];
 for(const [version,up]of original){
  const fix=patched.get(version),upPath=`scripts/security/picomatch-remediation/packages/picomatch-${version}.upstream.tgz`,fixPath=`scripts/security/picomatch-remediation/packages/picomatch-${version}.patched.tgz`,patchPath=`scripts/security/picomatch-remediation/patches/picomatch-${version}.patch`;
  if(up.path!==upPath||fix.path!==fixPath||fix.patch_path!==patchPath||up.url!==`https://registry.npmjs.org/picomatch/-/picomatch-${version}.tgz`||up.integrity!==UPSTREAM[version])fail('PACKAGE_IDENTITY');
  const upstream=read(up.path),candidate=read(fix.path),patch=read(fix.patch_path);
  if(integrity(upstream)!==UPSTREAM[version]||hash(upstream)!==up.sha256||integrity(candidate)!==fix.integrity||hash(candidate)!==fix.sha256||hash(patch)!==fix.patch_sha256)fail('PACKAGE_HASH');
  const before=tarFiles(upstream),after=tarFiles(candidate);
  if(!same([...before.keys()].sort(),[...after.keys()].sort()))fail('PACKAGE_FILES');
  for(const [name,bytes]of before){
   if(name!=='package/lib/parse.js'){if(!bytes.equals(after.get(name)))fail('UNREVIEWED_PACKAGE_CHANGE');continue;}
   const body=bytes.toString('utf8');if(body.split(MARKER).length!==2||hash(bytes)!==up.parse_sha256)fail('PATCH_SOURCE');
   const expected=body.replace(MARKER,MARKER+GUARD);if(!after.get(name).equals(Buffer.from(expected))||hash(after.get(name))!==fix.parse_sha256)fail('PATCH_CONTENT');
  }
  const metadata=JSON.parse(after.get('package/package.json'));if(metadata.name!=='picomatch'||metadata.version!==version)fail('PACKAGE_IDENTITY');
  packages.push({name:'picomatch',version,source_tarball_url:up.url,source_tarball_path:up.path,source_integrity:up.integrity,patched_integrity:fix.integrity,patched_tarball_path:fix.path,patched_sha256:fix.sha256});
 }
 const expectedSites=Object.entries(SITES).flatMap(([lockfile,nodes])=>Object.entries(nodes).map(([package_path,version])=>({lockfile,package_path,version})));
 if(!Array.isArray(manifest.sites)||!same([...manifest.sites].sort((a,b)=>canonical(a).localeCompare(canonical(b))),expectedSites.sort((a,b)=>canonical(a).localeCompare(canonical(b)))))fail('SITE_MANIFEST');
 const packageJsonPath=s.projectRelative==='.'?'package.json':'apps/dashboard/package.json';
 const packageJson=read(packageJsonPath),lockBytes=read(s.lockfile);let lock;try{JSON.parse(packageJson);lock=JSON.parse(lockBytes);}catch{fail('LOCK');}
 if(lock.lockfileVersion!==3||!lock.packages||typeof lock.packages!=='object')fail('LOCK');
 const actual=Object.entries(lock.packages).filter(([path,row])=>path.endsWith('/picomatch')||row.name==='picomatch');
 if(!same(actual.map(([path,row])=>[path,row.version]).sort(),Object.entries(SITES[s.lockfile]).sort()))fail('SITE_SET');
 const inventory=[];
 for(const [package_path,row]of actual){
  const artifact=patched.get(row.version),resolved='file:'+(s.projectRelative==='.'?'':'../../')+artifact.path;
  if(row.resolved!==resolved||row.integrity!==artifact.integrity||row.link||row.inBundle||row.hasInstallScript||row.name&&row.name!=='picomatch')fail('SITE_BINDING');
  inventory.push({lockfile:s.lockfile,package_path,name:'picomatch',version:row.version,resolved,integrity:row.integrity});
 }
 const versions=[...new Set(inventory.map(x=>x.version))].sort();
 const proof=freeze({schema_version:1,advisory_id:ADVISORY,package_name:'picomatch',policy_id:POLICY,scope:'locked-distribution',repository_root:s.repository,project_root:s.project,project_relative:s.projectRelative,manifest_sha256:hash(manifestBytes),lockfile_sha256:hash(lockBytes),package_json_sha256:hash(packageJson),versions,packages:packages.filter(x=>versions.includes(x.version)),inventory});
 brands.set(proof,{scope:s,evidence});return proof;
}
export function verifyRemediation(options){try{return verifyInner(options);}catch(error){if(String(error.code||'').startsWith('PICOMATCH_REMEDIATION_'))throw error;fail('INVALID');}}
export function isVerifiedRemediation(proof,options){
 try{const stored=brands.get(proof);if(!stored||!same(scope(options),stored.scope))return false;for(const [path,digest]of stored.evidence){const full=join(stored.scope.repository,path),stat=lstatSync(full);if(!stat.isFile()||stat.isSymbolicLink()||realpathSync(full)!==full||hash(readFileSync(full))!==digest)return false;}return true;}catch{return false;}
}
