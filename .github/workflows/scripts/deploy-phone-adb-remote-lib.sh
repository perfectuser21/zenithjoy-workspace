#!/bin/bash
# deploy-phone-adb-remote-lib.sh —— phone-adb-controller 自动部署 workflow 的远端判断逻辑
# 从 .github/workflows/deploy-phone-adb-controller.yml 的 SSH 远程 heredoc 里 source，
# 也可独立跑单测（见 __tests__/deploy-phone-adb-remote-lib.test.mjs）。

# check_clean_checkout REPO_DIR
#   只关心已跟踪文件的改动(git reset --hard 会真正覆盖掉的那部分)：
#   REPO_DIR 里已跟踪文件全部干净(无论有没有未跟踪的新文件/目录) -> return 0，无输出
#   已跟踪文件有未提交改动，或 REPO_DIR 根本不是合法git仓库 -> return 1，
#   stderr 打印 ABORT 提示（自动部署绝不 git reset --hard 静默覆盖本地改动）
#   未跟踪文件(git status --short 里 ?? 开头的行)不影响判定——它们不会被 reset --hard 动，
#   不该被这道闸拦住(0929实测: mmv checkout长期有.cecelia/等未跟踪残留,不忽略会导致
#   这道闸永远触发,自动部署一次都跑不成功)。
check_clean_checkout() {
  local repo_dir="$1"
  local status
  if ! status="$(git -C "$repo_dir" status --short 2>/dev/null)"; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  local tracked_dirty
  tracked_dirty="$(printf '%s\n' "$status" | grep -v '^?? ' || true)"
  if [[ -n "$tracked_dirty" ]]; then
    echo "ABORT: mmv本地checkout不干净,已跳过自动部署,需人工检查" >&2
    return 1
  fi
  return 0
}

