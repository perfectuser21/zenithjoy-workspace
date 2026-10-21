import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readInstallPackManifest} from '../install-pack-manifest';
import {it,expect} from 'vitest';
import {selectReleasedModules} from '../released-modules';
const baseline={'line04-wechat-cs':{status:'active' as const,required_version:'1.0.153'}};
it('未晋级候选不影响心跳；正式manifest选择版本，恢复前驱后选择原版本',()=>{
 expect(selectReleasedModules(baseline,null)).toEqual(baseline);
 const upgraded={modules:[{line_id:'line04-wechat-cs',filename:'line04-wechat-cs-v1.0.154.tar.gz'}]};
 expect(selectReleasedModules(baseline,upgraded)['line04-wechat-cs'].required_version).toBe('1.0.154');
 expect(selectReleasedModules(baseline,null)['line04-wechat-cs'].required_version).toBe('1.0.153');
 expect(()=>selectReleasedModules(baseline,{modules:[]})).toThrow();
});
it('API自身升级不能让未准入的模块常量抢先生效',()=>{
 const compiled={'line04-wechat-cs':{status:'active' as const,required_version:'1.0.154'}};
 expect(selectReleasedModules(compiled,null)['line04-wechat-cs'].required_version).toBe('1.0.153');
});
it('已有正式清单丢失modules不能降级成legacy',()=>{
 expect(()=>selectReleasedModules(baseline,{release_journal:'saved'})).toThrow();
 expect(()=>selectReleasedModules(baseline,{release_receipt:{run_key:'saved'}})).toThrow();
});

it('严格读已有损坏清单或丢失正式文件必须失败，合法legacy仍可读',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-corrupt-')),file=path.join(dir,'manifest.json');
 try{
  fs.writeFileSync(file,'broken');expect(()=>readInstallPackManifest(file,true)).toThrow();
  fs.writeFileSync(file,JSON.stringify({version:'2.0.94',sha256:'a'.repeat(64),download_url:'/download/old.tar.gz'}));
  expect(readInstallPackManifest(file,true)?.version).toBe('2.0.94');
  fs.unlinkSync(file);fs.mkdirSync(file+'.releases');expect(()=>readInstallPackManifest(file,true)).toThrow();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
