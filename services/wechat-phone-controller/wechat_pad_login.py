#!/usr/bin/env python3
"""Repeatable, navigation-only native WeChat QR entry. Never authenticates or changes app data."""
import argparse,contextlib,datetime,hashlib,importlib.util,json,os,pathlib,re,struct,subprocess,sys,time,urllib.request,uuid,zlib
SERIAL='47.100.213.173:10001'; INSTANCE='acp-f6utus34dgnghc1oc'
QR='com.tencent.mm.plugin.login_exdevice.ui.LoginAsExDeviceUI'
LOGGED_OUT=tuple('com.tencent.mm.plugin.account.ui.'+x for x in ('LoginPasswordUI','LoginUI','MobileInputUI','LoginSelectUI','WelcomeActivity'))
FLAG='RepairerConfig_AssistInTablet_Int'; INNER='RepairerConfig_Inner_Version_Int'
APK_SHA='f2a725bc04302ad218a563533ae79356e66b64aa711b275bc919a8d432f7e15d'
SDK_SHA='7ecd111359d824d000dc77ad25da83148b2afd79b10e32ede78cdc488f3754b2'
LIVE='/data/user/0/com.tencent.mm/files/mmkv/'
BINDING=pathlib.Path.home()/'.local/state/zenithjoy/deployments/contact-inventory-20261024/cloud-intake-binding.json'
SDK=pathlib.Path.home()/'.local/share/zenithjoy/contact-intake/phone-releases/2fa972c9110b1dd3d3904bbbfef6c31e093b7135/services/wechat-phone-controller/wechat_phone.py'
BASE='http://localhost:5221/api/brain/device-locks'
class Refused(RuntimeError):pass
def need(value,reason):
 if not value:raise Refused(reason)
def sha(b):return hashlib.sha256(b).hexdigest()
def read_flags(data,meta):
 need(len(data)>=4 and 112<=len(meta)<=1048576 and len(data)<=1048576,'pair_size')
 crc,version=struct.unpack_from('<II',meta);size=struct.unpack_from('<I',meta,28)[0];legacy=struct.unpack_from('<I',data)[0]
 need(version==5 and 0<size<=len(data)-4 and legacy in (0,size),'metadata_version_size')
 need(not any(meta[12:28]) and not any(meta[104:112]),'encrypted_or_expiring_store')
 payload=data[4:4+size];need(zlib.crc32(payload)==crc,'CRC_mismatch')
 def varint(buf,pos):
  value=0
  for i in range(5):
   need(pos<len(buf),'truncated_varint');b=buf[pos];pos+=1;value|=(b&127)<<(7*i)
   if b<128:need(value<=0xffffffff,'varint_overflow');return value,pos
  raise Refused('overlong_varint')
 _,pos=varint(payload,0);values={}
 while pos<len(payload):
  n,pos=varint(payload,pos);need(0<n<=len(payload)-pos,'invalid_key');key=payload[pos:pos+n].decode('utf-8');pos+=n
  n,pos=varint(payload,pos);need(n<=len(payload)-pos,'invalid_value');raw=payload[pos:pos+n];pos+=n
  if n:values[key]=raw
  else:values.pop(key,None)  # MMKV append log: last write/tombstone wins, as official MiniPBCoder.
 for key in (FLAG,INNER):need(values.get(key)==b'\x01','required_typed_int_not_one:'+key)
 return {FLAG:1,INNER:1}
def qr_state(xml):
 import xml.etree.ElementTree as ET
 nodes=list(ET.fromstring(xml).iter('node'));texts=[n.get('text','') for n in nodes]
 expired=any(any(w in x.lower() for w in ('二维码已过期','二维码过期','二维码已失效','获取二维码失败','获取登录二维码失败','二维码加载失败','无法获取二维码','网络错误','qr code expired','failed to get qr')) for x in texts)
 error=any('资格' in x or '停止运行' in x for x in texts)
 ready=not (expired or error) and any('用手机微信扫码登录' in x for x in texts) and any(n.get('class')=='android.widget.ImageView' and n.get('package')=='com.tencent.mm' for n in nodes)
 return {'requires_user_scan':ready,'needs_manual_refresh':expired,'native_error_visible':error}
