#!/usr/bin/env python3
"""将授权组织的现有 materials 只读投影到 Notion；不上传、不发布、不改业务库。"""
import argparse,json,os,pathlib,subprocess,urllib.request,urllib.parse,uuid,datetime,fcntl
BRAIN='http://localhost:5221/api/brain';KEY='materials_notion_projection_v1'
def brain(method,value=None):
 req=urllib.request.Request(BRAIN+'/kv/'+KEY,data=json.dumps(value,ensure_ascii=False).encode() if value is not None else None,headers={'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(req,timeout=20) as r:return json.load(r)
def item_value(file,label):
 d=json.loads((pathlib.Path.home()/'.credentials'/file).read_text());return next(f['value'] for f in d['fields'] if f.get('label')==label and f.get('value'))
def notion(method,path,value=None):
 t=item_value('notion-materials.json','credential');req=urllib.request.Request('https://api.notion.com/v1/'+path,data=json.dumps(value,ensure_ascii=False).encode() if value is not None else None,headers={'Content-Type':'application/json','Authorization':'Bearer '+t,'Notion-Version':'2022-06-28'},method=method)
 with urllib.request.urlopen(req,timeout=25) as r:return json.load(r)
def sql_read(sql,database=None):
 u=urllib.parse.urlparse(item_value('zenithjoy-hk-db.json','DATABASE_URL'));env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port or 5432),'PGUSER':urllib.parse.unquote(u.username or ''),'PGPASSWORD':urllib.parse.unquote(u.password or ''),'PGDATABASE':database or u.path.lstrip('/'),'PGCONNECT_TIMEOUT':'8','PGOPTIONS':'-c default_transaction_read_only=on -c statement_timeout=15000'}
 r=subprocess.run(['psql','-X','-A','-t','-v','ON_ERROR_STOP=1'],input=sql,text=True,capture_output=True,env=env,timeout=25)
 if r.returncode:raise RuntimeError('业务数据库只读核验失败；未写Notion')
 return json.loads(r.stdout.strip())
def rt(value):return {'rich_text':[] if value is None else [{'text':{'content':str(value)[:1900]}}]}
def material_kind(mime):
 head=(mime or '').split('/',1)[0];return {'image':'图片','video':'视频','audio':'音频'}.get(head)
def validate_scope(rows,tenants):
 seen=set()
 for r in rows:
  if r['tenant_id'] not in tenants:raise ValueError('拒绝跨组织素材')
  uuid.UUID(r['id']);key=(r['tenant_id'],r['id'])
  if key in seen:raise ValueError('重复素材身份')
  seen.add(key)
