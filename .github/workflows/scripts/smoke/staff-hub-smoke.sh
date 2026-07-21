#!/usr/bin/env bash
set -euo pipefail

echo "== staff-hub smoke =="
node scripts/check-staff-hub-llm-imports.mjs
test -f apps/staff-hub/src/App.tsx
test -f apps/staff-hub/src/pages/SkillEvalPage.tsx
test -f apps/staff-hub/src/pages/PathHealthPage.tsx
node -e "const fs=require('fs');const c=fs.readFileSync('apps/dashboard/src/config/navigation.config.ts','utf8');if(c.includes('/staff/skill-eval'))process.exit(1);console.log('dashboard route removed')"
echo "staff-hub smoke: PASS"
