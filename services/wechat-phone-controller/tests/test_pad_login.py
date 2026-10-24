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
