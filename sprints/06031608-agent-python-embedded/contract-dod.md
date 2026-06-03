---
skeleton: false
journey_type: user_facing
target_environment: windows_cloud
---
# Contract DoD — Sprint: Agent 安装包内置 Python-embedded + wechat-rpa v1.1.78

**范围**: build-install-pack.sh 加 Python 3.11 embeddable 下载/打包；start.bat 加讲述人解锁；wechat-rpa.ts handler 改用 python-embedded 优先；新增 smoke.sh；版本 bump 1.1.78
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/agent/scripts/build-install-pack.sh` 含 Python 3.11 embeddable 下载步骤
  Test: node -e "const c=require('fs').readFileSync('services/agent/scripts/build-install-pack.sh','utf8');if(!c.includes('python-embedded')||!c.includes('embeddable'))process.exit(1)"

- [ ] [ARTIFACT] `services/agent/install-pack/start.bat` 含讲述人解锁 PowerShell 命令
  Test: node -e "const c=require('fs').readFileSync('services/agent/install-pack/start.bat','utf8');if(!c.includes('Start-Process Narrator'))process.exit(1)"

- [ ] [ARTIFACT] `services/agent/src/handlers/wechat-rpa.ts` 含 python-embedded 路径引用
  Test: node -e "const c=require('fs').readFileSync('services/agent/src/handlers/wechat-rpa.ts','utf8');if(!c.includes('python-embedded'))process.exit(1)"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/agent-python-embedded-smoke.sh` 新建且有内容
  Test: node -e "const fs=require('fs');const p='.github/workflows/scripts/smoke/agent-python-embedded-smoke.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');if(!c.includes('python-embedded'))process.exit(2)"

- [ ] [ARTIFACT] `services/agent/package.json` 版本号为 `1.1.79`（CI Lint Agent Version Bump 强制再次 bump，原 contract 1.1.78 已在 PR #620 合并）
  Test: node -e "const v=require('./services/agent/package.json').version;if(v!=='1.1.79')process.exit(1)"

- [ ] [ARTIFACT] `sprints/06031608-agent-python-embedded/e2e-verify.ps1` 存在（windows_cloud 验收脚本）
  Test: node -e "require('fs').accessSync('sprints/06031608-agent-python-embedded/e2e-verify.ps1')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] build-install-pack.sh 含 Python 3.11 embeddable 下载且复制到安装包目录
  Test: manual:bash -c 'grep -q "python-embedded" services/agent/scripts/build-install-pack.sh && grep -q "embeddable" services/agent/scripts/build-install-pack.sh || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] start.bat 含讲述人解锁命令（Start-Process Narrator）与关闭命令（Stop-Process）
  Test: manual:bash -c 'grep -q "Start-Process Narrator" services/agent/install-pack/start.bat || exit 1; grep -q "Stop-Process" services/agent/install-pack/start.bat || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] wechat-rpa.ts handler 含 python-embedded/python.exe 路径优先逻辑 + python3 回退
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/wechat-rpa.ts\",\"utf8\");if(!c.includes(\"python-embedded\"))process.exit(1);if(!c.includes(\"python3\"))process.exit(2);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] smoke.sh 存在且至少 6 行实质内容（非占位 exit 0）
  Test: manual:bash -c 'SMOKE=".github/workflows/scripts/smoke/agent-python-embedded-smoke.sh"; [ -f "$SMOKE" ] || exit 1; REAL=$(grep -v "^#" "$SMOKE" | grep -v "^[[:space:]]*$" | wc -l | tr -d " "); [ "$REAL" -gt 5 ] || exit 1; echo OK'
  期望: OK

- [ ] [BEHAVIOR] wechat-rpa.ts 在 python-embedded 缺失时回退 python3（边界，非 FATAL）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/wechat-rpa.ts\",\"utf8\");if(!c.includes(\"python-embedded\"))process.exit(1);if(!(c.includes(\"'\''python3'\''\") || c.includes(\"\\\x22python3\\\x22\")))process.exit(2);console.log(\"OK - fallback exists\")"'
  期望: OK - fallback exists

- [ ] [BEHAVIOR] wechat-rpa.ts 的 startWechatListener 函数也使用 python-embedded 优先逻辑
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/agent/src/handlers/wechat-rpa.ts\",\"utf8\");const fnStart=c.indexOf(\"startWechatListener\");const fnBody=c.slice(fnStart,fnStart+500);if(!fnBody.includes(\"python-embedded\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

## BEHAVIOR:E2E 条目（windows_cloud user_facing，Mode B final-e2e 跑）

- [ ] [BEHAVIOR:E2E] windows_cloud PowerShell 静态验证 5 项全通
  Test: 通过 `.github/workflows/e2e-windows.yml` 触发，运行 `sprints/06031608-agent-python-embedded/e2e-verify.ps1`
  期望: exit 0，5 项检查均输出 ✅

## Risks（PRD ASSUMPTION 已知陷阱，Generator 必须处理）

| # | 风险 | Mitigation |
|---|---|---|
| R1 | python311._pth 未启用 site-packages → pip install 后 `import pywinauto` 失败 | build 脚本显式 patch _pth（追加 `import site`），再执行 pip install |
| R2 | pywinauto/pywin32 装到系统目录而非 embedded 内部 | `pip install --target ./python-embedded/Lib/site-packages`；安装后验证 `python-embedded/python.exe -c "import pywinauto"` exit 0 |
| R3 | Python embeddable 下载 URL 不稳定 | hardcode SHA256，下载后 `shasum -a 256 --check`，失败 build exit 1 |
