#!/usr/bin/env python3
"""只读实际发布skill及xian控制器；原安装revision与最终源码等价分别记录。"""
import hashlib,json,re,shlex,subprocess
from pathlib import Path

ATTACHMENTS = (
 '.agents/skills/multi-platform-publish/SKILL.md',
 '.agents/skills/multi-platform-publish/scripts/publish_catalog.py',
 '.agents/skills/multi-platform-publish/scripts/test_publish_catalog.py',
 '.github/workflows/scripts/smoke/codex-publish-catalog-smoke.sh',
 'services/phone-adb-controller/__tests__/media-push-text-input.test.mjs',
 'services/phone-adb-controller/__tests__/text-input-focus.test.mjs',
)
CONTROLLERS = ('services/phone-adb-controller/douyin-phone-adb','services/phone-adb-controller/text-input-focus.py')
REMOTE = r'''
import json,hashlib,socket
from pathlib import Path
home=Path.home();root=home/'bin-harvest';p=root/'deployment-manifest.json';raw=p.read_bytes();m=json.loads(raw)
if socket.gethostname().split('.')[0]!='mac-mini-m4-xian':raise ValueError('错误xian hostname')
rows=[]
for f in m['files']:
 relative=Path(f['deployed_path'])
 if relative.is_absolute() or '..' in relative.parts:raise ValueError('manifest路径越界')
 path=root/relative
 if path.is_symlink():raise ValueError('runtime文件不应是链接')
 h=hashlib.sha256(path.read_bytes()).hexdigest()
 if h!=f['content_sha256']:raise ValueError('现有xian正式manifest漂移: '+f['path'])
 rows.append(dict(f,actual_path=str(path),actual_sha256=h))
pairs=[]
for name in ('douyin-phone-adb','text-input-focus.py'):
 for folder in ('bin-harvest','.local/bin'):
  f=home/folder/name
  if f.is_symlink():raise ValueError('controller执行路径不应是链接')
  pairs.append(dict(path=str(f),repo_path='services/phone-adb-controller/'+name,sha256=hashlib.sha256(f.read_bytes()).hexdigest()))
if p.read_bytes()!=raw:raise ValueError('采集期间xian manifest切换')
print(json.dumps(dict(hostname=socket.gethostname(),manifest=m,manifest_sha256=hashlib.sha256(raw).hexdigest(),installed_files=rows,execution_copies=pairs)))
'''

def collect_publish(home, entries, read_regular):
 info=json.loads(subprocess.check_output(['openclaw','skills','--agent','skill-factory','--json','info','multi-platform-publish'],timeout=30))
 if info.get('source')!='openclaw-managed' or not info.get('eligible') or not info.get('modelVisible') or info.get('blockedByAgentFilter'):
  raise ValueError('正式skill-factory未加载发布skill')
 root=Path(info['baseDir']);suffix=Path('.agents/skills/multi-platform-publish');package=root.parents[2]
 if root!=package/suffix or package.parent!=home/'.local/share/zenithjoy/publish-releases' or not re.fullmatch('[0-9a-f]{40}',package.name):raise ValueError('managed发布安装根不合法')
 if Path(info['filePath'])!=root/'SKILL.md' or (home/'.openclaw/skills/multi-platform-publish').resolve()!=root:raise ValueError('实际managed链接与官方加载路径不同')
 # 允许managed入口链接；落点与附件每段必须是真实普通文件，不能链接回checkout。
 current=home
 for part in package.relative_to(home).parts:
  current=current/part
  if current.is_symlink():raise ValueError('发布安装包落点不能经软链接')
 remote=json.loads(subprocess.check_output(['ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','xian-m4','python3 -c '+shlex.quote(REMOTE)],timeout=30))
 measured={};locations={}
 for entry in entries:
  path=entry['path'];expected=entry['content_sha256']
  if path in ATTACHMENTS:
   actual=hashlib.sha256(read_regular(package,path)).hexdigest()
   locations[path]=dict(kind='loaded_skill' if path.startswith('.agents/') else 'installed_verification_source',host='mmv',actual_path=str(package/path),installed_revision=package.name)
  elif path in CONTROLLERS:
   copies=[x for x in remote['execution_copies'] if x['repo_path']==path]
   if len(copies)!=2 or any(x['sha256']!=expected for x in copies):raise ValueError('两处真实controller执行字节与final binding不符: '+path)
   actual=copies[0]['sha256'];locations[path]=dict(kind='execution_copies',host='xian-m4',copies=copies,installed_revision=remote['manifest']['source_commit'])
  else:raise ValueError('未知发布binding路径')
  if actual!=expected:raise ValueError('发布安装文件与final binding不符: '+path)
  measured[path]=actual
  locations[path]['source_equivalence']=dict(expected_final_sha256=expected,actual_sha256=actual,matched=True)
 return dict(files=measured,locations=locations,official_skill_info=info,installed_package_revision=package.name,xian_readback=remote)

