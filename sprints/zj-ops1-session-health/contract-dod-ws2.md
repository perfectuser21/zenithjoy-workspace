---
skeleton: false
journey_type: user_facing
---
# Contract DoD — Workstream 2: sync 脚本 8×4 矩阵 + windows-task-scheduler.xml

**范围**: 重构 sync-from-xian-rog.sh 覆盖 8 平台 × MAIN/SUB_1/SUB_2/SUB_3 共 32 账号；新建 windows-task-scheduler.xml（2hr sync + 45min 视频号心跳 + 4hr 其他平台心跳 + OnFailed trigger）
**大小**: M（~120 行净增）
**依赖**: Workstream 1 完成后（Secret 命名与 WS1 PLATFORMS 定义对齐）

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `scripts/sessions/sync-from-xian-rog.sh` 包含全部 8 平台的 sync 调用（含非抖音平台）
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8'); const p=['KUAISHOU','XIAOHONGSHU','SHIPINHAO','TOUTIAO','WEIBO','ZHIHU','GONGZHONGHAO']; const miss=p.filter(x=>!s.includes(x)); if(miss.length>0){console.error('FAIL:',miss);process.exit(1)}; console.log('OK: 8 平台覆盖')"

- [ ] [ARTIFACT] sync 脚本包含 SUB_1/SUB_2/SUB_3 账号类型（4 账号矩阵）
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/sync-from-xian-rog.sh','utf8'); ['SUB_1','SUB_2','SUB_3'].forEach(sub=>{if(!s.includes(sub)){console.error('FAIL: 缺',sub);process.exit(1)}}); console.log('OK: 4 账号类型覆盖')"

- [ ] [ARTIFACT] `scripts/sessions/windows-task-scheduler.xml` 文件存在
  Test: node -e "require('fs').accessSync('scripts/sessions/windows-task-scheduler.xml')" && echo OK

- [ ] [ARTIFACT] XML 含 3 种触发器时间间隔（PT2H + PT45M + PT4H）
  Test: node -e "const s=require('fs').readFileSync('scripts/sessions/windows-task-scheduler.xml','utf8'); if(!s.match(/PT2H|PT120M/)){console.error('FAIL: 缺 2hr');process.exit(1)}; if(!s.match(/PT45M/)){console.error('FAIL: 缺 45min');process.exit(1)}; if(!s.match(/PT4H|PT240M/)){console.error('FAIL: 缺 4hr');process.exit(1)}; console.log('OK: 3 种触发器存在')"

---

## BEHAVIOR 条目

- [ ] [BEHAVIOR] sync 脚本对 8 个非抖音平台均有同步逻辑（KUAISHOU_MAIN 等 Secret 名出现在脚本中）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\"); const secrets=[\"KUAISHOU_MAIN\",\"XIAOHONGSHU_MAIN\",\"SHIPINHAO_MAIN\",\"TOUTIAO_MAIN\",\"WEIBO_MAIN\",\"ZHIHU_MAIN\",\"GONGZHONGHAO_MAIN\"]; const miss=secrets.filter(x=>!s.includes(x)); if(miss.length>0){console.error(\"FAIL:\",miss);process.exit(1)}; console.log(\"OK: all MAIN secrets present\")"'
  期望: OK: all MAIN secrets present

- [ ] [BEHAVIOR] SSH 失败时 sync_one 跳过 `gh secret set`（保留上次 Secret 有效值），记入 failed 数组
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\"); const syncFn=s.match(/sync_one\s*\(\)([\s\S]*?)^}/m)?.[1]||s; if(!syncFn.match(/return\b|continue\b/)){console.error(\"FAIL: sync_one 无 early return（SSH失败应跳过 gh secret set）\");process.exit(1)}; console.log(\"OK: early return 存在\")"'
  期望: OK: early return 存在

- [ ] [BEHAVIOR] windows-task-scheduler.xml 含 `<OnFailed>` 或 `<OnFailure>` trigger（视频号心跳失败触发 sync）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/windows-task-scheduler.xml\",\"utf8\"); if(!s.match(/OnFailed|OnFailure/i)){console.error(\"FAIL: 缺 OnFailed/OnFailure trigger\");process.exit(1)}; console.log(\"OK: OnFailed trigger 存在\")"'
  期望: OK: OnFailed trigger 存在

- [ ] [BEHAVIOR] XML 含至少 3 个 `<Task>` 定义（2hr sync + 45min 视频号心跳 + 4hr 其他平台）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/windows-task-scheduler.xml\",\"utf8\"); const taskCount=(s.match(/<Task\b/gi)||[]).length; if(taskCount<3){console.error(\"FAIL: Task 数=\"+taskCount+\" <3\");process.exit(1)}; console.log(\"OK: Task 数=\"+taskCount)"'
  期望: OK: Task 数=3（或更多）

- [ ] [BEHAVIOR] Bark 告警在 failed 数组非空时触发（SSH 不通 → 告警，不静默退出）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\"); if(!s.match(/failed.*bark|bark.*failed|failed.*\\.length/is)){console.error(\"FAIL: 无 failed+bark 告警逻辑\");process.exit(1)}; console.log(\"OK: failed+bark 逻辑存在\")"'
  期望: OK: failed+bark 逻辑存在

- [ ] [BEHAVIOR] error path — 脚本不使用 `set -e` 在 sync_one 失败时直接退出（应继续同步其他账号）
  Test: manual:bash -c 'node -e "const s=require(\"fs\").readFileSync(\"scripts/sessions/sync-from-xian-rog.sh\",\"utf8\"); if(s.match(/sync_one[\s\S]{0,1000}set\s+-e/m)&&!s.match(/\(\s*\)/)){console.error(\"WARN: set -e 可能导致单账号失败退出整个脚本\");process.exit(1)}; console.log(\"OK\")"'
  期望: OK
