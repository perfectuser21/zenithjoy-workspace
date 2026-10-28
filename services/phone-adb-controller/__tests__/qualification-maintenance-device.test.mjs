import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const module=fileURLToPath(new URL('../qualification-maintenance-device.py',import.meta.url));
function run(code){const p=spawnSync('python3',['-B','-I','-c',`import importlib.util,sys\ns=importlib.util.spec_from_file_location('device',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n${code}`,module],{encoding:'utf8',timeout:5000});assert.equal(p.status,0,p.stderr+p.stdout);}
test('固定smart-socket只读协议：version41/精确目标/无ADB子进程',()=>run(`
import socket,threading
commands=[]
server=socket.socket();server.bind(('127.0.0.1',0));server.listen()
def frame(c):
 n=int(c.recv(4),16);b=b''
 while len(b)<n:b+=c.recv(n-len(b))
 commands.append(b.decode());return b
def serve():
 c,_=server.accept();assert frame(c)==b'host:version';c.sendall(b'OKAY00040029');c.close()
 c,_=server.accept();assert frame(c)==b'host:transport:SER1';c.sendall(b'OKAY');assert frame(c)==b'shell:getprop ro.build.version.sdk';c.sendall(b'OKAY36\\n');c.close();server.close()
t=threading.Thread(target=serve,daemon=True);t.start()
result=m.read_query('SER1','sdk',connector=lambda:socket.create_connection(server.getsockname(),timeout=1))
assert result=='36\\n';t.join(1);assert not t.is_alive();assert len(commands)==3
`));
test('未知操作/注入serial在开任何socket之前拒绝',()=>run(`
for serial,key in [('SER1;id','sdk'),('SER1','shell:input tap 1 2'),('SER1','record-stop')]:
 try:m.read_query(serial,key,connector=lambda:(_ for _ in ()).throw(AssertionError('opened')))
 except ValueError:pass
 else:raise AssertionError('accepted')
`));
test('协议短读/FAIL/非41版本均阻断，不回退启动server',()=>run(`
class Stream:
 def __init__(self,raw):self.raw=raw
 def sendall(self,b):pass
 def recv(self,n):v,self.raw=self.raw[:n],self.raw[n:];return v
 def close(self):pass
 def settimeout(self,x):pass
for raw in [b'OK',b'FAIL0004nope',b'OKAY00040028',b'OKAYzzzz']:
 try:m.read_query('SER1','sdk',connector=lambda:Stream(raw))
 except ValueError:pass
 else:raise AssertionError('accepted')
`));
test('完整ps识别脱离原host名单的设备capture；未知表头不作无残留',()=>run(`
base='UID PID PPID NAME\\nu0_a61 13732 1 com.ss.android.ugc.aweme\\nshell 200 1 ps\\n'
assert m.parse_processes(base)['capture_pids']==[]
assert m.parse_processes(base+'shell 399 1 com.genymobile.scrcpy.Server\\n')['capture_pids']==[399]
assert m.parse_processes(base+'shell 400 1 app_process / com.genymobile.scrcpy.Server\\n')['capture_pids']==[400]
for raw in ['', 'PID NAME\\n399 scrcpy\\n',base+'malformed\\n']:
 try:m.parse_processes(raw)
 except ValueError:pass
 else:raise AssertionError('accepted')
`));
test('音频只验证原抖音恢复状态，不要求全机静音；未知/残留capture保持BLOCK',()=>run(`
audio='PlaybackActivityMonitor\\n  players:\\n    AudioPlaybackConfiguration piid:5087 deviceId:1 type:android.media.AudioTrack u/pid:10061/13732 state:started attr: usage=USAGE_MEDIA mutedState:none FormatInfo x\\n  Events log:\\n'
p=m.parse_native_audio(audio,10061);assert p['state']=='started';assert p['pid']==13732
assert m.parse_native_audio('unrecognized',10061)['state']=='unknown'
assert m.parse_projection('arbitrary missing service text')['state']=='unknown'
assert m.parse_projection('MEDIA PROJECTION MANAGER (dumpsys media_projection)\\nMedia Projection: (null)\\n')['state']=='inactive'
assert m.parse_projection('MEDIA PROJECTION MANAGER (dumpsys media_projection)\\nMedia Projection: \\nnull\\n')['state']=='inactive'
assert m.parse_projection('MEDIA PROJECTION MANAGER (dumpsys media_projection)\\nMedia Projection: grant active\\n')['state']=='unknown'
`));
test('真实query已完成但ps/owners解析拒绝时保明确阶段和非秘密形状，不假成功',()=>run(`
values={'sdk':'36\\n','processes':'BAD HEADER\\nshell 200 1 ps\\n','projection':'unknown\\n','audio':'unknown\\n','package':'package:com.ss.android.ugc.aweme uid:10061\\n','foreground':'unknown\\n','owners':'package:com.ss.android.ugc.aweme uid:10061\\n'}
m.read_query=lambda serial,key,**kw:values[key]
r=m.collect_device('SER1');assert r['status']=='blocked';assert r['stage']=='parse_processes';assert r['diagnostics']['process_header']=='BAD HEADER';assert r['normalized_text_sha256']['owners']
`));
test('文本协议CRLF归一摘要明确标normalized，不冒原wire字节摘要',()=>run(`
values={'sdk':'36\\n','processes':'UID PID PPID NAME\\nshell 200 1 ps\\n','projection':'unknown\\n','audio':'unknown\\n','package':'package:com.ss.android.ugc.aweme uid:10061\\n','foreground':'unknown\\n','owners':'package:com.ss.android.ugc.aweme uid:10061\\n'}
m.read_query=lambda serial,key,**kw:values[key]
r=m.collect_device('SER1');assert 'raw_sha256' not in r;assert r['normalized_text_sha256']['sdk']==m.hashlib.sha256(b'36\\n').hexdigest()
`));
