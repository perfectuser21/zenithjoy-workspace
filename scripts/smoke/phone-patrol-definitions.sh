#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node --test services/phone-adb-controller/patrol/contracts/definitions.test.mjs
# 每份声明的手机/控制代码版本分别从Git取字节运行回归，不以HEAD替代旧版。
# 手机套件只运行实际安装的8文件；控制器套件由其独立固定版本运行。
python3 - <<'PY'
import json,pathlib,subprocess,tempfile,os
root=pathlib.Path.cwd()
def checked(args,cwd):
    subprocess.run(args,cwd=cwd,check=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
phone=set();control=set()
for path in sorted((root/'services/phone-adb-controller/patrol/contracts').glob('*.json')):
    d=json.loads(path.read_text())
    for a in d['activities']:
        for b in [a['implementation'],*a.get('implementation_bindings',[])]:
            (control if pathlib.PurePosixPath(b['path']).name.startswith('openclaw_') else phone).add(b['revision'])
for revision in sorted(phone|control):
    with tempfile.TemporaryDirectory(prefix='patrol-definition-regression-') as folder:
        archive=subprocess.check_output(['git','archive',revision,'scripts/phone-account-patrol'],cwd=root)
        subprocess.run(['tar','-x','-C',folder],input=archive,check=True)
        path=pathlib.Path(folder)/'scripts/phone-account-patrol'
        if revision in phone:
            modules=sorted(f.stem for f in path.glob('test_*.py') if not f.name.startswith('test_openclaw'))
            checked(['python3','-m','unittest',*modules],path)
            checked(['node','--test','test_publish.mjs','test_mirror.mjs'],path)
        if revision in control:
            checked(['python3','-m','unittest','discover','-s','.','-p','test_openclaw*.py'],path)
        print('固定代码版本回归PASS',revision,flush=True)
PY
