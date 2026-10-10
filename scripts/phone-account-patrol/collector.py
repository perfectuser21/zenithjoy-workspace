import subprocess,sys,time,json,re,datetime,xml.etree.ElementTree as E
from pathlib import Path
PACKAGES={'抖音':'com.ss.android.ugc.aweme','小红书':'com.xingin.xhs','微信':'com.tencent.mm','快手':'com.smile.gifmaker','今日头条':'com.ss.android.article.news','知乎':'com.zhihu.android','微博':'com.sina.weibo','B站':'tv.danmaku.bili'}
ADB='/opt/homebrew/bin/adb'; BASE=Path.home()/'.local/share/phone-account-patrol'
def is_home_foreground(focus):
 # 只检查组件的包名；微信LauncherUI不是桌面，不能按组件含Launcher判空闲。
 packages=re.findall(r'\b([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+)/',focus)
 return bool(packages) and all('.launcher' in package.lower() or package=='com.miui.home' for package in packages)
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def classify(platform,nodes,ocr,own):
 labels=[n.get('text','') or n.get('content-desc','') for n in nodes]+[o['text'] for o in ocr]
 joined='\n'.join(labels)
 if any(x in joined for x in ['同意并继续','不同意','请充分阅读并理解']):return {'state':'待确认','reason':'首次使用协议阻挡，未同意协议'}
 # A login entry can exist on a logged-in profile; positive own identity has priority.
 fields={'今日头条':[':id/hqt'],'知乎':[':id/tv_name'],'B站':[':id/nick_name'],'抖音':[':id/tqn',':id/tj1',':id/tk+',':id/ttw']}
 if own:
  if platform=='微信' and any(x in joined for x in ['个人信息','个人资料']):
   name_labels=[o for o in ocr if o['text']=='名字']
   if name_labels:
    y=name_labels[0]['box'][1];values=[o for o in ocr if abs(o['box'][1]-y)<.02 and o['box'][0]>.3 and o['confidence']>=.5 and o['text'] not in ['>','名字']]
    if len(values)==1:return {'state':'已登录','nickname':values[0]['text'].rstrip('>〉＞ '),'nickname_trusted':True,'reason':'本人个人信息页显示完整名字；账号ID沿用上次确认值'}
  for suffix in fields.get(platform,[]):
   hits=[n.get('text','').strip() for n in nodes if n.get('resource-id','').endswith(suffix) and n.get('text','').strip()]
   if len(set(hits))==1:
    result={'state':'已登录','nickname':hits[0],'nickname_trusted':True,'reason':'已进入本人主页，读取账号名称字段'}
    if platform=='抖音':
     m=re.search(r'抖音号[：:]?\s*([A-Za-z0-9_\-]+)','\n'.join(n.get('text','') for n in nodes))
     if m:result.update(account_id=m.group(1),account_id_trusted=True)
    return result
  patterns={'微信':r'微信号[：:]?\s*([A-Za-z0-9_\-]+)','小红书':r'小红书号[：:]?\s*([A-Za-z0-9_\-]+)','抖音':r'抖音号[：:]?\s*([A-Za-z0-9_\-]+)','快手':r'快手号[：:]?\s*([A-Za-z0-9_\-]+)'}
  xml_labels='\n'.join(n.get('text','') or n.get('content-desc','') for n in nodes)
  xml_match=re.search(patterns.get(platform,r'(?!)'),xml_labels)
  match=xml_match or re.search(patterns.get(platform,r'(?!)'),joined)
  if match:
   # Identity IDs are stronger than a nickname inferred from visual position.
   ident=match.group(1)
   before=[o for o in ocr if o['box'][1]<.4 and o['confidence']>=.5 and o['text'] not in ['我','我的','个人信息','编辑资料'] and not re.search(r'号|粉丝|关注|获赞|VIP|会员|设置|状态|二维码|服务|钱包|收藏',o['text'])]
   name=None
   return {'state':'已登录','nickname':name,'account_id':ident,'account_id_trusted':bool(xml_match),'reason':'本人账号页显示账号ID；昵称须与核验记录匹配'}
  if platform=='微博':
   # Own page has a biography header; recommended authors are lower in the page.
   biography=[o for o in ocr if o['text'].startswith('简介') and .12<o['box'][1]<.19]
   header=[o for o in ocr if .085<o['box'][1]<.13 and .20<o['box'][0]<.5 and o['confidence']>=.5 and o['box'][2]>.12]
   if biography and len(header)==1:return {'state':'已登录','nickname':header[0]['text'],'nickname_trusted':True,'reason':'本人页顶部昵称及简介，已排除下方推荐博主'}

   # Only a semantic nickname field on own page is accepted, never feed authors.
   names=[n.get('text','').strip() for n in nodes if re.search(r':id/(nick|name|screen_name|tv_nick|tv_name)$',n.get('resource-id','')) and n.get('text','').strip()]
   if len(set(names))==1 and ('粉丝' in joined or '编辑' in joined):return {'state':'已登录','nickname':names[0],'nickname_trusted':True,'reason':'本人页账号字段'}
 if any(x in joined for x in ['登录/注册','登录或注册','登录后','登录快手','欢迎来到微信','手机号登录','立即登录','点击登录','注册/登录']) and ('退出登录' not in joined):
  if own or ('欢迎来到微信' in joined) or ('登录快手' in joined):return {'state':'未登录','reason':'本人入口或应用登录页显示登录提示'}
 if platform=='微信' and '请填写微信密码' in joined and '登录' in labels:return {'state':'未登录','reason':'微信密码登录页，未输入或提交'}
 if platform=='今日头条' and any(o['text']=='未登录' and o['box'][1]>.85 for o in ocr):return {'state':'未登录','reason':'底部本人入口明确显示未登录'}
 return {'state':'待确认','reason':'未取得可确定本人身份的账号字段'}