def perform(phone,mode,renew):
 fg=phone.foreground();need(fg.get('package')=='com.tencent.mm','foreign_foreground')
 if fg['activity']=='com.tencent.mm.ui.LauncherUI':return {'status':'already_logged_in_noop','requires_user_scan':False}
 need(fg['activity'] in LOGGED_OUT+(QR,),'unknown_foreground')
 verified=phone.verify()
 common={'verification':verified,'runtime_wire_type':'unobserved','requires_user_pad_confirmation':True,'logged_in_verified':False}
 if mode=='probe':return dict(common,status='read_only_probe',foreground=fg,requires_user_scan=False)
 if fg['activity']==QR:return dict(common,status='existing_qr_no_new_request',**phone.capture())
 renew();current=phone.foreground();need(current.get('package')=='com.tencent.mm','foreground_changed')
 if current['activity']=='com.tencent.mm.ui.LauncherUI':return {'status':'already_logged_in_noop','requires_user_scan':False}
 if current.get('package')=='com.tencent.mm' and current['activity']==QR:return dict(common,status='existing_qr_no_new_request',**phone.capture())
 need(current==fg,'foreground_changed');opened=phone.open_qr()  # At most one request; unknown outcome is never retried.
 for _ in range(6):
  current=phone.foreground();need(current.get('package')=='com.tencent.mm','foreground_changed')
  if current['activity']=='com.tencent.mm.ui.LauncherUI':return {'status':'already_logged_in_noop','requires_user_scan':False}
  if current['activity']==QR:break
  need(current.get('package')=='com.tencent.mm' and current['activity'] in LOGGED_OUT,'navigation_unknown');time.sleep(.2)
 need(current['activity']==QR,'native_qr_not_foreground')
 return dict(common,status='native_qr_page_opened' if opened is not False else 'existing_qr_no_new_request',**phone.capture())