def run():
 cfg=brain('GET')['value'];assert cfg['mode']=='internal_admin_projection';assert cfg['source_table']=='zenithjoy.materials'
 sources=cfg.get('sources') or [{'database':cfg['source_database'],'tenant_bindings':cfg['tenant_bindings']}];scope={};rows=[]
 for source in sources:
  dbname=source['database'];assert dbname in ('zenithjoy','zenithjoy_staging')
  tenants=source['tenant_bindings']
  for t in tenants:uuid.UUID(t)
  ids=','.join("'"+t+"'" for t in tenants)
  names=sql_read('SELECT COALESCE(json_agg(t),\'[]\'::json) FROM (SELECT id::text,name FROM zenithjoy.tenants WHERE id IN ('+ids+')) t;',dbname)
  if {x['id']:x['name'] for x in names}!=tenants:raise ValueError('组织ID与名称绑定发生变化，停止')
  batch=sql_read("SELECT COALESCE(json_agg(t),'[]'::json) FROM (SELECT m.id::text,m.tenant_id,m.file_name,m.mime_type,m.storage_key,m.size_bytes,m.duration_ms,m.width,m.height,m.content_hash,m.created_at,m.uploaded_by_license_id::text,m.tag_status,m.ai_tags,m.ai_description,(SELECT count(*) FROM zenithjoy.content_materials cm WHERE cm.material_id=m.id) AS refs,(SELECT l.customer_id FROM zenithjoy.licenses l WHERE l.id=m.uploaded_by_license_id AND l.tenant_id::text=m.tenant_id AND EXISTS(SELECT 1 FROM zenithjoy.tenant_members tm WHERE tm.tenant_id=l.tenant_id AND tm.feishu_user_id=l.customer_id)) AS uploaded_by_user_id FROM zenithjoy.materials m WHERE tenant_id IN ("+ids+") ORDER BY tenant_id,id) t;",dbname)
  validate_scope(batch,tenants)
  for tid,name in tenants.items():scope[(dbname,tid)]=name
  for row in batch:row['source_database']=dbname
  rows.extend(batch)
 db=notion('GET','databases/'+cfg['database_id']);assert set(cfg['required_fields']).issubset(db['properties'])
 existing={};cursor=None;unmanaged=0
 while True:
  body={'page_size':100}
  if cursor:body['start_cursor']=cursor
  d=notion('POST','databases/'+cfg['database_id']+'/query',body)
  for page in d['results']:
   props=page['properties'];mid=''.join(x.get('plain_text','') for x in props['素材ID']['rich_text']);tid=''.join(x.get('plain_text','') for x in props['组织ID']['rich_text']);dbname=(props['来源数据库'].get('select') or {}).get('name')
   if not mid:
    unmanaged+=1;continue
   if (dbname,tid) not in scope:raise ValueError('发现未授权来源组织，停止')
   key=(dbname,tid,mid)
   if key in existing:raise ValueError('投影重复，停止')
   existing[key]=page
  if not d.get('has_more'):break
  cursor=d['next_cursor']
 stat={'source_rows':len(rows),'created':0,'updated':0,'source_missing':0,'unsupported_type':0,'schema_verified':True,'org_bindings_verified':True,'source_writes':0,'public_sharing_configured':False,'unmanaged_rows_preserved':unmanaged}
 for row in rows:
  kind=material_kind(row['mime_type']);props={'素材标题':{'title':[{'text':{'content':row['file_name'][:1900]}}]},'素材ID':rt(row['id']),'组织ID':rt(row['tenant_id']),'所属组织':{'select':{'name':scope[(row['source_database'],row['tenant_id'])]}},'素材类型':{'select':{'name':kind}} if kind else {'select':None},'存储标识':rt(row['storage_key']),'文件大小（字节）':{'number':int(row['size_bytes'])},'文件摘要':rt(row['content_hash']),'上传凭据ID':rt(row['uploaded_by_license_id']),'员工用户ID':rt(row.get('uploaded_by_user_id')),'来源数据库':{'select':{'name':row['source_database']}},'同步键':rt(row['source_database']+':'+row['tenant_id']+':'+row['id']),'登记状态':{'select':{'name':'已登记' if kind else '待核验类型'}},'内容说明':rt(row['ai_description']),'内容标签':{'multi_select':[{'name':str(x).replace(',', ' ').strip()[:100]} for x in (row.get('ai_tags') or []) if str(x).strip()]},'识别状态':{'select':{'name':{'tagged':'已识别','pending':'待识别','failed_pending_review':'识别失败'}.get(row.get('tag_status'),'待识别')}},'时长（秒）':{'number':row['duration_ms']/1000 if row.get('duration_ms') is not None else None},'画面尺寸':rt(str(row['width'])+' × '+str(row['height']) if row.get('width') and row.get('height') else None),'被引用次数':{'number':int(row['refs'])},'来源创建时间':{'date':{'start':row['created_at']}},'最后同步':{'date':{'start':datetime.datetime.now(datetime.timezone.utc).isoformat()}}}
  stat['unsupported_type']+=int(kind is None);page=existing.pop((row['source_database'],row['tenant_id'],row['id']),None)
  if page:notion('PATCH','pages/'+page['id'],{'properties':props});stat['updated']+=1
  else:notion('POST','pages',{'parent':{'database_id':cfg['database_id']},'properties':props});stat['created']+=1
 for page in existing.values():notion('PATCH','pages/'+page['id'],{'properties':{'登记状态':{'select':{'name':'源记录缺失'}}}});stat['source_missing']+=1
 return stat
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--output',type=pathlib.Path,required=True);a=p.parse_args();a.output.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(a.output.parent/'projection.lock','a') as f:
  fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB);result=run();a.output.write_text(json.dumps(result,ensure_ascii=False,indent=2));a.output.chmod(0o600);print(json.dumps(result,ensure_ascii=False))
