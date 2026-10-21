import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
const cli=new URL('../runtime-receipts.mjs',import.meta.url).pathname;
test('正式prepare只接受明确scope文件参数，非0600及软链在任何网络/登记前拒绝',t=>{
 const dir=mkdtempSync(join(tmpdir(),'scope-input-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=join(dir,'scope.json'),link=join(dir,'link.json');writeFileSync(file,'{}',{mode:0o644});symlinkSync(file,link);
 const env={...process.env};delete env.HOME;delete env.WFR_HOME;
 for(const path of [file,link]){const result=spawnSync(process.execPath,[cli,'prepare','--collection-phone-scope',path],{encoding:'utf8',env:{...env,WFR_HOME:dir,WFR_RUN_DIR:dir,BRAIN_URL:'',WF_BRAIN_WORKFLOW:'douyin_video_processing'}});assert.equal(result.status,1);assert.match(result.stderr,/COLLECTION_SCOPE_FILE_NOT_PRIVATE/);}
});
