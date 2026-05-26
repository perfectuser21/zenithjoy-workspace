#!/usr/bin/env bash
# admin-platform-sessions-pages-smoke.sh — AdminPlatformSessionsPage + AdminPublishLogsPage frontend smoke
#
# 验证:
#   1. AdminPlatformSessionsPage.tsx 含必填字段 + testid + 无禁用 status 值
#   2. AdminPublishLogsPage.tsx 含必填字段 + searchParams + publish-logs-table-row
#   3. navigation.config.ts pageComponents 含两个懒加载映射
set -euo pipefail

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  admin-platform-sessions-pages smoke"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo "[1] AdminPlatformSessionsPage.tsx — 字段 + testid + 无禁用 status"
node -e "
const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminPlatformSessionsPage.tsx','utf8');
['platform-sessions','session_id','expires_at','platform','platform-sessions-table-row','session-status'].forEach(f=>{
  if(!c.includes(f)){console.error('FAIL: 缺字段/testid',f);process.exit(1)}
});
['valid','inactive'].forEach(v=>{
  if(c.includes(\"'\" + v + \"'\")){console.error('FAIL: 含禁用 status 值',v);process.exit(1)}
});
console.log('  ✅ PASS');
"

echo "[2] AdminPublishLogsPage.tsx — 字段 + searchParams + testid"
node -e "
const c=require('fs').readFileSync('apps/dashboard/src/pages/AdminPublishLogsPage.tsx','utf8');
['publish-logs','log_id','work_id','created_at','tenant_id','publish-logs-table-row'].forEach(f=>{
  if(!c.includes(f)){console.error('FAIL: 缺字段/testid',f);process.exit(1)}
});
const hasSearchParams=c.includes('useSearchParams')||c.includes('URLSearchParams')||c.includes('searchParams')||c.includes('location.search');
if(!hasSearchParams){console.error('FAIL: 未读取 URL searchParams');process.exit(1)}
console.log('  ✅ PASS');
"

echo "[3] navigation.config.ts — pageComponents 懒加载映射"
node -e "
const c=require('fs').readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');
['AdminPlatformSessionsPage','AdminPublishLogsPage'].forEach(p=>{
  if(!c.includes(p)){console.error('FAIL: 缺懒加载映射',p);process.exit(1)}
});
console.log('  ✅ PASS');
"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ admin-platform-sessions-pages smoke PASSED"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
