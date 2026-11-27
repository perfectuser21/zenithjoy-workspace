#!/usr/bin/env python3
"""内部只读素材投影定时入口；凭据来自1Password，每次运行登记Brain任务。"""
import datetime,json,os,pathlib,subprocess,urllib.request,sys
from project_materials import run,BRAIN,KEY
ROOT=pathlib.Path.home()/'.local/state/zenithjoy/materials/projection'
def api(path,method,data=None):
 q=urllib.request.Request(BRAIN+path,data=json.dumps(data,ensure_ascii=False).encode() if data is not None else None,headers={'Content-Type':'application/json'},method=method)
 with urllib.request.urlopen(q,timeout=20) as r:return json.load(r)
def refresh():
 env=dict(os.environ)
 for l in (pathlib.Path.home()/'.credentials/1password.env').read_text().splitlines():
  if '=' in l and not l.startswith('#'):
   k,v=l.split('=',1);env[k]=v.strip().strip('\"\'')
 for item,file in [('ZenithJoy HK Postgres','zenithjoy-hk-db.json'),('Notion','notion-materials.json')]:
  r=subprocess.run(['op','item','get',item,'--vault','CS','--format','json','--reveal'],capture_output=True,text=True,env=env,timeout=20)
  if r.returncode:raise RuntimeError('1Password凭据刷新失败')
  d=json.loads(r.stdout);p=pathlib.Path.home()/'.credentials'/file;p.write_text(json.dumps(d));p.chmod(0o600)
def main():
 import fcntl
 ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
 with open(ROOT/'job.lock','a') as f:
  try:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:print('{"status":"skipped_busy"}');return
  stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ');t=api('/tasks','POST',{'title':'组织素材库只读投影 '+stamp,'task_type':'research','priority':'P2','payload':{'actor':'materials-projection','scope':'内部管理员；业务源只读；仅投影登记组织；不上传不发布'}});tid=t.get('task',t)['id'];api('/tasks/'+tid,'PATCH',{'status':'in_progress'})
  try:
   refresh();stat=run();receipt={'status':'completed','actor':'materials-projection','task_id':tid,'fact':'已读回组织绑定、素材来源和Notion schema，并完成素材投影','statistics':stat,'evidence':str(ROOT/(stamp+'.json')),'handoff':{'next_steps':[]}};api('/tasks/'+tid,'PATCH',{'status':'completed','result':receipt})
  except Exception as e:
   receipt={'status':'failed','actor':'materials-projection','task_id':tid,'fact':'投影停止，不修改业务源或执行发布','error_type':type(e).__name__};api('/tasks/'+tid,'PATCH',{'status':'failed','result':receipt});raise RuntimeError('素材投影失败；见私有回执') from None
  finally:
   if 'receipt' in locals():
    for p in [ROOT/(stamp+'.json'),ROOT/'latest.json']:p.write_text(json.dumps(receipt,ensure_ascii=False,indent=2));p.chmod(0o600)
  print(json.dumps(receipt,ensure_ascii=False))
if __name__=='__main__':main()
