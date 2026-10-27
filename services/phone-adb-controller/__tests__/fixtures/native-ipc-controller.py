"""Isolated controller driver; the only serial and ADB endpoint are test fixtures."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time

marker, controller = sys.argv[1:]
deadline = time.monotonic() + 6
while not Path(marker).exists():
    if time.monotonic() >= deadline:
        print('FIXTURE_OBSERVER_DID_NOT_START', file=sys.stderr)
        sys.exit(90)
    time.sleep(0.005)

started = time.monotonic()
result = subprocess.run(['/bin/zsh', controller, '--profile', 'ipc-fixture', 'foreground'],
                        capture_output=True, text=True, timeout=10, env=os.environ)
print(json.dumps({'code': result.returncode, 'stdout': result.stdout,
                  'stderr': result.stderr, 'elapsed_ms': round((time.monotonic() - started) * 1000)}))
sys.exit(result.returncode)
