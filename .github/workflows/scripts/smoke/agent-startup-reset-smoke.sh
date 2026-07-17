#!/usr/bin/env bash
# agent-startup-reset-smoke.sh
#
# startup-reset 启动归零 smoke——API 层等价断言 + proven-to-fire。
# 实现归一在 bootstrap-convergence.ts（启动第零阶段，decision 391063ef 整合 #1364/#1365
# 并发实现后唯一正宗）。真机操作（taskkill/powershell/schtasks/setx）在 CI Linux 下
# 不可用，改用注入 deps 的执行层验证和纯函数层断言。
# 真机段等价断言：真删除/真 setx/微信收敛 → TODO 部署 rog 后人工 proven-to-fire。
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/services/agent"

PASS=0
FAIL=0
assert() {
  if [ "$1" = "$2" ]; then echo "  PASS: $3"; PASS=$((PASS+1));
  else echo "  FAIL: $3 (expected='$2', got='$1')"; FAIL=$((FAIL+1)); fi
}

# 把实现日志引走到 stderr，只让断言值流入 stdout
NODE_PREAMBLE="const _origCL=console.log; console.log=(...a)=>process.stderr.write(a.join(' ')+'\n'); console.warn=(...a)=>process.stderr.write(a.join(' ')+'\n');
const m=require('./dist/bootstrap-convergence.js');
const CLEAN={selfPid:1,selfAncestorPids:[999],agentProcesses:[{pid:1,imageName:'zenithjoy-agent.exe'}],launcherLoops:[],activeCoreName:null,scheduledTask:{exists:true,targetPath:null,targetExists:true},licensePresent:true,orphanRpaPythons:[],weixinTopLevelPids:[500],coreDirEnv:{expectedDir:'C:\\\\core',persisted:true},pythonEmbeddedPresent:true,envConfigConsistent:true,debrisFiles:[],staleOnceZjTasks:[],staleLockFiles:[]};"

echo "=== 0: 编译 services/agent（产出 dist/bootstrap-convergence.js）==="
npm run build 2>/tmp/zj-startup-reset-build.log || {
  echo "FAIL: build 失败"
  cat /tmp/zj-startup-reset-build.log
  exit 1
}
test -f dist/bootstrap-convergence.js || { echo "FAIL: dist/bootstrap-convergence.js 不存在"; exit 1; }
echo "  PASS: build OK, dist/bootstrap-convergence.js 存在"