class Probe:
 def __init__(self,serial,runid):
  self.serial=serial;self.root=BASE/'evidence'/runid/serial;self.root.mkdir(parents=True,exist_ok=True)
 def adb(self,*args):
  p=subprocess.run([ADB,'-s',self.serial,*args],capture_output=True,timeout=25)
  if p.returncode:raise RuntimeError(p.stderr.decode(errors='replace')[:160])
  return p.stdout
 def capture(self,p,stage):
  from PIL import Image
  stem=self.root/(p+'-'+stage)
  self.adb('shell','rm','-f','/sdcard/account-patrol.xml')
  try:self.adb('shell','uiautomator','dump','/sdcard/account-patrol.xml');raw=self.adb('exec-out','cat','/sdcard/account-patrol.xml')
  except Exception:raw=b''
  stem.with_suffix('.xml').write_bytes(raw)
  try:nodes=[dict(n.attrib) for n in E.fromstring(raw).iter('node')]
  except Exception:nodes=[]
  png=stem.with_suffix('.png');png.write_bytes(self.adb('exec-out','screencap','-p'))
  self.size=Image.open(png).size
  try:ocr=json.loads(subprocess.run([str(BASE/'ocr'),str(png)],capture_output=True,text=True,timeout=20).stdout)
  except Exception:ocr=[]
  stem.with_suffix('.json').write_text(json.dumps({'nodes':nodes,'ocr':ocr},ensure_ascii=False))
  return nodes,ocr,str(png)
 def tap(self,x,y):self.adb('shell','input','tap',str(round(x)),str(round(y)));time.sleep(2)
 def findtap(self,nodes,ocr,words,bottom=False):
  for n in nodes:
   if (n.get('text') in words or n.get('content-desc','').split(',')[0].split('，')[0] in words) and n.get('bounds'):
    b=list(map(int,re.findall(r'\d+',n['bounds'])));x=(b[0]+b[2])/2;y=(b[1]+b[3])/2
    if bottom and y<self.size[1]*.75:continue
    self.tap(x,y);return True
  for o in ocr:
   if o['text'].strip() in words and o['confidence']>=.5:
    x,y,w,h=o['box']
    if bottom and y<.75:continue
    self.tap((x+w/2)*self.size[0],(y+h/2)*self.size[1]);return True
  return False
 def inspect(self,platform):
  package=PACKAGES[platform];at=stamp()
  package_query=subprocess.run([ADB,'-s',self.serial,'shell','pm','path',package],capture_output=True,timeout=25)
  if package_query.returncode and any(x in package_query.stderr.lower() for x in [b'offline',b'not found',b'closed']):raise RuntimeError('ADB设备离线或不可达')
  if not package_query.stdout.strip():return {'state':'未安装','installed':False,'checked_at':at,'reason':'ADB包管理器无此应用包','evidence':package}
  self.adb('shell','input','keyevent','224');self.adb('shell','input','keyevent','3')
  # Reset only this app's transient UI under its exclusive device lock; no account data cleared.
  self.adb('shell','am','force-stop',package)
  self.adb('shell','monkey','-p',package,'-c','android.intent.category.LAUNCHER','1');time.sleep(6)
  nodes,ocr,evidence=self.capture(platform,'launch')
  immediate=classify(platform,nodes,ocr,False)
  if immediate.get('reason','').startswith('首次'):return {**immediate,'installed':True,'checked_at':at,'evidence':evidence}
  if self.findtap(nodes,ocr,['跳过','跳过广告','跳过 1','跳过 2','跳过1','跳过2']):nodes,ocr,evidence=self.capture(platform,'skip')
  # Let launch ads expire once; don't click interests, permission/consent or unknown dialogs.
  own=self.findtap(nodes,ocr,['我','我的'],bottom=True)
  if not own:
   time.sleep(5);nodes,ocr,evidence=self.capture(platform,'wait')
   own=self.findtap(nodes,ocr,['我','我的'],bottom=True)
  if own:nodes,ocr,evidence=self.capture(platform,'own')
  if self.findtap(nodes,ocr,['暂不开启','暂不升级','以后再说']):nodes,ocr,evidence=self.capture(platform,'dismiss')
  joined='\n'.join(o['text'] for o in ocr)
  if '保存海报并分享' in joined and '恭喜' in joined:
   self.adb('shell','input','keyevent','4');time.sleep(2);nodes,ocr,evidence=self.capture(platform,'dismiss-poster')
  close=[n for n in nodes if n.get('resource-id')=='com.smile.gifmaker:id/close_btn']
  if close and '朋友推荐' in joined:
   b=list(map(int,re.findall(r'\d+',close[0]['bounds'])));self.tap((b[0]+b[2])/2,(b[1]+b[3])/2);nodes,ocr,evidence=self.capture(platform,'dismiss-recommend')
  provisional=classify(platform,nodes,ocr,own)
  if provisional['state']=='待确认' and not provisional['reason'].startswith('首次'):
   if self.findtap([],ocr,['我','我的'],bottom=True):
    own=True;nodes,ocr,evidence=self.capture(platform,'own-retry')
  if platform=='微信' and own and any('微信号' in o['text'] for o in ocr):
   names=[o for o in ocr if .08<o['box'][1]<.145 and .2<o['box'][0]<.5 and o['box'][2]>.06 and o['confidence']>=.5 and not re.search(r'微信号|状态',o['text'])]
   if len(names)==1:
    x,y,w,h=names[0]['box'];self.tap((x+w/2)*self.size[0],(y+h/2)*self.size[1]);nodes,ocr,evidence=self.capture(platform,'personal-info')
  result=classify(platform,nodes,ocr,own)
  return {**result,'installed':True,'own_page':own,'checked_at':stamp(),'evidence':evidence}
