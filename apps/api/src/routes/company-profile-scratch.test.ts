import { describe, expect, it, vi } from 'vitest';
import express, { type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import pg, { type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import type { Browser } from '@playwright/test';
import type { ViteDevServer } from 'vite';
import type { Server, IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { representativeEvidence, representativeDocs } from '../../tests/fixtures/company-wiki-evidence';
const shared = vi.hoisted(() => ({ client: null as PoolClient | null, cookies: {} as Record<string,string> }));
const nestedQuery = <Row extends QueryResultRow = Record<string,unknown>>(sql: string, args?: unknown[]): Promise<QueryResult<Row>> => {
  const client=shared.client;if(!client)throw new Error('scratch client not initialized');
  return client.query<Row>(sql === 'BEGIN' ? 'SAVEPOINT company_api' : sql === 'COMMIT' ? 'RELEASE SAVEPOINT company_api' : sql === 'ROLLBACK' ? 'ROLLBACK TO SAVEPOINT company_api' : sql, args);
};
vi.mock('../db/connection', () => ({ default: { query: (sql:string,args?:unknown[]) => nestedQuery(sql,args), connect: async () => ({ query: (sql:string,args?:unknown[]) => nestedQuery(sql,args), release() {} }) } }));
// 仅隔离测试服务器身份注入；生产路由仍运行tenantContext，不接受X-Tenant-Id。
vi.mock('../middleware/tenant-context', () => ({ tenantContext: (req:Request,_res:Response,next:NextFunction) => { req.tenantId=shared.cookies[req.header('Cookie') ?? ''] ?? req.header('X-Test-Tenant'); req.tenantRole='owner'; req.feishuUserId='scratch-e2e'; next(); } }));
import { companyProfileRouter } from './company-profile';
const require = createRequire(import.meta.url);
const { freezeCompanyConfig } = require('../../../../services/phone-adb-controller/company-config-lib.js');
const root = resolve(__dirname, '../../../..');

describe('真实scratch公司Wiki/API/页面闭环', () => {
  it.skipIf(!process.env.COMPANY_CONFIG_SCRATCH_URL)('两公司真实种子、版本生命周期、浏览器编辑与运行冻结不漂移', async () => {
    const pool = new pg.Pool({connectionString:process.env.COMPANY_CONFIG_SCRATCH_URL});
    const client = await pool.connect(); shared.client=client;
    let browser:Browser|undefined, vite:ViteDevServer|undefined, server:Server|undefined;
    const cookieFiles:string[]=[];
    const nested = {query:nestedQuery,connect:async()=>({query:nestedQuery,release(){}})};
    try {
      expect((await client.query('SELECT current_database() AS db')).rows[0].db).toBe('cecelia_scratch');
      await client.query('BEGIN');
      await client.query(await readFile(resolve(root,'apps/api/db/migrations/20261013_170000_company_wiki_config.sql'),'utf8'));
      const evidence=process.env.COMPANY_WIKI_EVIDENCE_PATH ? JSON.parse(await readFile(process.env.COMPANY_WIKI_EVIDENCE_PATH,'utf8')) : representativeEvidence;
      const docs=process.env.COMPANY_WIKI_DOCS_PATH ? JSON.parse(await readFile(process.env.COMPANY_WIKI_DOCS_PATH,'utf8')) : representativeDocs;
      const mapping=Object.fromEntries(['jinoshengyuan','yueshengyun'].map(key=>[key,{environment:'scratch',database:'cecelia_scratch',tenant_id:randomUUID(),company_id:randomUUID(),owner:'scratch-owner',verification_source:'scratch随机测试身份；资料按指定证据或去敏样本加载，不代表生产映射'}]));
      const {buildSeeds,persistSeeds}=await import('../../scripts/company-wiki-import.mjs');
      const seeds=buildSeeds(evidence,docs,mapping);
      for(const seed of seeds) await client.query('INSERT INTO zenithjoy.tenants(id,name) VALUES($1,$2)',[seed.tenant_id,seed.company_name]);
      await persistSeeds(nested,seeds);
      const app=express(); app.use(express.json()); app.use('/api/company-profile',companyProfileRouter);
      const read = (seed:{tenant_id:string})=>request(app).get('/api/company-profile').set('X-Test-Tenant',seed.tenant_id);
      const save = (seed:{tenant_id:string},body:Record<string,unknown>)=>request(app).put('/api/company-profile').set('X-Test-Tenant',seed.tenant_id).send(body);
      for(const seed of seeds){
        const loaded=await read(seed);expect(loaded.status).toBe(200);
        expect(loaded.body.data.company_id).toBe(seed.company_id);expect(loaded.body.data.wiki.markdown).toBe(seed.wiki.markdown);expect(loaded.body.data.source_evidence.base).toBe(seed.source_evidence.base);
        expect(loaded.body.data.sync_status.notion.status).toBe('unmapped');
        const confirm=await save(seed,{expected_version:1,config_status:'confirmed'});expect(confirm.status,JSON.stringify(confirm.body)).toBe(200);
        const enable=await save(seed,{expected_version:2,config_status:'enabled'});expect(enable.status,JSON.stringify(enable.body)).toBe(200);
        expect(enable.body.data.config_version).toBe(3);
      }
      const first=await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'scratch-old-run',step:'102'});
      const other=await freezeCompanyConfig(nested,{lineHint:'yuesheng',runId:'scratch-old-run',step:'103'});
      expect(first.company_id).not.toBe(other.company_id);expect(first.version).toBe(3);
      if(process.env.COMPANY_WIKI_EXTERNAL_E2E === '1') {
        if(!process.env.COMPANY_WIKI_EXTERNAL_RUNNER || !process.env.COMPANY_WIKI_EVIDENCE_PATH || !process.env.COMPANY_WIKI_DOCS_PATH || !process.env.COMPANY_WIKI_EXTERNAL_ARTIFACT_DIR)throw new Error('真实外部验收需显式runner、完整资料及证据目录');
        const artifactDir=process.env.COMPANY_WIKI_EXTERNAL_ARTIFACT_DIR;await mkdir(artifactDir,{recursive:true});
        server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
        const apiUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/company-profile`;
        const inputs=[];
        for(const [index,seed] of seeds.entries()) {
          const cookie=`company-scratch-session=${randomUUID()}`;shared.cookies[cookie]=seed.tenant_id;
          const cookieFile=resolve(artifactDir,`${seed.company_key}-test-cookie.txt`);await writeFile(cookieFile,cookie,{mode:0o600});cookieFiles.push(cookieFile);
          const stored=(await client.query('SELECT snapshot FROM zenithjoy.company_config_versions WHERE company_id=$1 AND tenant_id=$2 AND version=3',[seed.company_id,seed.tenant_id])).rows[0].snapshot;
          inputs.push({company_key:seed.company_key,base:seed.source_evidence.base,snapshot:stored,api_url:apiUrl,cookie_file:cookieFile,test_conflict:index===0});
        }
        const external=await import(/* @vite-ignore */ pathToFileURL(process.env.COMPANY_WIKI_EXTERNAL_RUNNER).href);
        const result=await external.runExternalE2E({inputs,db:nested,manifestPath:resolve(artifactDir,'created-manifest.json'),evidencePath:resolve(artifactDir,'external-evidence.json')});
        expect(result.status).toBe('passed');expect(result.projections).toBe(4);expect(result.cleanup).toBe('complete');
        const changes=(await client.query("SELECT conflict FROM zenithjoy.company_config_changes WHERE company_id=$1 AND source='web' AND conflict->>'kind'='version_conflict'",[seeds[0].company_id])).rows;
        expect(changes.length).toBeGreaterThan(0);
        const current=(await read(seeds[0])).body.data;expect(current.config_version).toBe(4);expect(current.config_status).toBe('draft');expect(current.wiki.markdown).toContain('验收：负责人纠正');
        expect(current.sync_status.notion.status).toBe('unmapped');expect(current.sync_status.feishu.status).toBe('unmapped');
        expect((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'scratch-old-run',step:'103'})).version).toBe(3);
        return;
      }
      if(process.env.COMPANY_WIKI_E2E_BROWSER === '1') {
      server=app.listen(0,'127.0.0.1'); await new Promise<void>(resolve=>server.once('listening',resolve));
      const apiUrl=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const {createServer}=await import('vite'); const react=(await import('@vitejs/plugin-react')).default;
      const dashboardRequire=createRequire(resolve(root,'apps/dashboard/package.json'));const tailwind=dashboardRequire('tailwindcss');const autoprefixer=dashboardRequire('autoprefixer');
      const tailwindConfig=(await import('../../../dashboard/tailwind.config.js')).default;
      // 浏览器直接加载实际公司页面，实际fetch到测试API及真实PG，不mock网络响应。
      vite=await createServer({
        configFile:false,root:resolve(root,'apps/dashboard'),css:{postcss:{plugins:[tailwind({...tailwindConfig,content:[resolve(root,'apps/dashboard/index.html'),resolve(root,'apps/dashboard/src/**/*.{js,ts,jsx,tsx}')]}),autoprefixer()]}},optimizeDeps:{entries:[],include:['react','react-dom/client']},
        plugins:[react(),{
          name:'wiki-e2e-entry',
          resolveId(id:string){if(id==='/wiki-e2e-entry.js')return '\0wiki-e2e-entry';},
          load(id:string){if(id==='\0wiki-e2e-entry')return 'import React from "react";import{createRoot}from"react-dom/client";import Page from "/src/pages/CompanyProfilePage.tsx";import "/src/index.css";createRoot(document.getElementById("root")).render(React.createElement(Page));';},
          configureServer(v:ViteDevServer){v.middlewares.use('/__wiki_e2e',async(_req:IncomingMessage,res:ServerResponse)=>{res.setHeader('Content-Type','text/html');res.end(await v.transformIndexHtml('/__wiki_e2e','<html><body><div id="root"></div><script type="module" src="/wiki-e2e-entry.js"></script></body></html>'));});}
        }],server:{host:'127.0.0.1',port:0,proxy:{'/api/company-profile':apiUrl}}
      });
      await vite.listen();
      const {chromium}=await import('@playwright/test'); browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
      if(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR)await mkdir(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR,{recursive:true});
      const page=await browser.newPage({extraHTTPHeaders:{'X-Test-Tenant':seeds[0].tenant_id}});
      const url=`http://127.0.0.1:${(vite.httpServer!.address() as AddressInfo).port}/__wiki_e2e`;
      await page.goto(url);await page.getByText('版本 3 · 已启用').waitFor();
      await page.getByRole('tab',{name:'产品与价值'}).click();expect(await page.getByText(seeds[0].wiki.products[0].name,{exact:true}).count()).toBe(1);
      await page.getByRole('tab',{name:'目标客群'}).click();expect(await page.getByText(seeds[0].wiki.audiences[0].name,{exact:true}).count()).toBe(1);
      await page.getByRole('tab',{name:'公司Wiki与配置'}).click();
      expect(await page.getByLabel('公司Wiki Markdown').inputValue()).toBe(seeds[0].wiki.markdown);
      expect(await page.getByText('Notion：未接通').count()).toBe(1);
      const yueshengPage=await browser.newPage({extraHTTPHeaders:{'X-Test-Tenant':seeds[1].tenant_id}});await yueshengPage.goto(url);await yueshengPage.getByText('版本 3 · 已启用').waitFor();await yueshengPage.getByRole('tab',{name:'公司Wiki与配置'}).click();
      expect(await yueshengPage.getByLabel('公司Wiki Markdown').inputValue()).toBe(seeds[1].wiki.markdown);
      expect(await yueshengPage.getByTestId('company-source-evidence').textContent()).toContain(seeds[1].source_evidence.base);
      if(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR){await page.screenshot({path:resolve(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR,'jinuo-wiki.png'),fullPage:true});await yueshengPage.screenshot({path:resolve(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR,'yuesheng-wiki.png'),fullPage:true});}
      await yueshengPage.close();
      const changedWiki=seeds[0].wiki.markdown+'\n\n浏览器scratch修订';await page.getByLabel('公司Wiki Markdown').fill(changedWiki);await page.getByRole('button',{name:'保存配置'}).click();
      await page.getByText('版本 4 · 草稿').waitFor();
      expect((await read(seeds[0])).body.data.wiki.markdown).toBe(changedWiki);
      expect((await read(seeds[1])).body.data.wiki.markdown).toBe(seeds[1].wiki.markdown);
      await page.getByLabel('配置状态').selectOption('confirmed');await page.getByRole('button',{name:'保存配置'}).click();await page.getByText('版本 5 · 已确认').waitFor();
      await page.getByLabel('配置状态').selectOption('enabled');await page.getByRole('button',{name:'保存配置'}).click();await page.getByText('版本 6 · 已启用').waitFor();
      } else {
        // CI无需浏览器或私有/tmp：同一真实API/PG生命周期使用代表性资料复现。
        const changedWiki={...seeds[0].wiki,markdown:seeds[0].wiki.markdown+'\nAPI scratch修订'};
        const edit=await save(seeds[0],{expected_version:3,wiki:changedWiki});expect(edit.status).toBe(200);expect(edit.body.data.profile.config_status).toBe('draft');
        expect((await save(seeds[0],{expected_version:4,config_status:'confirmed'})).status).toBe(200);
        expect((await save(seeds[0],{expected_version:5,config_status:'enabled'})).status).toBe(200);
      }
      expect((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'scratch-old-run',step:'103'})).version).toBe(3);
      expect((await freezeCompanyConfig(nested,{lineHint:'jinuo',runId:'scratch-new-run',step:'102'})).version).toBe(6);
      const conflict=await save(seeds[0],{expected_version:3,company_name:'不能覆盖'});expect(conflict.status).toBe(409);
      expect((await read(seeds[0])).body.data.config_version).toBe(6);
      if(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR)await writeFile(resolve(process.env.COMPANY_WIKI_E2E_ARTIFACT_DIR,'result.json'),JSON.stringify({database:'cecelia_scratch',real_api:true,real_browser:process.env.COMPANY_WIKI_E2E_BROWSER==='1',evidence_source:process.env.COMPANY_WIKI_EVIDENCE_PATH?'private_evidence':'representative_fixture',real_postgres:true,companies:seeds.map((seed:{tenant_id:string})=>({company_id:seed.company_id,company_key:seed.company_key,source_base:seed.source_evidence.base,products:seed.wiki.products.length,audiences:seed.wiki.audiences.length})),first_run_version:3,new_run_version:6,conflict_status:conflict.status,transaction:'rolled_back_after_test'},null,2),{mode:0o600});
      const history=await client.query('SELECT count(*)::int AS count FROM zenithjoy.company_config_versions WHERE company_id=$1',[seeds[0].company_id]);expect(history.rows[0].count).toBe(6);
    } finally {if(browser)await browser.close();if(vite)await vite.close();if(server)await new Promise<void>(resolve=>server.close(()=>resolve()));await client.query('ROLLBACK');for(const cookieFile of cookieFiles)await unlink(cookieFile).catch(()=>{});shared.client=null;shared.cookies={};client.release();await pool.end();}
  }, process.env.COMPANY_WIKI_EXTERNAL_E2E==='1'?240_000:60_000);
});