# 原仓仅提供objects和origin/main；独立SHA目录不切换用户分支、不清理现场。
prepare_deployment_checkout() {
  python3 - "$1" "$2" "${3:-$HOME/.local/share/zenithjoy/deploy-checkouts}" <<'PY'
import fcntl,os,re,subprocess,sys,json
from pathlib import Path

def git(root,*args):
 return subprocess.check_output(['git','-C',str(root),*args],text=True,stderr=subprocess.PIPE).strip()
def need(value,message):
 if not value:raise ValueError(message)
def canonical(path):return Path(path).resolve(strict=True)
def current(repo,sha):
 need(git(repo,'rev-parse','origin/main')==sha,'目标SHA已不是当前origin/main')
def clean(target):
 status=git(target,'status','--porcelain=v1','--untracked-files=all','--ignored=matching')
 if not status:return
 need(not git(target,'status','--porcelain=v1','--untracked-files=no'),'部署树已跟踪文件有改动；保留现场并拒绝')
 revision=git(target,'rev-parse','HEAD')
 fixed_lock=git(target,'show',revision+':.skills-source.json')
 need((target/'.skills-source.json').read_text().strip()==fixed_lock,'Skill锁已改变')
 lock=json.loads(fixed_lock);cache=target/'.skills-source'
 need(lock.get('repository')=='perfectuser21/zenithjoy-skills' and re.fullmatch('[0-9a-f]{40}',lock.get('revision','')),'Skill固定源无效')
 need(cache.is_dir() and not cache.is_symlink() and (cache/'.git').is_dir() and not (cache/'.git').is_symlink(),'缓存不是独立真实Git目录')
 need(canonical(git(cache,'rev-parse','--show-toplevel'))==cache,'缓存仓库根不符')
 need(git(cache,'rev-parse','HEAD')==lock['revision'],'缓存不是固定Skill提交')
 need(not git(cache,'status','--porcelain=v1','--untracked-files=all','--ignored=matching'),'Skill缓存有漂移或额外文件')
 catalog=json.loads(git(cache,'show',lock['revision']+':distribution/catalog.json'))
 entries=catalog['profiles'][lock['profile']]['files']
 allowed={entry['path'] for entry in entries}
 state=target/'.skills-source-state.json'
 if state.exists():
  need(not state.is_symlink(),'分发状态不能是软链')
  expected={entry['path']:entry['sha256'] for entry in entries}
  need(json.loads(state.read_text())=={'revision':lock['revision'],'files':expected},'分发状态不等于固定清单')
  allowed.add('.skills-source-state.json')
 # status collapses ignored directories; inspect every child rather than accepting a broad prefix.
 rows=subprocess.check_output(['git','-C',str(target),'status','--porcelain=v1','-z','--untracked-files=all','--ignored=matching']).decode().split('\0')
 for row in filter(None,rows):
  need(row[:2] in ('??','!!'),'部署树有非生成改动')
  relative=row[3:].rstrip('/')
  if relative=='.skills-source':continue
  path=target/relative
  need(not path.is_symlink(),'生成路径不能是软链')
  children=list(path.rglob('*')) if path.is_dir() else [path]
  for child in children:
   need(not child.is_symlink(),'生成路径不能含软链')
   if child.is_file():need(child.relative_to(target).as_posix() in allowed,'部署树有未知额外文件')
 bootstrap=git(target,'show',revision+':scripts/skills-source.py')
 code='__file__ = '+repr(str(target/'scripts/skills-source.py'))+'\n'+bootstrap
 env=os.environ.copy();env['PYTHONDONTWRITEBYTECODE']='1'
 subprocess.run(['python3','-c',code,'verify','--workspace',str(target),'--source',str(cache)],env=env,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

try:
 repo=canonical(sys.argv[1]);sha=sys.argv[2];base=Path(sys.argv[3]).absolute()
 need(re.fullmatch('[0-9a-f]{40}',sha),'非法部署SHA')
 need(canonical(git(repo,'rev-parse','--show-toplevel'))==repo,'源不是仓库根')
 need(git(repo,'remote','get-url','origin') in ('https://github.com/perfectuser21/zenithjoy-workspace.git','https://github.com/perfectuser21/zenithjoy-workspace','git@github.com:perfectuser21/zenithjoy-workspace.git'),'源仓库身份错误')
 current(repo,sha)
 need(base.resolve()==base,'部署根路径不能经软链')
 base.mkdir(mode=0o700,parents=True,exist_ok=True)
 need(base.stat().st_uid==os.getuid() and not base.stat().st_mode&0o022,'部署根属主或写权限不安全')
 fd=os.open(base/'.prepare.lock',os.O_CREAT|os.O_RDWR|getattr(os,'O_NOFOLLOW',0),0o600)
 with os.fdopen(fd,'w') as guard:
  fcntl.flock(guard,fcntl.LOCK_EX)
  current(repo,sha);target=base/sha
  need(not target.is_symlink(),'部署目标不能是软链')
  if not target.exists():
   subprocess.run(['git','-C',str(repo),'worktree','add','--detach',str(target),sha],check=True,stdout=sys.stderr)
  need(canonical(target)==target and target.stat().st_uid==os.getuid(),'部署目标路径或属主不同')
  need(canonical(git(target,'rev-parse','--show-toplevel'))==target,'部署目标不是独立仓库根')
  need(canonical(git(target,'rev-parse','--path-format=absolute','--git-common-dir'))==canonical(git(repo,'rev-parse','--path-format=absolute','--git-common-dir')),'部署目标不是原仓共同Git目录')
  registered=git(repo,'worktree','list','--porcelain').splitlines()
  need('worktree '+str(target) in registered,'部署目标未登记为原仓worktree')
  need(subprocess.run(['git','-C',str(target),'symbolic-ref','-q','HEAD'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==1,'部署目标不是detached HEAD')
  need(git(target,'rev-parse','HEAD')==sha,'部署目标HEAD不符')
  clean(target);current(repo,sha)
  print(target)
except (OSError,ValueError,subprocess.SubprocessError) as error:
 print('ABORT: 独立部署checkout校验失败: '+str(error),file=sys.stderr);sys.exit(1)
PY
}