def video_identity(ocr):
 headers=[o for o in ocr if o['text']=='我的视频号' and o['confidence']>=.5]
 if not headers:return {'state':'待确认','reason':'尚未进入本人视频号中心'}
 y=headers[0]['box'][1]
 candidates=[o for o in ocr if y+.02<o['box'][1]<y+.09 and o['box'][0]>.15 and o['box'][2]>.12 and o['confidence']>=.5 and not re.search(r'关注|发表|创建|私信|消息|直播|收藏|看过',o['text'])]
 if len(candidates)==1:return {'state':'已登录','nickname':candidates[0]['text'],'nickname_trusted':True,'reason':'我的视频号中心显示本人名称'}
 return {'state':'待确认','reason':'我的视频号中心未显示可确定的本人名称'}
def inspect_video(probe,wechat):
 at=stamp()
 if wechat.get('state')=='未登录':return {'state':'待确认','installed':True,'reason':'微信未登录，无法核验视频号','checked_at':at,'evidence':wechat.get('evidence')}
 try:
  probe.adb('shell','am','force-stop',PACKAGES['微信']);probe.adb('shell','monkey','-p',PACKAGES['微信'],'-c','android.intent.category.LAUNCHER','1');time.sleep(4)
  nodes,ocr,evidence=probe.capture('视频号','wechat-home')
  if not probe.findtap(nodes,ocr,['发现'],bottom=True):return {'state':'待确认','installed':True,'reason':'微信发现入口不可用','checked_at':at,'evidence':evidence}
  nodes,ocr,evidence=probe.capture('视频号','discover')
  if not probe.findtap(nodes,ocr,['视频号']):return {'state':'待确认','installed':True,'reason':'发现页没有可识别的视频号入口','checked_at':at,'evidence':evidence}
  time.sleep(3);nodes,ocr,evidence=probe.capture('视频号','feed')
  # Validated video feed header, followed by the known personal-center icon in this UI.
  joined='\n'.join(o['text'] for o in ocr)
  if '未成年人模式' in joined and probe.findtap(nodes,ocr,['我知道了']):nodes,ocr,evidence=probe.capture('视频号','dismiss-information')
  header={o['text'] for o in ocr if o['box'][1]<.16}
  if not any(o['text'].startswith('推荐') and .55<o['box'][0]<.8 and .04<o['box'][1]<.12 for o in ocr):return {'state':'待确认','installed':True,'reason':'视频号界面结构改变，停止导航','checked_at':at,'evidence':evidence}
  probe.tap(probe.size[0]*.935,probe.size[1]*.071)
  nodes,ocr,evidence=probe.capture('视频号','own')
  return {**video_identity(ocr),'installed':True,'checked_at':stamp(),'evidence':evidence}
 except Exception as e:return {'state':'检测失败','reason':'视频号核验异常：'+str(e)[:120],'checked_at':stamp()}
