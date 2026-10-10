import subprocess,sys,json,datetime,pathlib
from collector import PACKAGES
serial,profile,runid=sys.argv[1:4]
adb='/opt/homebrew/bin/adb'
try:
 p=subprocess.run([adb,'-s',serial,'shell','dumpsys','window'],capture_output=True,text=True,timeout=20)
 focus='\n'.join(l for l in p.stdout.splitlines() if 'mCurrentFocus' in l)
 if p.returncode:state='离线未查';reason='ADB设备当前不可达'
 elif not focus:state='检测失败';reason='没有读到前台窗口，未接管手机'
 elif not any(x in focus for x in ['launcher','Launcher']):state='占用未查';reason='前台已有应用或锁屏，未接管手机'
 else:state=None
except Exception:state='检测失败';reason='设备可用性检查失败，未接管手机'
if state:
 print(json.dumps({'serial':serial,'results':{p:{'state':state,'reason':reason,'checked_at':datetime.datetime.now(datetime.timezone.utc).isoformat()} for p in list(PACKAGES)+['视频号']}},ensure_ascii=False));sys.exit(0)
root=pathlib.Path(__file__).resolve().parent
# Native lock owns acquisition, expiry and release; no separate lock files or forced unlocks.
r=subprocess.run([str(pathlib.Path.home()/'.local/bin/douyin-phone-adb'),'--profile',profile,'with-lock','account-patrol-'+runid,'--','/opt/homebrew/bin/python3',str(root/'collector.py'),serial,runid])
sys.exit(r.returncode)
