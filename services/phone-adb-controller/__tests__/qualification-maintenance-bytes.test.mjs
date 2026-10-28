import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {digest} from '../runtime-definition.mjs';
const api=await import('../qualification-maintenance-bytes.mjs').catch(e=>{if(e.code==='ERR_MODULE_NOT_FOUND')return null;throw e;});
function fixture(t){const root=realpathSync(mkdtempSync(join(tmpdir(),'maintenance-bytes-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
 const bytes=Buffer.from('real isolated bytes\n');writeFileSync(join(root,'entry.mjs'),bytes);
 const manifest={source_repo:'perfectuser21/zenithjoy-workspace',source_commit:'c'.repeat(40),files:[{path:'services/phone-adb-controller/entry.mjs',deployed_path:'entry.mjs',content_sha256:digest(bytes)}]};
 const raw=Buffer.from(JSON.stringify(manifest,null,2));writeFileSync(join(root,'deployment-manifest.json'),raw);return {root,raw,manifest};}
test('本人实际读取manifest原bytes+每个实文件，不接受verified标签',t=>{
 const f=fixture(t);assert.equal(typeof api?.collectMaintenanceCandidateRoot,'function');const out=api.collectMaintenanceCandidateRoot(f.root);
 assert.equal(out.manifest_raw, f.raw.toString('base64'));assert.deepEqual(out.observed.files,f.manifest.files);
});
for(const [name,change]of [
 ['文件漂移',f=>writeFileSync(join(f.root,'entry.mjs'),'different')],
 ['symlink即使内容相同',f=>{writeFileSync(join(f.root,'other.mjs'),'real isolated bytes\n');unlinkSync(join(f.root,'entry.mjs'));symlinkSync(join(f.root,'other.mjs'),join(f.root,'entry.mjs'));}],
 ['落点越界',f=>{f.manifest.files[0].deployed_path='../outside';writeFileSync(join(f.root,'deployment-manifest.json'),JSON.stringify(f.manifest));}],
 ['重复落点',f=>{f.manifest.files.push({...f.manifest.files[0]});writeFileSync(join(f.root,'deployment-manifest.json'),JSON.stringify(f.manifest));}],
])test(name+'必须失败不返回自签成功',t=>{const f=fixture(t);change(f);assert.equal(typeof api?.collectMaintenanceCandidateRoot,'function');assert.throws(()=>api.collectMaintenanceCandidateRoot(f.root));});
