#!/usr/bin/env python3
"""ADB=此入口；scrcpy客户端仍由成熟控制器直接启动和持有PID。"""
from pathlib import Path
import runpy
import signal
import sys

runtime = runpy.run_path(str(Path(__file__).with_name('scrcpy-runtime.py')))


def interrupted(signum, frame):
    raise runtime['RuntimeFailure']('ADB shim interrupted', unknown=True)


for sig in (signal.SIGTERM, signal.SIGINT):
    signal.signal(sig, interrupted)
sys.exit(runtime['adb_shim'](sys.argv[1:]))
