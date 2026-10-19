#!/bin/bash
# 仅stage；正式root plist安装和active policy切换由持锁维护入口负责。
set -euo pipefail
if [[ $# != 1 ]]; then
  echo '用法: install-adb-host-service.sh <正式deployment-manifest.json>' >&2
  exit 2
fi
HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
exec python3 - "$HERE" "$1" <<'PY'
import importlib.util,sys
from pathlib import Path
path=Path(sys.argv[1])/'adb-host-service.py'
spec=importlib.util.spec_from_file_location('adb_host_service',path)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
try:
    module.stage(sys.argv[2])
except Exception as error:
    message=str(error)
    print(message if message.startswith('ADB_SERVICE_') else 'ADB_SERVICE_STAGE_FAILED',file=sys.stderr)
    sys.exit(2)
PY
