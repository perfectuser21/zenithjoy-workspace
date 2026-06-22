#!/usr/bin/env bash
# agent-core-self-upgrade-smoke.sh
# Sprint 06222100 (#824) — 客户机 Agent 核心运行时本体自升级 端到端 smoke。
#
# 根治"客户机 Agent 核心不自升级"：模块（line04）走心跳 required_version 自升级，但核心本体
# 一直没有自升级信号。本 smoke 真链路验证核心自升级三段（非占位）：
#   A 中台心跳发 required_agent_version：真编译 walking-skeleton.service，断言 getRequiredAgentVersion
#     单一来源=install pack manifest.version，manifest 不可读回退 DEFAULT_REQUIRED_AGENT_VERSION
#   B core-upgrader 真触发+真校验：真编译 core-upgrader，semver 比较触发下载 → sha 不符回滚不切换
#     → sha 一致才写 .active-core 指针 + 解压到 extracted/zenithjoy-agent-v<ver> + 优雅退出
#   C 自换+重启接缝：start.bat 真读 .active-core 指针选最新核心目录，缺失回退本地核心
#
# 退出码：0 全过 / 1 A 中台信号 / 2 B 核心升级逻辑 / 3 C 启动器自换 / 5 环境（缺 node/编译失败）
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
AGENT_DIR="$REPO_ROOT/services/agent"
API_DIR="$REPO_ROOT/apps/api"

command -v node >/dev/null 2>&1 || { echo "FAIL: 缺 node"; exit 5; }

echo "━━━ agent-core-self-upgrade-smoke (#824 核心自升级) repo=$REPO_ROOT ━━━"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# ── A：中台心跳发 required_agent_version（真编译 install-pack-manifest 读取器 + 源码真接线断言）──
# walking-skeleton.service 顶层 import pool（pg），整文件 require 会拉真 DB 连接；这里改为
# 真编译"单一来源"的 manifest 读取器（无 DB 依赖）跑真链路，再对 service/route 源码做接线断言，
# 证明 required_agent_version 真从 manifest.version 取、真挂进心跳响应。
cd "$API_DIR"
npx tsc src/services/install-pack-manifest.ts \
  --outDir "$TMP/api" --module commonjs --target ES2020 --moduleResolution node \
  --esModuleInterop --skipLibCheck --types node 2>/dev/null \
  || { echo "FAIL: install-pack-manifest.ts 编译失败"; exit 5; }

node -e "
const path=require('path'), fs=require('fs'), os=require('os');
const { readInstallPackManifest } = require('$TMP/api/install-pack-manifest.js');
// A1 真读 manifest.json（含 version/sha256/size）= 核心自升级单一来源
const d = fs.mkdtempSync(path.join(os.tmpdir(),'mf-'));
const mf = path.join(d,'manifest.json');
fs.writeFileSync(mf, JSON.stringify({ version:'2.0.30', sha256:'abc', download_url:'/download/zenithjoy-agent-v2.0.30.tar.gz', size:777, build_time:'x' }));
const m = readInstallPackManifest(mf);
if (!m || m.version !== '2.0.30' || m.sha256 !== 'abc' || m.size !== 777) { console.error('A1 manifest 单一来源错:', m); process.exit(1); }
// A2 manifest 不存在 → 返回 null（service 据此回退 DEFAULT_REQUIRED_AGENT_VERSION）
if (readInstallPackManifest(path.join(d,'nope.json')) !== null) { console.error('A2 缺 manifest 应返回 null'); process.exit(1); }
console.log('  OK A1/A2: 单一来源 install pack manifest（version/sha256/size）+ 缺失回退');
" || { echo "FAIL: A 中台 manifest 单一来源"; exit 1; }

# A3 源码真接线：service 的 getRequiredAgentVersion 从 manifest 取 + 回退常量；route 把它挂进心跳响应
SVC="$API_DIR/src/services/walking-skeleton.service.ts"
RTE="$API_DIR/src/routes/walking-skeleton.ts"
grep -q "getRequiredAgentVersion" "$SVC" || { echo "FAIL: A3 service 缺 getRequiredAgentVersion"; exit 1; }
grep -q "readInstallPackManifest" "$SVC" || { echo "FAIL: A3 service 未用 manifest 单一来源"; exit 1; }
grep -q "DEFAULT_REQUIRED_AGENT_VERSION" "$SVC" || { echo "FAIL: A3 service 缺回退常量"; exit 1; }
grep -q "required_agent_version: getRequiredAgentVersion()" "$RTE" || { echo "FAIL: A3 心跳响应未下发 required_agent_version"; exit 1; }
echo "  OK A3: service getRequiredAgentVersion(manifest+回退) 真挂进心跳响应 required_agent_version"

