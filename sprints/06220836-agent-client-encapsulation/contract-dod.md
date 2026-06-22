---
skeleton: false
journey_type: agent_remote
target_environment: windows_cloud
---
# Contract DoD — Sprint: Agent 客户端封装（去黑窗 + 托盘静默通知）

**范围**: start.vbs 无窗口入口 + 单实例 + launch.log 轮转；tray.ts showModuleError 弃 powershell 改 node-notifier/降级红点；install-autostart.ps1 指向 start.vbs；build-install-pack.sh 打包 start.vbs；package.json 加 node-notifier 依赖；start.bat 加 ZJ_LAUNCH_PROBE 测试守卫；smoke。
**大小**: M
**接缝提示**: 视觉"无黑窗"/"图形通知弹出"/"重启自起"为接缝（GHA headless 不可视觉验），机制层在本 DoD 真验；视觉/重启接缝在真目标（xian-pc）验前标 `logic-done-pending`（见 contract-draft.md 接缝清单 S1/S2/S3）。

## ARTIFACT 条目

- [ ] [ARTIFACT] start.vbs 无窗口启动入口存在
  Test: node -e "const c=require('fs').readFileSync('services/agent/install-pack/start.vbs','utf8');if(!c.includes('start.bat'))process.exit(1)"

- [ ] [ARTIFACT] smoke 脚本存在且有实质内容
  Test: node -e "const c=require('fs').readFileSync('.github/workflows/scripts/smoke/agent-client-encapsulation-smoke.sh','utf8');if(!c.includes('start.vbs')||c.split('\n').length<10)process.exit(1)"

- [ ] [ARTIFACT] e2e-verify.ps1 存在（GHA windows-latest E2E）
  Test: node -e "const c=require('fs').readFileSync('sprints/06220836-agent-client-encapsulation/e2e-verify.ps1','utf8');if(!c.includes('start.vbs')||!c.includes('ZJ_LAUNCH_PROBE'))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 直接跑；journey_type=agent_remote 源码行为层 + 启动机制层）

- [ ] [BEHAVIOR] start.vbs 用 windowStyle=0 隐藏窗口拉起 start.bat（无黑窗机制根因）
  Test: manual:bash -c 'F=services/agent/install-pack/start.vbs; grep -Eq "\.Run\b.*,[[:space:]]*0[[:space:]]*," "$F" && grep -q "start\.bat" "$F" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] start.vbs 单实例守卫——已运行则跳过不重复拉起
  Test: manual:bash -c 'F=services/agent/install-pack/start.vbs; grep -q "Win32_Process" "$F" && grep -q "zenithjoy-agent\.exe" "$F" && grep -Eqi "Quit|skip|already" "$F" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] start.vbs launch.log 大小轮转（防无限增长）
  Test: manual:bash -c 'F=services/agent/install-pack/start.vbs; grep -q "launch\.log" "$F" && grep -Eq "1048576|\.Size|GetFile" "$F" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] tray.ts 彻底删除 powershell 通知路径（去黑窗硬保证，命中数=0）
  Test: manual:bash -c 'if grep -q "powershell" services/agent/src/tray.ts; then echo "FAIL: tray.ts 仍含 powershell"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] tray.ts showModuleError 走 node-notifier + 降级路径（红点/日志，不回退 powershell）
  Test: manual:bash -c 'F=services/agent/src/tray.ts; grep -q "node-notifier" "$F" && grep -q "showModuleError" "$F" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] 运行期：showModuleError 任何分支都不 spawn powershell 进程（真实行为）
  Test: manual:bash -c 'cd services/agent && npx tsx -e '"'"'const cp=require("node:child_process");let ps=false;const w=(f)=>(...a)=>{if(/powershell/i.test(String(a[0]||"")))ps=true;return{on(){},unref(){}};};cp.execFile=w();cp.spawn=w();cp.exec=w();const t=require("./src/tray.ts");t.showModuleError("微信 AI 客服","需要安装微信");if(ps){console.error("FAIL");process.exit(1);}console.log("OK");'"'"' || exit 1'
  期望: OK

- [ ] [BEHAVIOR] install-autostart.ps1 开机自启目标指向 start.vbs（非 start.bat）
  Test: manual:bash -c 'F=services/agent/install-pack/install-autostart.ps1; grep -q "start\.vbs" "$F" || exit 1; if grep -Eq "Target\s*=.*start\.bat'"'"'" "$F"; then echo "FAIL: 仍指 start.bat"; exit 1; fi; echo OK'
  期望: OK

- [ ] [BEHAVIOR] build-install-pack.sh 把 start.vbs 拷进产物（客户拿到的包含 start.vbs）
  Test: manual:bash -c 'grep -q "install-pack/start\.vbs" services/agent/scripts/build-install-pack.sh || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] package.json dependencies 含 node-notifier
  Test: manual:bash -c 'node -e '"'"'const p=require("./services/agent/package.json");if(!(p.dependencies&&p.dependencies["node-notifier"]))process.exit(1)'"'"' || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] start.bat 含 ZJ_LAUNCH_PROBE 测试守卫（E2E 真跑 vbs→bat 链而不挂死，且不破坏既有单实例 kill 回归）
  Test: manual:bash -c 'F=services/agent/install-pack/start.bat; grep -q "ZJ_LAUNCH_PROBE" "$F" && grep -q "Get-Process -Name zenithjoy-agent" "$F" || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] start.vbs 含错误处理 + 拉起失败写 launch.log 留痕（PRD 边界#2，供报修；风险 R2 缓解）
  Test: manual:bash -c 'F=services/agent/install-pack/start.vbs; grep -Eqi "On Error|Err\.|ERROR" "$F" && grep -q "launch\.log" "$F" || exit 1; echo OK'
  期望: OK
