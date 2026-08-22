#!/usr/bin/env bash
# 路② 协同笔记 静态守卫 —— 把 DoD [ARTIFACT] 的机检左移到 CI（形状漂移即红）。
# 判据：白名单单一实现被 HTTP 保存 + collab-ws 两处同 import / collab-ws 挂载 / 依赖锁 /
#       接线三件套 / migration DDL / spec 零请求拦截。
set -euo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)"

fail() { echo "❌ [collab-notes-smoke] $1" >&2; exit 1; }

echo "[collab-notes-smoke] ① migration DDL（documents + document_members + 关键字段）"
node -e "const fs=require('fs'),d='apps/api/db/migrations';const f=fs.readdirSync(d).filter(n=>/documents|collab_notes|collaborative/.test(n)&&n.endsWith('.sql'));if(!f.length)process.exit(1);const c=f.map(n=>fs.readFileSync(d+'/'+n,'utf8')).join('\n');for(const r of [/CREATE TABLE[^;]*zenithjoy\.documents/i,/org_id[^;]*NOT NULL/i,/crdt_state\s+bytea/i,/content\s+jsonb/i,/ai_retrieval_opt_out\s+bool(ean)?[^;]*DEFAULT\s+false/i,/deleted_at/i,/zenithjoy\.document_members/i])if(!r.test(c))process.exit(1)" || fail "migration DDL 缺字段"

echo "[collab-notes-smoke] ② 白名单单一实现被 HTTP 保存 + collab-ws 两处同 import"
node -e "const fs=require('fs');if(!fs.existsSync('apps/api/src/workbench/document-schema.ts'))process.exit(1);const files=['apps/api/src/workbench/document.service.ts','apps/api/src/services/collab-ws.ts'].filter(p=>fs.existsSync(p));if(files.length<2)process.exit(1);for(const p of files){if(!/document-schema/.test(fs.readFileSync(p,'utf8')))process.exit(1)}" || fail "白名单未被两处同 import"

echo "[collab-notes-smoke] ③ collab-ws 挂载（/collab-ws + attachCollabWS(server)）"
node -e "const fs=require('fs');if(!/\/collab-ws/.test(fs.readFileSync('apps/api/src/services/collab-ws.ts','utf8')))process.exit(1);if(!/attachCollabWS\s*\(\s*server\s*\)/.test(fs.readFileSync('apps/api/src/index.ts','utf8')))process.exit(1)" || fail "collab-ws 未挂载"

echo "[collab-notes-smoke] ④ 依赖锁（staff-hub tiptap 3.x + yjs + y-prosemirror；api yjs + y-prosemirror）"
node -e "const p=require('./apps/staff-hub/package.json'),d={...p.dependencies,...p.devDependencies};for(const k of ['@tiptap/react','@tiptap/starter-kit','@tiptap/extension-image','@tiptap/extension-link','@tiptap/extension-collaboration','@tiptap/extension-collaboration-cursor','yjs','y-prosemirror'])if(!d[k])process.exit(1);if(!/3\./.test(d['@tiptap/react']))process.exit(1)" || fail "staff-hub 依赖锁不全"
node -e "const p=require('./apps/api/package.json'),d={...p.dependencies,...p.devDependencies};if(!d['yjs']||!d['y-prosemirror'])process.exit(1)" || fail "api 缺 yjs/y-prosemirror"

echo "[collab-notes-smoke] ⑤ 接线三件套（vitest config + test:collab-notes + dod-run.sh）"
node -e "const fs=require('fs');const p='apps/api/vitest.collab-notes.config.ts';if(!fs.existsSync(p))process.exit(1);if(!fs.readFileSync(p,'utf8').includes('sprints/08221200-line11-path2-collab-notes/tests'))process.exit(1);const s=require('./apps/api/package.json').scripts||{};if(!s['test:collab-notes'])process.exit(1);if(!fs.existsSync('sprints/08221200-line11-path2-collab-notes/dod-run.sh'))process.exit(1)" || fail "接线三件套不全"

echo "[collab-notes-smoke] ⑥ CRDT spec 零请求拦截（变体C 死规则）+ 四断言关键字"
node -e "const c=require('fs').readFileSync('apps/staff-hub/e2e/collab-notes-crdt.spec.ts','utf8');if(/page\.route|context\.route|fulfill\(/.test(c))process.exit(1);for(const s of ['newContext','cursor','setOffline','private'])if(!c.toLowerCase().includes(s.toLowerCase()))process.exit(1)" || fail "spec 有请求拦截或缺断言关键字"

echo "[collab-notes-smoke] ⑦ G2 备份演练脚本 + cron 引用"
node -e "const fs=require('fs');const drill='sprints/08221200-line11-path2-collab-notes/backup-restore-drill.sh';if(!fs.existsSync(drill))process.exit(1);const c=fs.readFileSync(drill,'utf8');if(!/documents/.test(c)||!/pg_dump|pg_restore/.test(c))process.exit(1);const wf=fs.existsSync('.github/workflows/db-backup.yml')?fs.readFileSync('.github/workflows/db-backup.yml','utf8'):'';if(!/documents|collab|backup-restore-drill/.test(wf))process.exit(1)" || fail "G2 备份演练脚本/cron 引用缺失"

echo "✅ [collab-notes-smoke] 全部静态守卫通过"