def main():
 serial=sys.argv[1];runid=sys.argv[2];platforms=sys.argv[3:] or list(PACKAGES)
 probe=Probe(serial,runid);results={}
 # Physical users don't participate in the automation lock. Skip their active foreground session.
 focus=probe.adb('shell','dumpsys','window').decode(errors='replace')
 focus='\n'.join(l for l in focus.splitlines() if 'mCurrentFocus' in l)
 if not is_home_foreground(focus):
  state='占用未查' if focus else '检测失败'
  reason='前台已有应用或锁屏，本轮不接管人工使用' if focus else '未读取到前台窗口，不能判断是否空闲'
  print(json.dumps({'serial':serial,'results':{p:{'state':state,'checked_at':stamp(),'reason':reason} for p in platforms+['视频号']}},ensure_ascii=False));return
 for p in platforms:
  try:
   results[p]=inspect_video(probe,{}) if p=='视频号' else probe.inspect(p)
   if p=='微信':results['视频号']=inspect_video(probe,results[p])
  except Exception as e:results[p]={'state':'检测失败','checked_at':stamp(),'reason':str(e)[:200]}
 # 本轮取得原生锁后完成检查，回桌面，避免下一轮误判本脚本遗留应用为人工占用。
 probe.adb('shell','input','keyevent','3')
 print(json.dumps({'serial':serial,'results':results},ensure_ascii=False))
if __name__=='__main__':main()