class Runtime:
 def __init__(self,binding,owner,evidence):
  need(binding['device_serial']==SERIAL and set(binding['lease_resource_names'])=={SERIAL,INSTANCE},'wrong_device_binding')
  need(sha(SDK.read_bytes())==SDK_SHA,'SDK_changed');sp=importlib.util.spec_from_file_location('frozen_wechat_phone',SDK);m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
  self.b,self.owner,self.evidence=binding,owner,evidence;self.p=m.Phone(SERIAL,owner,str(evidence),binding['lock_root'],binding['adb_wrapper'],15)
  self.owned=[];self.attempted=[];self.unknown_acquires=set();self.public=False;self.public_attempted=False;self.public_unknown=False;self.deadline=0;self.cleanup=[];self.pid=None
 def api(self,path='',body=None):
  req=urllib.request.Request(BASE+path,data=None if body is None else json.dumps(body).encode(),headers={'Content-Type':'application/json'})
  with urllib.request.urlopen(req,timeout=10) as r:return json.load(r)
 def lock(self,op,*args):
  env=dict(os.environ,DOUYIN_PHONE_REGISTRY=self.b['phone_profile_registry'],DOUYIN_PHONE_TMP_ROOT='/private/tmp/openclaw-phone',DOUYIN_ADB_BIN=self.b['adb_wrapper'],DOUYIN_BYPASS_REPORT='off')
  r=subprocess.run([self.b['lock_cli'],'--profile',self.b['phone_profile'],op,*args],env=env,capture_output=True,text=True,timeout=20)
  need(r.returncode==0,'public_lock_operation_failed:'+op);return r.stdout.strip()
 def acquire(self):
  for key in (SERIAL,INSTANCE):
   self.attempted.append(key)
   # Record an ambiguous attempt as ours only after a server readback with exact owner.
   try:r=self.api('/acquire',{'device_name':key,'locked_by':self.owner,'ttl_minutes':5})
   except Exception:
    self.unknown_acquires.add(key)
    rows=self.api().get('locks',[])
    if any(x.get('device_name')==key and x.get('locked_by')==self.owner for x in rows):self.owned.append(key);self.unknown_acquires.discard(key)
    else:self.cleanup.append('ambiguous_acquire:'+key)
    raise
   need(r.get('acquired') is True,'lease_busy:'+key);self.owned.append(key)
  need(self.lock('lock-status')=='lock=free','public_lock_busy')
  self.public_attempted=True
  try:self.lock('lock-acquire-new',self.owner);self.public=True
  except Exception:
   self.public_unknown=True
   try:self.p.require_owner();self.public=True;self.public_unknown=False
   except Exception:pass
   raise
  self.p.require_owner();self.renew()
 def renew(self):
  self.p.require_owner();rows=[r for r in self.api()['locks'] if r['device_name'] in {SERIAL,INSTANCE}]
  need(len(rows)==2 and {r['device_name'] for r in rows}=={SERIAL,INSTANCE},'lease_rows')
  now=datetime.datetime.now(datetime.timezone.utc)
  for r in rows:
   need(r.get('locked_by')==self.owner and not r.get('expired'),'lease_owner')
   need((datetime.datetime.fromisoformat(r['expires_at'].replace('Z','+00:00'))-now).total_seconds()>140,'lease_TTL')
  self.deadline=time.monotonic()+120
 def close(self):
  if self.public or self.public_unknown:
   try:
    self.p.require_owner();self.lock('lock-release-exact',self.owner);need(self.lock('lock-status')=='lock=free','public_release_readback');self.public_unknown=False
   except Exception as e:self.cleanup.append('public:'+str(e))
  for key in reversed(self.attempted):
   try:
    rows=[r for r in self.api()['locks'] if r['device_name']==key];need(len(rows)==1,'release_rows')
    if rows[0].get('locked_by')==self.owner:self.api('/release',{'device_name':key,'locked_by':self.owner})
    rows=[r for r in self.api()['locks'] if r['device_name']==key];need(len(rows)==1 and rows[0].get('locked_by')!=self.owner,'lease_release_readback')
   except Exception as e:self.cleanup.append(key+':'+str(e))
  if self.unknown_acquires:self.cleanup.append('unknown_acquire_outcome:'+','.join(sorted(self.unknown_acquires)))
  return not self.cleanup
 def call(self,*args,raw=False):
  left=self.deadline-time.monotonic();need(left>0,'phase_deadline');self.p.timeout=min(15,left)
  out=self.p.run(*args);return out if raw else out.decode('utf-8').strip()
 def shell(self,*args):return self.call('shell',*args)
 def foreground(self):
  need(time.monotonic()<self.deadline,'phase_deadline');self.p.timeout=min(15,self.deadline-time.monotonic());return self.p.foreground()
 def verify(self):
  need(self.shell('am','get-current-user')=='0','not_user0')
  pkg=self.shell('dumpsys','package','com.tencent.mm');need(set(re.findall(r'\buserId=(\d+)',pkg))=={'10088'} and set(re.findall(r'\bversionName=([^\s]+)',pkg))=={'8.0.79'},'package_changed')
  paths=self.shell('pm','path','com.tencent.mm').splitlines();need(len(paths)==1 and re.fullmatch(r'package:/data/app/[A-Za-z0-9_./~+=-]+/base\.apk',paths[0]),'APK_path')
  need(self.shell('sha256sum',paths[0][8:]).split()[0]==APK_SHA,'APK_changed')
  pid=self.shell('pidof','com.tencent.mm');need(re.fullmatch('[1-9][0-9]*',pid),'ambiguous_main_PID');self.pid=pid
  uid=re.findall(r'^Uid:\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$',self.shell('cat','/proc/'+pid+'/status'),re.M);need(uid==[('10088',)*4],'main_UID_changed')
  paths=[LIVE+'Repairer',LIVE+'Repairer.crc'];before=self.shell('sha256sum',*paths)
  data=self.call('exec-out','cat',paths[0],raw=True);meta=self.call('exec-out','cat',paths[1],raw=True);after=self.shell('sha256sum',*paths);need(before==after,'MMKV_pair_unstable')
  expected=[(sha(data),paths[0]),(sha(meta),paths[1])];need([tuple(x.split()) for x in before.splitlines()]==expected,'MMKV_capture_changed')
  flags=read_flags(data,meta)
  return {'disk_pad_flag':flags[FLAG],'inner_version':flags[INNER],'main_pid':int(pid),'pair_sha256':[sha(data),sha(meta)],'cold_runtime_B_proven':False}
 def open_qr(self):
  need(self.shell('pidof','com.tencent.mm')==self.pid,'main_process_changed')
  self.p.require_safe_write();current=self.foreground()
  if current['activity'] in (QR,'com.tencent.mm.ui.LauncherUI'):return False
  need(current.get('package')=='com.tencent.mm' and current['activity'] in LOGGED_OUT,'last_state_not_logged_out');need(time.monotonic()<self.deadline,'phase_deadline')
  self.shell('am','start','-W','--user','0','-n','com.tencent.mm/.plugin.login_exdevice.ui.LoginAsExDeviceUI');return True
 def capture(self):
  import xml.etree.ElementTree as ET
  need(self.foreground()=={'package':'com.tencent.mm','activity':QR},'qr_state_changed');png=self.call('exec-out','screencap','-p',raw=True);need(png.startswith(b'\x89PNG\r\n\x1a\n'),'invalid_image')
  target=self.evidence/'qr.png';target.write_bytes(png);target.chmod(0o600)
  remote='/data/local/tmp/wechat-pad-login-'+uuid.uuid4().hex+'.xml';xml=None
  try:self.shell('uiautomator','dump','--compressed',remote);xml=self.call('exec-out','cat',remote,raw=True)
  finally:
   try:self.shell('rm',remote)
   except Exception as e:self.cleanup.append('UI_temp:'+str(e))
  state=qr_state(xml);need(self.foreground()=={'package':'com.tencent.mm','activity':QR},'qr_state_changed')
  return dict(state,qr_image=str(target),qr_visual_verification_required=True)

