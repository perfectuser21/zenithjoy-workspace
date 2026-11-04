#!/usr/bin/env python3
"""新102维护的有限nofork动作域；未知只保留意图和锁，不重发。"""
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import struct
import subprocess
import sys
sys.dont_write_bytecode=True
import time
import xml.etree.ElementTree as ET

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('collection_review_phone_proof',HERE/'collection-review-maintenance.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
SANDBOX='/usr/bin/sandbox-exec'
PROFILE='(version 1)(allow default)(deny process-fork)'

def atomic_new(path,value):
    raw=m.canonical(value);fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        offset=0
        while offset<len(raw):offset+=os.write(fd,raw[offset:])
        os.fsync(fd)
    finally:os.close(fd)
    m.primitives.tx.sync_directory(path.parent)

def sandbox_verified(env):
    p=subprocess.run([SANDBOX,'-p',PROFILE,'/usr/bin/true'],env=env,capture_output=True,timeout=3)
    n=subprocess.run([SANDBOX,'-p',PROFILE,'/bin/sh','-c','/usr/bin/true & wait'],env=env,capture_output=True,timeout=3)
    m.need(p.returncode==0 and n.returncode!=0 and re.search(rb'fork: (?:Operation not permitted|Resource temporarily unavailable)',n.stderr),'NOFORK_BOUNDARY')

def leaf(binary,argv,env,expected_hash,*,timeout=20):
    m.need(m.sha(m.read(binary,128*1024*1024))==expected_hash,'ADB_PIN_DRIFT')
    event={'argv_sha256':m.sha(m.canonical(argv)),'intent_at':time.time_ns(),'boundary':'darwin-sandbox-deny-process-fork-v1'}
    p=subprocess.Popen([SANDBOX,'-p',PROFILE,str(binary),*argv],env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    event.update(pid=p.pid,started_at=time.time_ns())
    try:stdout,stderr=p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        p.kill();p.communicate();raise ValueError('COLLECTION_REVIEW_CLEANUP_LEAF_TIMEOUT') from None
    event.update(ended_at=time.time_ns(),code=p.returncode,stdout_sha256=m.sha(stdout),stderr_sha256=m.sha(stderr))
    m.need(p.returncode==0 and len(stdout)<=20*1024*1024 and len(stderr)<=1024*1024 and not re.search(rb'fork_denied=|fork(?:\(\))?: (?:Operation not permitted|Resource temporarily unavailable)',stderr),'CLEANUP_LEAF_UNVERIFIED')
    return stdout,event

class Phone:
    def __init__(self,home,original):
        self.home=home;self.original=original;frozen=json.loads(m.read(original/'run-definition.json'));self.policy=frozen['collection_phone_scope']['policy']
        endpoint=re.fullmatch(r'tcp:127[.]0[.]0[.]1:([0-9]{1,5})',self.policy.get('endpoint',''))
        m.need(endpoint and 1<=int(endpoint[1])<=65535,'ADB_ENDPOINT');self.port=endpoint[1]
        self.binary=Path(self.policy['adb_bin']).resolve();m.need(str(self.binary)==self.policy.get('adb_realpath',str(self.binary)),'ADB_REALPATH')
        self.env={'PATH':'/usr/bin:/bin:/usr/sbin:/sbin','HOME':str(home),'ADB_SERVER_SOCKET':self.policy['endpoint']}
        route_spec=importlib.util.spec_from_file_location('collection_existing_route',original/'runtime/adb-existing-route.py')
        self.route=importlib.util.module_from_spec(route_spec);route_spec.loader.exec_module(self.route)
        sandbox_verified(self.env);self.events=[]
    def command(self,args):
        self.route.select_existing_unique_route(m.SCOPE['serial'],self.policy['endpoint'])
        installed=self.route.read_host_policy()
        if installed is not None:
            m.need(installed['endpoint']==self.policy['endpoint'],'HOST_ROUTE');self.route.select_route(m.SCOPE['serial'],self.policy['endpoint'])
        raw,e=leaf(self.binary,['-H','127.0.0.1','-P',self.port,'-s',m.SCOPE['serial'],*args],self.env,self.policy['adb_sha256'])
        self.events.append(e);return raw
    def home_state(self):
        launcher=self.command(['shell','cmd','package','resolve-activity','-a','android.intent.action.MAIN','-c','android.intent.category.HOME']).decode()
        focus=self.command(['shell','dumpsys','window','displays']).decode()
        declarations=re.findall(r'(?m)^\s*packageName\b([^\r\n]*)',launcher)
        packages=[]
        for declaration in declarations:
            match=re.fullmatch(r'=([A-Za-z][A-Za-z0-9_]*(?:[.][A-Za-z0-9_]+)+)\s*',declaration)
            m.need(match,'HOME_PACKAGE');packages.append(match[1])
        m.need(packages and len(set(packages))==1,'HOME_PACKAGE')
        declarations=re.findall(r'(?m)^\s*m(CurrentFocus|FocusedApp)\b([^\r\n]*)',focus)
        m.need(sorted(kind for kind,_ in declarations)==['CurrentFocus','FocusedApp'],'FOCUS_INDICATORS')
        focused=[]
        for kind,declaration in declarations:
            wrapper='Window' if kind=='CurrentFocus' else 'ActivityRecord'
            pattern=r'=\s*'+wrapper+r'\{[a-fA-F0-9]+\s+u0\s+([A-Za-z][A-Za-z0-9_.]+)/[A-Za-z0-9_.$]+(?:\s+[A-Za-z0-9_.:+-]+)*\}\s*'
            match=re.fullmatch(pattern,declaration)
            m.need(match,'FOCUS_UNCLASSIFIED');focused.append(match[1])
        if set(focused)=={packages[0]}:
            verifier=m.load('maintenance-reopen-proof.py')
            proof=verifier.verify_safe_desktop(m.SCOPE['serial'],'packageName='+packages[0]+'\n',focus)
            return {'home':True,'launcher':packages[0],'proof':proof,'focus_sha256':m.sha(focus.encode())}
        m.need(set(focused)=={'com.ss.android.ugc.aweme'},'FOCUS_UNCLASSIFIED')
        return {'home':False,'launcher':packages[0],'focus_sha256':m.sha(focus.encode())}

    def cleanup(self,directory,admission_digest,revalidate):
        intent=directory/'cleanup-intent.json';result=directory/'cleanup-result.json'
        m.need(not intent.exists() and not result.exists(),'CLEANUP_PRIOR_INTENT_READBACK_ONLY')
        revalidate();atomic_new(intent,{'version':1,'scope':m.SCOPE,'maintenance':m.TASK,'admission_sha256':admission_digest,'actions':m.cleanup_commands(),'observed_at':time.time_ns()})
        # 两个独立叶，不使用复合shell；任何异常直接离开，原owner仍在。
        for args in m.cleanup_commands():self.command(args)
        state=self.home_state();m.need(state['home'],'CLEANUP_NOT_HOME')
        revalidate();atomic_new(result,{'version':1,'intent_sha256':m.sha(m.read(intent)),'scope':m.SCOPE,'home':state,'leaves':self.events,'requests_returned':True,'execution_stopped':False})
        return state
    def capture_desktop(self,directory,state):
        m.need(state['home'],'DESKTOP_REQUIRED')
        size=self.command(['shell','wm','size']).decode()
        physical=re.findall(r'(?m)^Physical size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})\s*$',size)
        override=re.findall(r'(?m)^Override size: ([1-9][0-9]{0,4})x([1-9][0-9]{0,4})\s*$',size)
        m.need(len(physical)==1 and len(override)<=1,'DISPLAY_SIZE')
        dimensions=tuple(map(int,(override or physical)[0]));m.need(all(0<n<=10000 for n in dimensions),'DISPLAY_SIZE')
        png=self.command(['exec-out','screencap','-p'])
        m.need(png.startswith(b'\x89PNG\r\n\x1a\n') and len(png)>64 and png[12:16]==b'IHDR' and struct.unpack('>II',png[16:24])==dimensions and b'IEND' in png[-32:],'DESKTOP_PNG')
        remote='/sdcard/collection-review-'+m.TASK['id']+'.xml'
        self.command(['shell','uiautomator','dump','--compressed',remote])
        # 独立cat读取固定生成XML；不接受任意路径或执行者自述。
        xml=self.command(['shell','cat',remote]);root=ET.fromstring(xml)
        m.need(root.tag=='hierarchy' and any(x.get('package')==state['launcher'] for x in root.iter('node')),'DESKTOP_XML')
        after=self.home_state();m.need(after['home'] and after['launcher']==state['launcher'],'DESKTOP_CHANGED')
        for name,raw in [('desktop.png',png),('desktop.xml',xml)]:
            p=directory/name
            if p.exists():m.need(m.read(p)==raw,'DESKTOP_ALREADY_RECORDED')
            else:
                fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
                try:
                    with os.fdopen(fd,'wb',closefd=False) as f:f.write(raw);f.flush();os.fsync(fd)
                finally:os.close(fd)
        m.primitives.tx.sync_directory(directory)
        return {'png_sha256':m.sha(png),'xml_sha256':m.sha(xml),'display_size':{'physical':list(map(int,physical[0])),'effective':list(dimensions)},'home':after,'leaves':self.events,'execution_stopped':False}