import socket,sys

def read_regular(root, relative):
    parts = Path(relative).parts
    if not parts or Path(relative).is_absolute() or any(p in ('.', '..') for p in parts):
        raise ValueError('非法安装路径')
    current = root
    if current.is_symlink():
        raise ValueError('安装目录不能是软链接')
    for part in parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('安装证据不能经软链接')
    if not current.is_file():
        raise ValueError('缺少已安装文件: ' + relative)
    return current.read_bytes()



def collect(spec, home):
 if socket.gethostname().split('.')[0] not in ('aad17-2','r10-7'):raise ValueError('实际机器不是MMV')
 runtime=home/'.openclaw/commander';workspace=home/'openclaw-root/workspaces-root/clawd-work-commander'
 original=read_regular(runtime,'runtime-manifest.json');installed=json.loads(original)
 if installed.get('protocol')!='commander-v2' or installed.get('files')!=spec['commander_files'] or installed.get('releases')!=spec['commander_releases']:raise ValueError('Commander安装manifest与完整release不同')
 measured={};locations={};official={}
 for entry in spec['local_manifest']['files']:
  path=entry['path'];values=[]
  for folder in ('bin-harvest','.openclaw/leadgen-scripts'):
   actual=hashlib.sha256(read_regular(home/folder,entry['deployed_path'])).hexdigest()
   if actual!=entry['content_sha256']:raise ValueError('MMV本机执行包漂移: '+path)
   values.append(dict(path=str(home/folder/entry['deployed_path']),sha256=actual))
  measured[path]=actual;locations[path]=dict(kind='local_execution_copies',host='mmv',copies=values)
 for name,expected in spec['commander_files'].items():
  actual=hashlib.sha256(read_regular(runtime,name)).hexdigest()
  if actual!=expected:raise ValueError('Commander实际文件漂移: '+name)
  path='services/phone-adb-controller/commander/'+name;measured[path]=actual;locations[path]=dict(kind='commander_runtime',host='mmv',path=str(runtime/name))
  if name=='AGENTS.md' or name.startswith('skills/'):
   if hashlib.sha256(read_regular(workspace,name)).hexdigest()!=expected:raise ValueError('Commander工作区实际字节漂移')
  if name.startswith('skills/') and name.endswith('/SKILL.md'):
   key=name.split('/')[1];info=json.loads(subprocess.check_output(['openclaw','skills','--agent','work-commander','--json','info',key],timeout=30))
   if info.get('source')!='openclaw-workspace' or info.get('filePath')!=str(workspace/name) or not info.get('eligible') or not info.get('modelVisible') or info.get('blockedByAgentFilter'):raise ValueError('Commander官方实际skill来源不符')
   official[key]=info
 canonical=json.dumps(spec['commander_files'],sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()
 if installed.get('runtime_snapshot_sha256')!=hashlib.sha256(canonical).hexdigest():raise ValueError('Commander runtime snapshot漂移')
 extra=[entry for entry in spec['manifest']['files'] if entry['path'] in ATTACHMENTS+CONTROLLERS]
 publishing=collect_publish(home,extra,read_regular)
 for path,value in publishing['files'].items():
  if path in measured and measured[path]!=value:raise ValueError('跨主机同component执行字节不同')
  measured[path]=value;locations[path]=dict(publishing['locations'][path],local_copies=locations.get(path))
 xian=publishing['xian_readback']['manifest'];ack=spec['xian_ack']
 if any(xian.get(k)!=ack.get(k) for k in ('release_id','observation_id','source_repo','source_commit','target','environment')):raise ValueError('手机正式ACK与实际manifest不一致')
 files=[]
 for entry in spec['manifest']['files']:
  if measured.get(entry['path'])!=entry['content_sha256']:raise ValueError('完整release缺实机component: '+entry['path'])
  files.append(dict(entry))
 if read_regular(runtime,'runtime-manifest.json')!=original:raise ValueError('采集期间Commander安装变化')
 return dict(source_repo=spec['manifest']['source_repo'],source_commit=spec['manifest']['source_commit'],files=files,observed_hostname=socket.gethostname(),locations=locations,publish_readback=publishing,official_work_commander_skills=official,installed_runtime_manifest_sha256=hashlib.sha256(original).hexdigest())

if __name__=='__main__':
 try:print(json.dumps(collect(json.load(sys.stdin),Path.home()),ensure_ascii=False))
 except (OSError,ValueError,KeyError,subprocess.SubprocessError) as error:print(str(error),file=sys.stderr);sys.exit(1)