def main(argv=None):
 parser=argparse.ArgumentParser(description='只读检查微信Pad配置，或单次打开原生二维码；不登录、不改配置。');parser.add_argument('command',choices=('status','probe','open'));args=parser.parse_args(argv)
 if args.command=='status':print(json.dumps({'status':'local_only','device_live_checked':False,'device':SERIAL,'commands':['probe','open']},ensure_ascii=False));return 0
 owner='wechat-pad-login-'+uuid.uuid4().hex;evidence=pathlib.Path.home()/'.local/state/zenithjoy/wechat-pad-login'/owner;evidence.mkdir(mode=0o700,parents=True)
 receipt={'owner':owner,'command':args.command,'status':'started','logged_in_verified':False};runtime=None
 try:
  binding=json.loads(BINDING.read_text());runtime=Runtime(binding,owner,evidence)
  try:
   runtime.acquire()
   with runtime.p.guard():receipt.update(perform(runtime,args.command,runtime.renew))
  finally:
   clean=runtime.close();receipt['cleanup_verified']=clean;receipt['cleanup_errors']=runtime.cleanup
  need(clean,'cleanup_unverified')
 except Exception as e:receipt['status']='failed_no_retry';receipt['requires_user_scan']=False;receipt['error']=type(e).__name__+':'+str(e)
 path=evidence/'receipt.json';path.write_text(json.dumps(receipt,ensure_ascii=False,indent=2));path.chmod(0o600);receipt['receipt']=str(path);print(json.dumps(receipt,ensure_ascii=False));return 0 if receipt['status']!='failed_no_retry' else 1
if __name__=='__main__':raise SystemExit(main())
