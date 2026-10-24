import unittest,struct,zlib,subprocess,sys,pathlib,json
import wechat_pad_login as pad
ROOT=pathlib.Path(__file__).resolve().parents[1]
def vint(n):
 b=bytearray()
 while n>=128:b.append((n&127)|128);n>>=7
 b.append(n);return bytes(b)
def pair(flag=b'\x01',inner=b'\x01'):
 payload=b'\0'
 for key,value in [(pad.INNER,inner),(pad.FLAG,flag)]:
  k=key.encode();payload+=vint(len(k))+k+vint(len(value))+value
 d=bytes(4)+payload+bytes(4096-4-len(payload));c=bytearray(4096);struct.pack_into('<III',c,0,zlib.crc32(payload),5,1);struct.pack_into('<I',c,28,len(payload));return d,bytes(c)
class PadTests(unittest.TestCase):
 def test_typed_pair_and_crc(self):self.assertEqual(pad.read_flags(*pair()),{pad.FLAG:1,pad.INNER:1})
 def test_bad_crc_false_and_string_typed_one(self):
  d,c=pair();bad=bytearray(c);bad[0]^=1
  for a,b in [(d,bytes(bad)),pair(b'\0'),pair(b'\x011'),pair(inner=b'\0')]:
   with self.assertRaises(pad.Refused):pad.read_flags(a,b)
 def test_launcher_noop_before_config(self):
  f=Fake('com.tencent.mm.ui.LauncherUI');self.assertEqual(pad.perform(f,'open',lambda:None)['status'],'already_logged_in_noop');self.assertEqual(f.writes,[])
 def test_existing_qr_never_reopens(self):
  f=Fake(pad.QR);pad.perform(f,'open',lambda:None);self.assertEqual(f.writes,[])
 def test_unknown_foreground_no_navigation(self):
  f=Fake('foreign.App')
  with self.assertRaises(pad.Refused):pad.perform(f,'open',lambda:None)
  self.assertEqual(f.writes,[])
 def test_updated_apk_no_navigation(self):
  f=Fake(pad.LOGGED_OUT[0]);f.apk='0'*64
  with self.assertRaises(pad.Refused):pad.perform(f,'open',lambda:None)
  self.assertEqual(f.writes,[])
 def test_probe_never_navigates(self):
  f=Fake(pad.LOGGED_OUT[0]);pad.perform(f,'probe',lambda:None);self.assertEqual(f.writes,[])
 def test_open_exactly_once(self):
  f=Fake(pad.LOGGED_OUT[0]);pad.perform(f,'open',lambda:None);self.assertEqual(len(f.writes),1)
 def test_lease_busy_prevents_open(self):
  f=Fake(pad.LOGGED_OUT[0])
  def busy():raise pad.Refused('busy')
  with self.assertRaises(pad.Refused):pad.perform(f,'open',busy)
  self.assertEqual(f.writes,[])
 def test_help_and_local_status_no_runtime(self):
  for args in [['--help'],['status']]:
   p=subprocess.run([sys.executable,str(ROOT/'wechat_pad_login.py'),*args],capture_output=True,text=True);self.assertEqual(p.returncode,0,p.stderr)
class Fake:
 def __init__(self,activity):self.activity=activity;self.writes=[];self.apk=pad.APK_SHA
 def foreground(self):return {'package':'com.tencent.mm' if self.activity.startswith('com.tencent.mm.') else 'foreign','activity':self.activity}
 def verify(self):
  if self.apk!=pad.APK_SHA:raise pad.Refused('apk_changed')
  return {'disk_pad_flag':1,'inner_version':1}
 def open_qr(self):self.writes.append(pad.QR);self.activity=pad.QR
 def capture(self):return {'qr_image':'private.png','requires_user_scan':True}
if __name__=='__main__':unittest.main()

class OwnedLockTests(unittest.TestCase):
 def session(self,busy=None,public_busy=False):
  from unittest.mock import Mock
  r=pad.Runtime.__new__(pad.Runtime);r.b={};r.owner='our-unique-owner';r.owned=[];r.attempted=[];r.unknown_acquires=set();r.public=False;r.cleanup=[];r.deadline=0;r.p=Mock();owners={pad.SERIAL:None,pad.INSTANCE:None};released=[]
  def api(path='',body=None):
   if path=='/acquire':
    key=body['device_name']
    if key==busy:owners[key]='somebody-else';return {'acquired':False}
    owners[key]=r.owner;return {'acquired':True}
   if path=='/release':
    key=body['device_name'];self.assertEqual(owners[key],r.owner);released.append(key);owners[key]=None;return {'released':True}
   return {'locks':[{'device_name':k,'locked_by':o,'expires_at':(pad.datetime.datetime.now(pad.datetime.timezone.utc)+pad.datetime.timedelta(minutes=5)).isoformat()} for k,o in owners.items()]}
  def lock(op,*args):return 'lock=busy' if public_busy and op=='lock-status' else 'lock=free'
  r.api=api;r.lock=lock;return r,owners,released
 def test_second_lease_busy_releases_only_ours(self):
  r,owners,released=self.session(pad.INSTANCE)
  with self.assertRaises(pad.Refused):r.acquire()
  self.assertTrue(r.close());self.assertEqual(released,[pad.SERIAL]);self.assertEqual(owners[pad.INSTANCE],'somebody-else')
 def test_public_busy_releases_two_brain_leases(self):
  r,owners,released=self.session(public_busy=True)
  with self.assertRaises(pad.Refused):r.acquire()
  self.assertTrue(r.close());self.assertEqual(set(released),{pad.SERIAL,pad.INSTANCE})
 def test_cleanup_readback_failure_not_success(self):
  r,owners,released=self.session();r.acquire();original=r.api
  def fail(path='',body=None):
   if path=='/release':raise TimeoutError('release unknown')
   return original(path,body)
  r.api=fail;self.assertFalse(r.close());self.assertTrue(r.cleanup)
 def test_full_cleanup_only_owned_owner(self):
  r,owners,released=self.session();r.acquire();self.assertTrue(r.close());self.assertTrue(all(v is None for v in owners.values()))

class QRAndUnknownTests(unittest.TestCase):
 def test_expired_or_failed_qr_never_requests_scan(self):
  for text in ('二维码已过期','获取二维码失败','未获得体验资格'):
   xml='<hierarchy><node text="用手机微信扫码登录"/><node class="android.widget.ImageView" package="com.tencent.mm"/><node text="'+text+'"/></hierarchy>'
   self.assertFalse(pad.qr_state(xml)['requires_user_scan'])
 def test_current_qr_can_request_user_scan_without_auth_claim(self):
  xml='<hierarchy><node text="用手机微信扫码登录"/><node class="android.widget.ImageView" package="com.tencent.mm"/></hierarchy>'
  self.assertTrue(pad.qr_state(xml)['requires_user_scan'])
 def test_ambiguous_acquire_and_failed_readback_never_reports_clean(self):
  r,owners,released=OwnedLockTests().session();count=[0]
  def api(path='',body=None):
   if path=='/acquire':raise TimeoutError('acquire unknown')
   count[0]+=1
   if count[0]==1:raise TimeoutError('readback unavailable')
   return {'locks':[{'device_name':k,'locked_by':v} for k,v in owners.items()]}
  r.api=api
  with self.assertRaises(TimeoutError):r.acquire()
  self.assertFalse(r.close());self.assertEqual(released,[])
