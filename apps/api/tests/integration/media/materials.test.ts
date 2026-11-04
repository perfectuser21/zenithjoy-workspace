import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import express from 'express';import request from 'supertest';
import {mkdtemp,readFile,copyFile,rm,stat} from 'node:fs/promises';import {join} from 'node:path';import {randomUUID} from 'node:crypto';import {createServer,Server} from 'node:http';
// Tagging is the paid model boundary. Authentication, persistence and bytes are real.
vi.mock('../../../src/services/material-tagging-queue',()=>({enqueueTagging:async()=>{}}));
import pool from '../../../src/db/connection';import {createMaterialsRouter} from '../../../src/routes/materials';import type {MaterialStorage} from '../../../src/services/material-storage';
let dir:string,server:Server,base:string;const tenants=[randomUUID(),randomUUID()];
const filePath=(key:string)=>join(dir,Buffer.from(key).toString('hex'));
const storage:MaterialStorage={
 putObject:async({key,filePath:source})=>{await copyFile(source,filePath(key));},
 getSignedUrl:async key=>base+'/'+encodeURIComponent(key),presignPut:async key=>base+'/'+encodeURIComponent(key),
 deleteObject:async key=>{await rm(filePath(key));},headObject:async key=>{try{return {sizeBytes:(await stat(filePath(key))).size};}catch{return null;}},
};
const app=express();app.use(express.json());app.use('/api/materials',createMaterialsRouter({storage}));
beforeAll(async()=>{
 if(!process.env.DATABASE_HOST?.startsWith('/tmp/zj-media-'))throw new Error('requires disposable media PostgreSQL harness');
 dir=await mkdtemp('/tmp/zj-material-');
 server=createServer(async(req,res)=>{try{const key=decodeURIComponent(req.url!.slice(1));if(req.method==='PUT'){const chunks=[];for await(const c of req)chunks.push(c);await (await import('node:fs/promises')).writeFile(filePath(key),Buffer.concat(chunks));res.end();}else{res.end(await readFile(filePath(key)));}}catch{res.writeHead(404);res.end();}});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address()as any).port}`;
 await pool.query(`CREATE SCHEMA IF NOT EXISTS zenithjoy;CREATE TABLE IF NOT EXISTS zenithjoy.licenses(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),license_key text,status text);
 ALTER TABLE zenithjoy.licenses ADD COLUMN IF NOT EXISTS tenant_id uuid;ALTER TABLE zenithjoy.licenses ADD COLUMN IF NOT EXISTS expires_at timestamptz;
 CREATE TABLE zenithjoy.materials(id uuid PRIMARY KEY,tenant_id uuid,storage_key text,file_name text,mime_type text,size_bytes bigint,dedupe_key text UNIQUE,taken_at timestamptz,uploaded_by_license_id uuid,tag_status text DEFAULT 'pending',ai_tags jsonb,created_at timestamptz DEFAULT now());
 CREATE TABLE zenithjoy.contents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,title text,body text,type text,platforms text[],status text);
 CREATE TABLE zenithjoy.content_materials(content_id uuid,material_id uuid,sort_order int,PRIMARY KEY(content_id,material_id));`);
 for(let i=0;i<2;i++)await pool.query("INSERT INTO zenithjoy.licenses(license_key,status,tenant_id,expires_at)VALUES($1,'active',$2,now()+interval '1 day')",['material-'+i,tenants[i]]);
});
afterAll(async()=>{await pool.end();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});});
const token=(i:number)=>'material-'+i;const upload=(i:number,name='a.jpg')=>request(app).post('/api/materials/upload').set('X-Upload-Token',token(i)).field('tenant_id',tenants[1-i]).attach('files',Buffer.from('actual-image-bytes'),name);
describe('material multipart/direct/delete through actual SQL, HTTP and temporary files',()=>{
 it('ignores self-reported tenant, dedupes only inside the owning tenant and reads back exact bytes',async()=>{
  const a=await upload(0),again=await upload(0),b=await upload(1);
  expect(a.status).toBe(200);expect(again.body.data.materials[0]).toMatchObject({id:a.body.data.materials[0].id,deduped:true});expect(b.status).toBe(200);expect(b.body.data.materials[0].id).not.toBe(a.body.data.materials[0].id);
  const rows=(await pool.query('SELECT * FROM zenithjoy.materials ORDER BY created_at')).rows;expect(rows.map(r=>r.tenant_id)).toEqual(tenants);
  expect(await(await fetch(await storage.getSignedUrl(rows[0].storage_key))).text()).toBe('actual-image-bytes');
  const list=await request(app).get('/api/materials').set('X-Upload-Token',token(0));expect(list.body.data.items.map((m:any)=>m.id)).toEqual([a.body.data.materials[0].id]);
 });
 it('requires actual valid credentials and rejects empty/mixed input',async()=>{
  expect((await request(app).post('/api/materials/upload').attach('files',Buffer.from('x'),'a.jpg')).status).toBe(401);
  expect((await request(app).post('/api/materials/upload').set('X-Upload-Token','invalid').attach('files',Buffer.from('x'),'a.jpg')).status).toBe(401);
  expect((await request(app).post('/api/materials/upload').set('X-Upload-Token',token(0))).status).toBe(400);
  expect((await request(app).post('/api/materials/upload').set('X-Upload-Token',token(0)).attach('files',Buffer.from('x'),'a.jpg').attach('files',Buffer.from('x'),'v.mp4')).status).toBe(400);
 });
 it('executes presign → PUT bytes → HEAD verification → complete; mismatched size is rejected',async()=>{
  const intent=await request(app).post('/api/materials/upload-urls').set('X-Upload-Token',token(0)).send({files:[{file_name:'direct.jpg',mime_type:'image/jpeg',size_bytes:6}]});expect(intent.status).toBe(200);
  const f=intent.body.data.files[0];expect((await fetch(f.upload_url,{method:'PUT',body:'direct'})).status).toBe(200);
  const item={...f,mime_type:'image/jpeg',size_bytes:7};
  expect((await request(app).post('/api/materials/complete').set('X-Upload-Token',token(0)).send({files:[item]})).status).toBe(400);
  item.size_bytes=6;expect((await request(app).post('/api/materials/complete').set('X-Upload-Token',token(1)).send({files:[item]})).status).toBe(403);
  const completed=await request(app).post('/api/materials/complete').set('X-Upload-Token',token(0)).send({files:[item]});expect(completed.status).toBe(200);expect(completed.body.data.materials[0].id).toBe(f.material_id);
 });
 it('cross-tenant delete preserves bytes/row; published linkage blocks; successful deletion removes both',async()=>{
  const up=await upload(0,'delete.jpg');expect(up.status).toBe(200);const id=up.body.data.materials[0].id;
  const row=(await pool.query('SELECT * FROM zenithjoy.materials WHERE id=$1',[id])).rows[0];const url=await storage.getSignedUrl(row.storage_key);
  const del=(i:number)=>request(app).delete('/api/materials/'+id).set('X-Upload-Token',token(i));
  expect((await del(1)).status).toBe(404);expect((await fetch(url)).status).toBe(200);
  await pool.query("UPDATE zenithjoy.contents SET status='published' WHERE id=$1",[up.body.data.content_id]);expect((await del(0)).status).toBe(409);
  await pool.query("UPDATE zenithjoy.contents SET status='draft' WHERE id=$1",[up.body.data.content_id]);expect((await del(0)).status).toBe(200);
  expect((await fetch(url)).status).toBe(404);expect((await pool.query('SELECT id FROM zenithjoy.materials WHERE id=$1',[id])).rows).toEqual([]);expect((await del(0)).status).toBe(404);
 });
});
