#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
node --test services/phone-adb-controller/patrol/contracts/definitions.test.mjs
# 每份声明的手机/控制代码版本分别从Git取字节运行回归，不以HEAD替代旧版。
# 运行代码保持固定版本原字节；测试契约与代码版本分别留痕。
python3 - <<'PY'
import ast,hashlib,json,pathlib,subprocess,tempfile,os
root=pathlib.Path.cwd()
def checked(args,cwd):
    subprocess.run(args,cwd=cwd,check=True,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
phone=set();control=set();protected={}
def digest(raw): return hashlib.sha256(raw).hexdigest()
def methods(raw):
    tree=ast.parse(raw); klass=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='FailureEvidenceTests'); return {n.name:n for n in klass.body if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
definition_revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
for path in sorted((root/'services/phone-adb-controller/patrol/contracts').glob('*.json')):
    d=json.loads(path.read_text())
    for a in d['activities']:
        for b in [a['implementation'],*a.get('implementation_bindings',[])]:
            (control if pathlib.PurePosixPath(b['path']).name.startswith('openclaw_') else phone).add(b['revision'])
            protected.setdefault(b['revision'],set()).add(pathlib.PurePosixPath(b['path']).name)
for revision in sorted(phone|control):
    with tempfile.TemporaryDirectory(prefix='patrol-definition-regression-') as folder:
        archive=subprocess.check_output(['git','archive',revision,'scripts/phone-account-patrol'],cwd=root)
        subprocess.run(['tar','-x','-C',folder],input=archive,check=True)
        path=pathlib.Path(folder)/'scripts/phone-account-patrol'
        runtime_before={name:digest((path/name).read_bytes()) for name in protected[revision]}
        if revision=='864154c57e88e8085d2add741a79103a28891a44':
            test_path='services/phone-adb-controller/patrol/contracts/regression/test_failure_evidence.py'
            contract=subprocess.check_output(['git','show',definition_revision+':'+test_path],cwd=root)
            assert contract==(root/test_path).read_bytes(),'测试契约必须等于固定D字节'
            historical=(path/'test_failure_evidence.py').read_bytes()
            assert historical==subprocess.check_output(['git','show',revision+':scripts/phone-account-patrol/test_failure_evidence.py'],cwd=root)
            prior,current=methods(historical),methods(contract)
            assert set(prior)<=set(current),'不得删除或跳过历史用例'
            for name,node in prior.items():
                if name!='test_deeply_nested_diagnostic_cannot_break_failure_reporting':
                    assert ast.dump(node)==ast.dump(current[name]),'不得改动其它历史用例: '+name
            (path/'test_failure_evidence.py').write_bytes(contract)
            print('运行代码来源',revision,'回归契约来源',definition_revision+':'+test_path,'sha256:'+digest(contract),flush=True)
        else:
            print('运行代码与历史回归契约来源',revision,flush=True)
        if revision in phone:
            modules=sorted(f.stem for f in path.glob('test_*.py') if not f.name.startswith('test_openclaw'))
            checked(['python3','-m','unittest',*modules],path)
            checked(['node','--test','test_publish.mjs','test_mirror.mjs'],path)
        if revision in control:
            checked(['python3','-m','unittest','discover','-s','.','-p','test_openclaw*.py'],path)
        assert runtime_before=={name:digest((path/name).read_bytes()) for name in protected[revision]},'测试不得修改固定运行代码'
        print('固定代码版本回归PASS',revision,flush=True)
PY
