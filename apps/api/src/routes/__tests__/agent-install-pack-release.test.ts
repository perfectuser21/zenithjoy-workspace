import {afterEach,it,expect,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {installPackReleaseRouter} from '../agent-install-pack-release';
const dirs:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();dirs.splice(0).forEach(d=>fs.rmSync(d,{recursive:true,force:true}));});
it('真实HTTP边界：所有分发写入需鉴权，错误验收保留原manifest字节',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'installpack-http-'));dirs.push(dir);
 const file=path.join(dir,'manifest.json');fs.writeFileSync(file,'{"version":"old","sha256":"old"}');
 vi.stubEnv('INSTALL_PACK_MANIFEST_PATH',file);vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN','test-release-token');
 const app=express();app.use(express.json());app.use(installPackReleaseRouter);
 for(const endpoint of ['candidates','verify','promote','rollback'])expect((await request(app).post('/'+endpoint).send({})).status).toBe(401);
 const state=await request(app).get('/release-state').set('X-Internal-Token','test-release-token');
 expect(state.body.manifest.version).toBe('old');expect(state.body.manifest_sha256).toMatch(/^[a-f0-9]{64}$/);
 expect((await request(app).post('/promote').set('X-Internal-Token','test-release-token').send({})).status).toBe(409);
 expect(fs.readFileSync(file,'utf8')).toBe('{"version":"old","sha256":"old"}');
});
it('发布入口没有内部凭据必须拒绝，不能继承开发环境免认证',async()=>{
 vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN','');
 const app=express();app.use(express.json());app.use(installPackReleaseRouter);
 expect((await request(app).get('/release-contract')).status).toBe(503);
 expect((await request(app).post('/candidates').send({})).status).toBe(503);
});
it('未认证暴力请求会被发布入口限流',async()=>{
 vi.stubEnv('ZENITHJOY_INTERNAL_TOKEN','test-release-token');
 const app=express();app.use(express.json());app.use(installPackReleaseRouter);
 const statuses=[];
 for(let i=0;i<65;i++)statuses.push((await request(app).post('/verify').send({})).status);
 expect(statuses).toContain(429);
});
