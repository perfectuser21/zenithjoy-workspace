"""Only fixture HOME mapping; all terminal facts come from the real helper."""
import json
from pathlib import Path
import pwd
import sys
import types

root, home = Path(sys.argv[1]), sys.argv[2]
path = root / 'adb-private-supervisor.py'
module = types.ModuleType('native_readback')
module.__file__ = str(path)
exec(compile(path.read_bytes(), str(path), 'exec'), module.__dict__)
pwd.getpwuid = lambda uid: types.SimpleNamespace(pw_dir=home)
print(json.dumps(module.run(json.load(sys.stdin))))
