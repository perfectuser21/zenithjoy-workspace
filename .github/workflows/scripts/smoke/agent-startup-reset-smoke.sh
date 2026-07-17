#!/usr/bin/env bash
# agent-startup-reset-smoke.sh
#
# startup-reset 启动归零 smoke——API 层等价断言 + proven-to-fire。
# 真机操作（taskkill/powershell/schtasks）在 CI Linux 下不可用，
# 改用注入 deps 的执行层验证和纯函数层断言。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/services/agent"

PASS=0
FAIL=0
assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected='$2', got='$1')"; FAIL=$((FAIL+1)); fi
}

# 把实现日志引走到 stderr，只让断言值流入 stdout
NODE_PREAMBLE="const _origCL=console.log; console.log=(...a)=>process.stderr.write(a.join(' ')+'\n'); console.warn=(...a)=>process.stderr.write(a.join(' ')+'\n');"

echo "=== 0: 编译 services/agent（产出 dist/startup-reset.js）==="
npm run build 2>/tmp/zj-startup-reset-build.log || {
  echo "FAIL: build 失败"
  cat /tmp/zj-startup-reset-build.log
  exit 1
}
test -f dist/startup-reset.js || { echo "FAIL: dist/startup-reset.js 不存在"; exit 1; }
echo "  PASS: build OK, dist/startup-reset.js 存在"

echo "=== 1: 干净状态 → planStartupReset 返回空清单（幂等）==="
EMPTY=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const clean={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:1,
  pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
process.stdout.write(String(m.planStartupReset(clean).length));
" 2>/dev/null)
assert "$EMPTY" "0" "干净状态 planStartupReset 返回空清单"

echo "=== 2: 孤儿 RPA → kill_orphan_rpa ==="
ORPHAN=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const state={selfPid:1,isCI:false,
  orphanRpaProcs:[{pid:1234,cmdline:'python listen_chat.py'}],
  weixinTopLevelCount:1,pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
const n=m.planStartupReset(state).filter(a=>a.type==='kill_orphan_rpa').length;
process.stdout.write(String(n));
" 2>/dev/null)
assert "$ORPHAN" "1" "孤儿 RPA → kill_orphan_rpa × 1"

echo "=== 2b: 微信堆积 → kill_extra_weixin_tree ==="
WEIXIN=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const state={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:3,
  pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
const has=m.planStartupReset(state).some(a=>a.type==='kill_extra_weixin_tree');
process.stdout.write(String(has));
" 2>/dev/null)
assert "$WEIXIN" "true" "微信顶层树 > 1 → kill_extra_weixin_tree"

echo "=== 2c: 残骸文件 + 计划任务 + 锁文件 → 对应动作 ==="
WRECKAGE=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const state={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:1,
  pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:['f1','f2'],staleScheduledTasks:['ZJDbg001'],staleLockFiles:['lock1']};
const actions=m.planStartupReset(state);
const df=actions.filter(a=>a.type==='delete_wreckage_file').length;
const dt=actions.filter(a=>a.type==='delete_stale_task').length;
const dl=actions.filter(a=>a.type==='delete_stale_lock').length;
process.stdout.write(df+'|'+dt+'|'+dl);
" 2>/dev/null)
assert "$WRECKAGE" "2|1|1" "残骸 2 文件 1 任务 1 锁"

echo "=== 3: executeStartupReset 干净状态 → 4 步全 pass ==="
ALL_PASS=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const clean={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:1,
  pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
const r=m.executeStartupReset(clean,{});
const ok=r.items.every(i=>i.status==='pass');
process.stdout.write(ok+'|'+r.items.length);
" 2>/dev/null)
assert "$ALL_PASS" "true|4" "干净状态 4 步全 pass"

echo "=== 4: proven-to-fire — python-embedded 缺失 → env_check status=fail ==="
ENV_FAIL=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const dirty={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:1,
  pythonEmbeddedExists:false,
  configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
const r=m.executeStartupReset(dirty,{});
const s=r.items.find(i=>i.step==='env_check');
process.stdout.write(s.status+'|'+String(s.detail&&s.detail.includes('python-embedded')));
" 2>/dev/null)
assert "$ENV_FAIL" "fail|true" "proven-to-fire: python-embedded 缺失 → env_check fail"

echo "=== 4b: proven-to-fire — config 不一致 → env_check status=fail ==="
ENV_CFG=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const dirty={selfPid:1,isCI:false,orphanRpaProcs:[],weixinTopLevelCount:1,
  pythonEmbeddedExists:true,
  configConsistencyOk:false,configConsistencyDetail:'apiUrl mismatch: .env=ws://a config.json=ws://b',
  wreckageFiles:[],staleScheduledTasks:[],staleLockFiles:[]};
const r=m.executeStartupReset(dirty,{});
const s=r.items.find(i=>i.step==='env_check');
process.stdout.write(s.status+'|'+String(s.detail&&s.detail.includes('mismatch')));
" 2>/dev/null)
assert "$ENV_CFG" "fail|true" "proven-to-fire: config 不一致 → env_check fail"

echo "=== 5: CI 模式 — isCI=true → kill/delete 不执行 ==="
CI_MODE=$(node -e "$NODE_PREAMBLE
const m=require('./dist/startup-reset.js');
const dirty={selfPid:1,isCI:true,
  orphanRpaProcs:[{pid:9999,cmdline:'python listen_chat.py'}],
  weixinTopLevelCount:2,
  pythonEmbeddedExists:true,configConsistencyOk:true,configConsistencyDetail:'',
  wreckageFiles:['C:\\\\u\\\\zj-x.txt'],staleScheduledTasks:['ZJDbg001'],staleLockFiles:[]};
let killCalled=false;
const r=m.executeStartupReset(dirty,{killPid:()=>{killCalled=true;},deleteFile:()=>{killCalled=true;}});
const orphan=r.items.find(i=>i.step==='orphan_rpa');
const wreckage=r.items.find(i=>i.step==='wreckage_cleanup');
process.stdout.write(r.ciMode+'|'+killCalled+'|'+orphan.actionsExecuted+'|'+wreckage.actionsExecuted);
" 2>/dev/null)
assert "$CI_MODE" "true|false|0|0" "CI 模式 plan-only: ciMode=true, 未执行 kill/delete"

echo ""
echo "=== Smoke 结果：PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
