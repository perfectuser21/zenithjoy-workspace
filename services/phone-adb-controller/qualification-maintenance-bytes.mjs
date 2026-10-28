import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,join,sep} from 'node:path';
import {collectDeployment} from './deployment-manifest.mjs';
const need=value=>{if(!value)throw Error('MAINTENANCE_CANDIDATE_BYTES_UNPROVEN');};
export function collectMaintenanceCandidateRoot(root) {
 root=resolve(root);need(root===realpathSync(root));
 let total=0;
 const rawFile=relative=>{
  need(typeof relative==='string'&&!relative.startsWith('/')&&!relative.split('/').some(p=>['.','..',''].includes(p)));
  let current=root;
  for(const segment of relative.split('/')){current=join(current,segment);need(!lstatSync(current).isSymbolicLink());}
  need(current.startsWith(root+sep));const s=lstatSync(current);
  need(s.isFile()&&s.uid===process.getuid()&&(s.mode&0o022)===0&&s.size<=8*1024*1024);
  const raw=readFileSync(current);total+=raw.length;need(total<=64*1024*1024);return raw;
 };
 const raw=rawFile('deployment-manifest.json'),manifest=JSON.parse(raw),seen=new Set();
 need(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=1024);
 for(const entry of manifest.files){need(!seen.has(entry.deployed_path));seen.add(entry.deployed_path);rawFile(entry.deployed_path);}
 // 使用正式发布采集器再次实际hash，并在末尾复核manifest原件未更换。
 const observed=collectDeployment(root,manifest);need(raw.equals(rawFile('deployment-manifest.json')));
 return {manifest_raw:raw.toString('base64'),observed};
}
