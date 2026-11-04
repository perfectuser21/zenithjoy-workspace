#!/usr/bin/env node
// One deterministic consumer of current media code. No credentials, production URL or paid provider calls.
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
export function verifyReport(report, expected) {
 if(report.success!==true || !(report.numTotalTests>0) || report.numPassedTests!==report.numTotalTests || report.numPendingTests || report.numTodoTests || report.numFailedTestSuites)throw new Error('media contract report must contain only executed passing tests');
 for(const file of expected) {
  const result=report.testResults?.find(r=>r.name.replaceAll('\\','/').endsWith('/'+file));
  if(!result || result.status!=='passed' || !result.assertionResults?.length || result.assertionResults.some(r=>r.status!=='passed'))throw new Error(`missing, empty, skipped or failed media suite: ${file}`);
 }
}
const api=[
 'src/controllers/__tests__/compose-template.test.ts','src/controllers/__tests__/ai-video-pipeline-template.test.ts','src/templates/__tests__/template-c-r.test.ts',
 'src/controllers/__tests__/media-provider-http.test.ts','src/services/__tests__/video-frame-extract.test.ts',
 'src/routes/__tests__/materials.test.ts','src/routes/__tests__/materials-delete.test.ts','src/services/__tests__/material-upload.test.ts','src/services/__tests__/material-persist.test.ts','src/services/__tests__/material-storage-cos.test.ts',
 'src/services/__tests__/mashup-render.test.ts','src/services/__tests__/mashup-preview-render.test.ts','src/services/__tests__/mashup-preview-queue.test.ts','src/services/__tests__/mashup-render-ffmpeg.test.ts','src/services/__tests__/mashup-render-ffmpeg-audio.test.ts',
 'src/routes/__tests__/ai-video.test.ts','src/services/__tests__/ai-video.service.test.ts','src/services/__tests__/ai-video-upload.service.test.ts',
 'src/services/__tests__/ali-video-provider.test.ts','src/routes/__tests__/video-tools.test.ts','src/routes/__tests__/video-tools-direct-upload.test.ts','src/services/creative-canvas-configured.test.ts',
 'src/routes/aidge.test.ts','src/middleware/aidge-viewer.test.ts','src/services/aidge-catalog.test.ts','src/services/aidge-gateway.test.ts','src/services/aidge-translation.test.ts',
];
const dashboard=['src/components/video-pipeline/__tests__/TemplateSelector.test.tsx','src/pages/__tests__/LocalVideoPipelinePage.test.ts','src/pages/__tests__/CreativeCanvasPage.test.tsx','src/pages/__tests__/VideoToolsPage.test.tsx','src/pages/__tests__/AidgeWorkspacePage.test.tsx','src/api/aidge-access.test.ts'];
const agent=['src/handlers/__tests__/media-rotation-runtime.test.ts','src/handlers/__tests__/video-pipeline.test.ts','modules/line02/__tests__/report-videos-runtime.test.ts','publishers/douyin-publisher/__tests__/publish-douyin-video.test.cjs'];
export const groups={render:{cwd:'apps/api',files:['src/services/__tests__/media-render-runtime.test.ts']},api:{cwd:'apps/api',files:api},dashboard:{cwd:'apps/dashboard',files:dashboard},agent:{cwd:'services/agent',files:agent},pg:{cwd:'apps/api',files:['tests/integration/media/pipeline.test.ts','tests/integration/media/materials.test.ts'],config:'vitest.media-pg.config.ts'}};
export function runContractGroups(selected=process.argv.slice(2)){
 const root=fileURLToPath(new URL('../../../../../',import.meta.url));
 if(!selected.length)selected.push(...Object.keys(groups));
 if(selected.some(g=>!groups[g]))throw new Error('unknown media contract group');
 const temp=mkdtempSync('/tmp/zj-media-');let pgStarted=false;
 const pgBin=process.env.MEDIA_POSTGRES_BIN??['/opt/homebrew/opt/postgresql@17/bin','/usr/lib/postgresql/17/bin','/usr/lib/postgresql/16/bin','/usr/lib/postgresql/15/bin'].find(p=>existsSync(path.join(p,'initdb')));
 const exec=(exe,args,opts={})=>{const r=spawnSync(exe,args,{encoding:'utf8',stdio:'inherit',...opts});if(r.status!==0)throw new Error(`${exe} exited ${r.status}: ${r.error??''}`);};
 try{
  for(const name of selected){
   const g=groups[name],env={...process.env};
   // All model/provider tests inject their boundary; accidental real credentials are absent.
   for(const k of Object.keys(env))if(/(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY)/i.test(k))delete env[k];
   if(name==='pg'||g.postgres){
    if(!pgBin)throw new Error('PostgreSQL initdb/pg_ctl required; set MEDIA_POSTGRES_BIN');
    exec(path.join(pgBin,'initdb'),['-D',temp+'/data','-U','media_contract','-A','trust','--no-locale','--encoding=UTF8'],{stdio:'ignore'});
    exec(path.join(pgBin,'pg_ctl'),['-D',temp+'/data','-l',temp+'/postgres.log','-o',`-F -k ${temp} -h ''`,'-w','start'],{stdio:'ignore'});pgStarted=true;
    Object.assign(env,{DATABASE_HOST:temp,DATABASE_PORT:'5432',DATABASE_USER:'media_contract',DATABASE_NAME:'postgres',DATABASE_PASSWORD:''});
   }
   const report=path.join(temp,name+'.json');
   const vitest=path.join(root,g.cwd,'node_modules/vitest/vitest.mjs');
   const binary=existsSync(vitest)?vitest:path.join(root,'node_modules/vitest/vitest.mjs');
   try { exec(process.execPath,[binary,'run',...g.files,...(g.config?['--config',g.config]:[]),'--reporter=json','--outputFile='+report],{cwd:path.join(root,g.cwd),env}); } catch(error) { if(existsSync(report)) { const failed=JSON.parse(readFileSync(report,'utf8')); for(const suite of failed.testResults??[])if(suite.status!=='passed')console.error(suite.name,suite.message,suite.assertionResults?.filter(r=>r.status==='failed')); } throw error; }
   const data=JSON.parse(readFileSync(report,'utf8'));verifyReport(data,g.files);
   console.log(`media ${name}: verified executed suites=${g.files.length} tests=${data.numPassedTests} skipped=${data.numPendingTests}`);
  }
 }finally{if(pgStarted)spawnSync(path.join(pgBin,'pg_ctl'),['-D',temp+'/data','-m','immediate','-w','stop'],{stdio:'ignore'});rmSync(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))runContractGroups();
