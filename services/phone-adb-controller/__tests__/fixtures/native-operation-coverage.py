"""测试专用后台资源：double-fork/setsid 后自行存活五秒，不接受停止指令。"""
import json
import os
from pathlib import Path
import signal
import sys
import time

os.umask(0o077)
oracle = Path(sys.argv[1])
# 给真实产品登记父PID/启动身份/watcher的机会；不是产品发现器开关。
time.sleep(0.5)
ready_r, ready_w = os.pipe()
child = os.fork()
if child:
    os.close(ready_w)
    os.read(ready_r, 1)
    os.close(ready_r)
    os._exit(0)

os.close(ready_r)
os.setsid()
grandchild = os.fork()
if grandchild:
    os.write(ready_w, b"1")
    os.close(ready_w)
    os._exit(0)
os.close(ready_w)
signal.signal(signal.SIGTERM, signal.SIG_IGN)
for fd in (0, 1, 2):
    try:
        os.close(fd)
    except OSError:
        pass

started = time.monotonic()
with (oracle / "identity.json").open("x") as out:
    json.dump({"pid": os.getpid(), "pgid": os.getpgrp(), "ppid": os.getppid(),
               "started_ns": time.time_ns(), "stdio_closed": True,
               "ttl_seconds": 5}, out)
with (oracle / "heartbeat.jsonl").open("x") as out:
    counter = 0
    while time.monotonic() - started < 5:
        out.write(json.dumps({"counter": counter, "at_ns": time.time_ns()}) + "\n")
        out.flush()
        counter += 1
        time.sleep(0.05)
with (oracle / "ttl-exit.json").open("x") as out:
    json.dump({"reason": "fixture_5s_ttl", "at_ns": time.time_ns()}, out)
os._exit(0)