echo "=== 1: 干净状态 → planConvergence 返回空清单（幂等）==="
EMPTY=$(node -e "$NODE_PREAMBLE
process.stdout.write(String(m.planConvergence(CLEAN).length));
" 2>/dev/null)
assert "$EMPTY" "0" "干净状态 planConvergence 返回空清单"

echo "=== 2: 孤儿 RPA python → kill_orphan_python ==="
ORPHAN=$(node -e "$NODE_PREAMBLE
const state={...CLEAN,orphanRpaPythons:[{pid:1234,script:'listen_chat.py'}]};
const n=m.planConvergence(state).filter(a=>a.type==='kill_orphan_python').length;
process.stdout.write(String(n));
" 2>/dev/null)
assert "$ORPHAN" "1" "孤儿 RPA → kill_orphan_python × 1"

echo "=== 2a: 孤儿判据=父死（decision 9edc14f2）——父活不入列 ==="
ALIVE=$(node -e "$NODE_PREAMBLE
const procs=[{pid:10,ppid:1000,cmd:'python.exe listen_chat.py --dryrun'}];
process.stdout.write(String(m.classifyOrphanRpaPythons(procs,new Set([1000])).length));
" 2>/dev/null)
assert "$ALIVE" "0" "父 PID 活（CI 同机 dryrun）→ 不判孤儿"

echo "=== 2b: 微信顶层树 > 1 → converge_wechat ==="
WEIXIN=$(node -e "$NODE_PREAMBLE
const has=m.planConvergence({...CLEAN,weixinTopLevelPids:[2,4]}).some(a=>a.type==='converge_wechat');
const single=m.planConvergence({...CLEAN,weixinTopLevelPids:[2]}).some(a=>a.type==='converge_wechat');
process.stdout.write(has+'|'+single);
" 2>/dev/null)
assert "$WEIXIN" "true|false" "顶层树 >1 → converge_wechat；=1 不动"

echo "=== 2c: 残骸文件 + 一次性 ZJ 任务 + 陈旧锁 → 对应 delete 动作 ==="
WRECKAGE=$(node -e "$NODE_PREAMBLE
const state={...CLEAN,debrisFiles:['f1','f2'],staleOnceZjTasks:['ZJDbg001'],staleLockFiles:['lock1']};
const actions=m.planConvergence(state);
const df=actions.filter(a=>a.type==='delete_debris').length;
const dt=actions.filter(a=>a.type==='delete_stale_task').length;
const dl=actions.filter(a=>a.type==='delete_stale_lock').length;
process.stdout.write(df+'|'+dt+'|'+dl);
" 2>/dev/null)
assert "$WRECKAGE" "2|1|1" "残骸 2 文件 1 任务 1 锁"

echo "=== 2d: 一次性 ZJ 任务三重判定——正式任务/混合触发器保守不删 ==="
ZJTASK=$(node -e "$NODE_PREAMBLE
const a=m.isStaleOnceZjTask('ZJDbg0708',['MSFT_TaskTimeTrigger']);
const b=m.isStaleOnceZjTask('ZenithJoyAgent',['MSFT_TaskTimeTrigger']);
const c=m.isStaleOnceZjTask('ZJDbg0708',['MSFT_TaskTimeTrigger','MSFT_TaskLogonTrigger']);
process.stdout.write(a+'|'+b+'|'+c);
" 2>/dev/null)
assert "$ZJTASK" "true|false|false" "ZJ once 可删；ZenithJoyAgent/混合触发器不删"

echo "=== 3: 干净状态 → buildStartupResetReport ok=true 含'干净' ==="
ALL_PASS=$(node -e "$NODE_PREAMBLE
const r=m.buildStartupResetReport(CLEAN,[],false);
process.stdout.write(r.ok+'|'+String(r.reason&&r.reason.includes('干净')));
" 2>/dev/null)
assert "$ALL_PASS" "true|true" "干净状态 checklist ok=true"

echo "=== 4: proven-to-fire — python-embedded 缺失 → 报红 ==="
ENV_FAIL=$(node -e "$NODE_PREAMBLE
const r=m.buildStartupResetReport({...CLEAN,pythonEmbeddedPresent:false},[],false);
process.stdout.write(r.ok+'|'+String(r.reason&&r.reason.includes('python-embedded')));
" 2>/dev/null)
assert "$ENV_FAIL" "false|true" "proven-to-fire: python-embedded 缺失 → ok=false"

echo "=== 4b: proven-to-fire — .env/config 指向不一致 → 报红 ==="
ENV_CFG=$(node -e "$NODE_PREAMBLE
const r=m.buildStartupResetReport({...CLEAN,envConfigConsistent:false},[],false);
process.stdout.write(r.ok+'|'+String(r.reason&&r.reason.includes('指向不一致')));
" 2>/dev/null)
assert "$ENV_CFG" "false|true" "proven-to-fire: config 不一致 → ok=false"

echo "=== 5: CI 模式 planOnly — kill/delete 零执行，checklist 带 plan-only 前缀 ==="
CI_MODE=$(node -e "$NODE_PREAMBLE
const state={...CLEAN,orphanRpaPythons:[{pid:9999,script:'listen_chat.py'}],weixinTopLevelPids:[2,4],debrisFiles:['C:\\\\u\\\\zj-x.txt'],staleOnceZjTasks:['ZJDbg001']};
const actions=m.planConvergence(state);
let sideEffects=0;
const deps={killPid:()=>{sideEffects++;},deleteFile:()=>{sideEffects++;},deleteTask:()=>{sideEffects++;},persistEnv:()=>{sideEffects++;},log:()=>{}};
const results=m.executeConvergence(actions,deps,{planOnly:true});
const notExecuted=results.filter(r=>!r.executed).length;
const r=m.buildStartupResetReport(state,results,true);
process.stdout.write(sideEffects+'|'+(notExecuted===actions.length)+'|'+String(r.reason&&r.reason.startsWith('plan-only(ci)')));
" 2>/dev/null)
assert "$CI_MODE" "0|true|true" "CI planOnly: 零副作用, 全部 executed=false, reason 带 plan-only(ci) 前缀"

echo ""
echo "=== Smoke 结果：PASS=$PASS FAIL=$FAIL ==="
[ "$FAIL" -eq 0 ]
