import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from 'vitest';import request from 'supertest';import {createServer,type Server} from 'node:http';import {readFile} from 'node:fs/promises';import type {Express} from 'express';
vi.mock('../../../src/auth',()=>({auth:{api:{getSession:async()=>null}}}));
import pool from '../../../src/db/connection';
let provider:Server,app:Express,reply:any,status=200;const calls:any[]=[];
const tree=['d0 android.widget.FrameLayout id=- text="-" desc="-" bounds=[0,0][1080,2388]','d1 android.widget.EditText id=com.example:id/search text="-" desc="搜索输入框" bounds=[100,80][900,160]'].join('\n');
beforeAll(async()=>{
 if(!process.env.DATABASE_HOST?.startsWith('/tmp/zj-media-'))throw new Error('disposable PostgreSQL harness required');
 await pool.query('CREATE SCHEMA IF NOT EXISTS zenithjoy');
 for(const file of ['20260822_201800_rpa_locator_assist.sql','20260822_230500_locator_assist_mode.sql'])await pool.query(await readFile(new URL('../../../db/migrations/'+file,import.meta.url),'utf8'));
 provider=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;calls.push({body:JSON.parse(body),url:req.url,auth:req.headers.authorization});res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(reply));});await new Promise<void>(r=>provider.listen(0,'127.0.0.1',r));
 vi.stubEnv('TOAPIS_BASE_URL',`http://127.0.0.1:${(provider.address()as any).port}/v1`);vi.stubEnv('TOAPIS_API_KEY','fixture-not-real-provider-key');
 app=(await import('../../../src/app')).default;
});
beforeEach(()=>{status=200;calls.length=0;reply={choices:[{message:{content:'{"line":1}'},finish_reason:'stop'}]};});
afterAll(async()=>{vi.unstubAllEnvs();await pool.end();await new Promise<void>(r=>provider.close(()=>r()));});
const assist=(over:Record<string,unknown>={})=>request(app).post('/api/agent/burner/locator-assist').send({agent_id:'isolated-locator-fixture',step:'fixture-search',target_desc:'搜索输入框',ui_tree_snapshot:tree,device_model:'fixture-unique-model',os_version:'fixture-OS',douyin_version:'fixture-version',...over}).timeout({response:3000,deadline:5000});
describe('actual mounted locator router/service with real migrations, SQL and loopback provider',()=>{
 it('locates from actual provider body, caches a visit, verifies false and refuses that cached answer next time',async()=>{
  const first=await assist();expect(first.status).toBe(200);expect(first.body.data).toMatchObject({status:'ok',cache_hit:false,candidates:[{line:1,view_id:'com.example:id/search'}]});const id=first.body.data.assist_id;expect(id).toMatch(/^[0-9a-f-]{36}$/);expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({url:'/v1/chat/completions',body:{temperature:0,enable_thinking:false}});
  const second=await assist();expect(second.body.data.cache_hit).toBe(true);expect(calls).toHaveLength(1);expect((await pool.query('SELECT cache_hit,model FROM zenithjoy.rpa_locator_assist WHERE id=$1',[id])).rows[0]).toMatchObject({cache_hit:false,model:expect.any(String)});
  const verification=await request(app).post('/api/agent/burner/locator-assist/verify').send({assist_id:id,verified:false});expect(verification.status).toBe(200);expect(verification.body.data.updated).toBe(true);expect((await pool.query('SELECT verified FROM zenithjoy.rpa_locator_assist WHERE id=$1',[id])).rows[0].verified).toBe(false);
  const third=await assist();expect(third.body.data.cache_hit).toBe(false);expect(calls).toHaveLength(2);
  expect((await request(app).post('/api/agent/burner/locator-assist/verify').send({assist_id:third.body.data.assist_id,verified:true})).body.data.updated).toBe(true);expect((await pool.query('SELECT verified FROM zenithjoy.rpa_locator_assist WHERE id=$1',[third.body.data.assist_id])).rows[0].verified).toBe(true);expect((await assist()).body.data.cache_hit).toBe(true);expect(calls).toHaveLength(2);
 });
 it('extract and extract_list persist actual modes and values without consulting the locate cache',async()=>{
  reply={choices:[{message:{content:'{"extracted":"fixture-user-88"}'},finish_reason:'stop'}]};const extracted=await assist({mode:'extract'});expect(extracted.body.data).toMatchObject({status:'ok',extracted_value:'fixture-user-88',cache_hit:false});
  reply={choices:[{message:{content:'{"values":["fixture-account-a","fixture-account-b"]}'},finish_reason:'stop'}]};const list=await assist({mode:'extract_list'});expect(list.body.data.extracted_values).toEqual(['fixture-account-a','fixture-account-b']);expect(calls).toHaveLength(2);
  const modes=(await pool.query('SELECT mode FROM zenithjoy.rpa_locator_assist WHERE id=ANY($1::uuid[])',[[extracted.body.data.assist_id,list.body.data.assist_id]])).rows.map(r=>r.mode).sort();expect(modes).toEqual(['extract','extract_list']);
 });
 it.each([{label:'truncated',content:'{"line":1}',finish_reason:'length',reason:'truncated_output'},{label:'out-of-bounds',content:'{"line":9999}',finish_reason:'stop',reason:'unparseable_answer'},{label:'invalid JSON',content:'bad output',finish_reason:'stop',reason:'unparseable_answer'}])('rejects $label provider output through actual API',async({label,content,finish_reason,reason})=>{
  reply={choices:[{message:{content},finish_reason}]};const result=await assist({step:'negative-'+label});expect(result.status).toBe(200);expect(result.body.data).toEqual({status:'unavailable',reason});expect(calls).toHaveLength(1);
 });
 it('exposes exhausted HTTP 503 models as unavailable and records the failed visit',async()=>{
  status=503;reply={error:{message:'isolated unavailable'}};const result=await assist({step:'provider-unavailable'});expect(result.status).toBe(200);expect(result.body.data).toEqual({status:'unavailable',reason:'llm_error'});expect(calls).toHaveLength(2);expect((await pool.query("SELECT answer_selector FROM zenithjoy.rpa_locator_assist WHERE step='provider-unavailable'")).rows).toEqual([{answer_selector:null}]);
 });
 it('the actual router truncates oversized client tree before provider transport and persisted visit',async()=>{
  const result=await assist({step:'large-tree',ui_tree_snapshot:tree+'\n'+'x'.repeat(66000)});expect(result.status).toBe(200);expect(result.body.data.status).toBe('ok');
  expect((await pool.query('SELECT length(ui_tree_snapshot) AS length FROM zenithjoy.rpa_locator_assist WHERE id=$1',[result.body.data.assist_id])).rows[0].length).toBe(65536);expect(calls).toHaveLength(1);expect(calls[0].body.messages[0].content.length).toBeLessThan(67000);
 });
 it('vision_select sends actual frame data, protects index bounds, and retains honest no-match -1',async()=>{
  const input={mode:'vision_select',ui_tree_snapshot:'',screenshot_b64:'ZmFrZQ==',vision_candidate_count:2};
  reply={choices:[{message:{content:'{"match_index":1}'},finish_reason:'stop'}]};expect((await assist(input)).body.data.match_index).toBe(1);expect(calls[0].body.messages[0].content[1]).toEqual({type:'image_url',image_url:{url:'data:image/jpeg;base64,ZmFrZQ=='}});
  reply={choices:[{message:{content:'{"match_index":99}'},finish_reason:'stop'}]};expect((await assist(input)).body.data).toEqual({status:'unavailable',reason:'index_out_of_bounds'});
  reply={choices:[{message:{content:'{"match_index":-1}'},finish_reason:'stop'}]};expect((await assist(input)).body.data.match_index).toBe(-1);
 });
 it('invalid verify inputs and missing tree/screenshot fail with explicit current responses',async()=>{
  expect((await request(app).post('/api/agent/burner/locator-assist/verify').send({assist_id:'x'})).status).toBe(400);expect((await assist({ui_tree_snapshot:''})).status).toBe(400);expect((await assist({mode:'vision_select',screenshot_b64:'',ui_tree_snapshot:''})).body.data).toEqual({status:'unavailable',reason:'no_screenshot'});expect(calls).toEqual([]);
 });
});