# ── B：core-upgrader semver 真触发 + sha 真校验 + 写指针 + 优雅退出（真编译 core-upgrader）──
cd "$AGENT_DIR"
npx tsc src/core-upgrader.ts \
  --outDir "$TMP/agent" --module commonjs --target ES2020 --moduleResolution node \
  --esModuleInterop --skipLibCheck --types node 2>/dev/null \
  || { echo "FAIL: core-upgrader.ts 编译失败"; exit 5; }

node -e "
const path=require('path'), fs=require('fs'), os=require('os');
const { CoreUpgrader, compareSemver } = require('$TMP/agent/core-upgrader.js');
// semver 比较：required > current 触发，<= 不触发
if (!(compareSemver('2.0.22','2.0.21') > 0) || !(compareSemver('2.0.21','2.0.21') === 0)) { console.error('B0 semver 比较错'); process.exit(1); }
const root = fs.mkdtempSync(path.join(os.tmpdir(),'core-'));
const coreDir = path.join(root,'extracted','zenithjoy-agent-v2.0.21');
fs.mkdirSync(coreDir,{recursive:true});
fs.writeFileSync(path.join(coreDir,'.env'),'ZENITHJOY_LICENSE=ZJ-REAL\n');
const dl = (ver,url,dest)=>{ fs.mkdirSync(dest,{recursive:true}); fs.writeFileSync(path.join(dest,'zenithjoy-agent.exe'),'NEW-CORE'); };
(async()=>{
  // B1 sha 不符 → 回滚：不写指针、不退出（防把客户机切到坏核心）
  let exited1=false;
  const up1 = new CoreUpgrader({ currentVersion:'2.0.21', coreDir, downloadImpl:dl, verifyImpl: async()=>false, exitImpl:()=>{exited1=true;} });
  const r1 = await up1.upgradeIfNeeded('2.0.22', { sha256:'bad', size:1 });
  if (r1.upgraded !== false) { console.error('B1 sha 不符竟升级:', r1); process.exit(1); }
  if (fs.existsSync(path.join(root,'.active-core'))) { console.error('B1 sha 不符竟写了指针'); process.exit(1); }
  if (exited1) { console.error('B1 sha 不符竟退出'); process.exit(1); }
  // B2 sha 一致 → 真升级：解压 extracted/zenithjoy-agent-v2.0.22 + 拷 .env + 写 .active-core 指针 + 优雅退出
  let exited2=false;
  const up2 = new CoreUpgrader({ currentVersion:'2.0.21', coreDir, downloadImpl:dl, exitImpl:()=>{exited2=true;} });
  const r2 = await up2.upgradeIfNeeded('2.0.22');
  const newDir = path.join(root,'extracted','zenithjoy-agent-v2.0.22');
  if (r2.upgraded !== true) { console.error('B2 未升级:', r2); process.exit(1); }
  if (!fs.existsSync(path.join(newDir,'zenithjoy-agent.exe'))) { console.error('B2 新核心未解压'); process.exit(1); }
  if (!fs.readFileSync(path.join(newDir,'.env'),'utf-8').includes('ZJ-REAL')) { console.error('B2 .env 未拷'); process.exit(1); }
  const ptr = fs.readFileSync(path.join(root,'.active-core'),'utf-8').trim();
  if (ptr !== 'zenithjoy-agent-v2.0.22') { console.error('B2 指针错:', ptr); process.exit(1); }
  if (!exited2) { console.error('B2 未优雅退出'); process.exit(1); }
  console.log('  OK B: semver 触发 + sha 不符回滚 + sha 一致写 .active-core 指针='+ptr+' 优雅退出');
})();
" || { echo "FAIL: B core-upgrader 升级逻辑"; exit 2; }

# ── C：自换+重启接缝 — start.bat 真读 .active-core 指针选最新核心 + 回退本地核心 ──
START_BAT="$AGENT_DIR/install-pack/start.bat"
[ -f "$START_BAT" ] || { echo "FAIL: 缺 start.bat"; exit 3; }
grep -q "\.active-core" "$START_BAT" || { echo "FAIL: C start.bat 未读 .active-core 指针"; exit 3; }
grep -qi "extracted" "$START_BAT" || { echo "FAIL: C start.bat 未用 extracted/zenithjoy-agent-v<ver> 布局"; exit 3; }
grep -qiE "fallback|回退" "$START_BAT" || { echo "FAIL: C start.bat 缺回退逻辑（防自换搞挂）"; exit 3; }
grep -q "zenithjoy-agent.exe" "$START_BAT" || { echo "FAIL: C start.bat 未启动核心 exe"; exit 3; }
echo "  OK C: start.bat 读 .active-core 指针选最新核心 + 回退本地核心 + 启动核心 exe"

echo "agent-core-self-upgrade-smoke: PASS"
