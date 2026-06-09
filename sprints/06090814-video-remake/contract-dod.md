---
skeleton: false
journey_type: user_facing
target_environment: local_api
---
# Contract DoD — Sprint: Line 07 AI 爆款视频翻拍 · 9 节点画布 thin 骨架

**范围**: `services/video-remake/server.py`（FastAPI 主入口 /health + /api/nodes + 9 个节点路由）+ `services/video-remake/requirements.txt` + `services/video-remake/frontend/src/App.tsx`（React Flow 9 节点画布）+ `services/video-remake/frontend/package.json` + `.github/workflows/scripts/smoke/line07-video-remake-smoke.sh`
**大小**: M

---

## ARTIFACT 条目

- [ ] [ARTIFACT] `services/video-remake/server.py` 存在，含 FastAPI 应用初始化 + /health + /api/nodes + static 文件服务
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/server.py','utf8');if(!c.includes('/health'))process.exit(1);if(!c.includes('/api/nodes'))process.exit(1);if(!c.includes('FastAPI')&&!c.includes('fastapi'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/video-remake/requirements.txt` 存在，含 fastapi + uvicorn + ffmpeg-python
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/requirements.txt','utf8');if(!c.includes('fastapi'))process.exit(1);if(!c.includes('uvicorn'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/video-remake/frontend/src/App.tsx` 存在，含 React Flow + 9 个节点定义（至少 9 个 id 为 01–09 的节点）
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/frontend/src/App.tsx','utf8');if(!c.includes('ReactFlow')&&!c.includes('react-flow'))process.exit(1);const ids=['01','02','03','04','05','06','07','08','09'];ids.forEach(id=>{if(!c.includes(id))process.exit(1);});console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/line07-video-remake-smoke.sh` 存在，含实质 curl 调用（≥5 行非注释内容）
  Test: node -e "const fs=require('fs');const p='.github/workflows/scripts/smoke/line07-video-remake-smoke.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');const lines=c.split('\n').filter(l=>l.trim()&&!l.startsWith('#'));if(lines.length<5)process.exit(1);if(!c.includes('curl'))process.exit(1);if(!c.includes('8899'))process.exit(1);console.log('OK lines='+lines.length)"

- [ ] [ARTIFACT] `services/video-remake/frontend/package.json` 存在，含 reactflow 或 react-flow-renderer 依赖
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/frontend/package.json','utf8');if(!c.includes('reactflow')&&!c.includes('react-flow'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（内嵌可执行 manual:bash 命令，evaluator 直接跑）

- [ ] [BEHAVIOR] `/health` 路由返回 `{"status":"ok"}` — server.py 含 status 字段值 ok 的 health 响应（对应 Golden Path Step 1）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/video-remake/server.py\",\"utf8\");if(!c.includes(\"/health\"))process.exit(1);if(!c.includes(\"status\")&&!c.includes(\"status\"))process.exit(1);if(!c.includes(\"\\\"ok\\\"\")&&!c.includes(\"'"'"'ok'"'"'\"))process.exit(1);console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] `/api/nodes` 路由返回含 id/label/status/order 字段的 9 节点数组 — server.py 含 9 个节点定义且含 4 个必填字段（对应 Golden Path Step 3，PRD `/api/nodes` 节点数 = 9）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/video-remake/server.py\",\"utf8\");if(!c.includes(\"/api/nodes\"))process.exit(1);[\"id\",\"label\",\"status\",\"order\"].forEach(f=>{if(!c.includes(f)){console.error(\"FAIL: server.py 缺字段\"+f);process.exit(1);}});const matches=(c.match(/\\\"0[1-9]\\\"/g)||c.match(\"'\''0[1-9]'\''\")||[]);if(matches.length<9){console.error(\"FAIL: 节点数\"+matches.length+\"<9\");process.exit(1);}console.log(\"OK nodes=\"+matches.length)"'
  期望: OK

- [ ] [BEHAVIOR] `POST /api/nodes/{node_id}/confirm` 路由返回含 ok/node_id/status 字段的响应，禁用 success/state（对应 Golden Path Step 4，PRD node confirm 操作）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/video-remake/server.py\",\"utf8\");if(!c.includes(\"confirm\"))process.exit(1);if(!c.includes(\"\\\"ok\\\"\")&&!c.includes(\"ok:\")&&!c.includes(\"ok =\"))process.exit(1);if(!c.includes(\"node_id\"))process.exit(1);if(!c.includes(\"status\"))process.exit(1);const hasSuccess=(c.match(/[\"'"'"']success[\"'"'"']/)||[]).length;if(hasSuccess>0){console.error(\"FAIL: 含禁用字段 success\");process.exit(1);}const hasState=(c.match(/[\"'"'"']state[\"'"'"']/)||[]).length;if(hasState>0){console.error(\"FAIL: 含禁用字段 state\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] 不存在的 node_id（99 等）confirm 请求返回 404 — server.py 含节点 id 验证逻辑（对应 Golden Path Step 5，防假绿：无验证逻辑则任意 node_id 都返回 200）
  Test: manual:bash -c 'node -e "const c=require(\"fs\").readFileSync(\"services/video-remake/server.py\",\"utf8\");const has404=(c.includes(\"404\")||c.includes(\"status_code=404\")||c.includes(\"HTTPException\"));if(!has404){console.error(\"FAIL: server.py 无 404 错误处理\");process.exit(1);}const hasNodeCheck=(c.includes(\"not in \")&&c.includes(\"node_id\"))||(c.includes(\"node_id not in\")||(c.includes(\"raise\")));if(!hasNodeCheck){console.error(\"FAIL: 缺节点 id 验证逻辑\");process.exit(1);}console.log(\"OK\")"'
  期望: OK

- [ ] [BEHAVIOR] smoke 脚本存在且实质覆盖 3 个 PRD 断言（/health status=ok，/api/nodes len=9，/ HTTP 200）— 非 exit 0 占位（对应 PRD E2E smoke 验收标准）
  Test: manual:bash -c 'SMOKE=".github/workflows/scripts/smoke/line07-video-remake-smoke.sh"; [ -f "$SMOKE" ] || { echo "FAIL: smoke 脚本不存在"; exit 1; }; grep -q "status" "$SMOKE" || { echo "FAIL: smoke 缺 status 验证"; exit 1; }; grep -q "len\|length\|9" "$SMOKE" || { echo "FAIL: smoke 缺节点数量验证"; exit 1; }; grep -q "200" "$SMOKE" || { echo "FAIL: smoke 缺 HTTP 200 验证"; exit 1; }; REAL=$(grep -v "^#" "$SMOKE" | grep -v "^[[:space:]]*$" | wc -l | tr -d " "); [ "$REAL" -ge 5 ] || { echo "FAIL: smoke 实质内容仅 $REAL 行（需≥5）"; exit 1; }; echo "OK real_lines=$REAL"'
  期望: OK real_lines=...

---

## BEHAVIOR:E2E 条目（local_api user_facing，final-e2e 跑 — 见 contract-draft.md E2E 验收脚本）

- [ ] [BEHAVIOR:E2E] 运行 `sprints/06090814-video-remake/contract-draft.md` 中的 E2E 脚本（或 `line07-video-remake-smoke.sh`），5 步全通 exit 0
  Test: 通过 `bash sprints/06090814-video-remake/e2e-smoke.sh` 触发（evaluator 本地执行，需 Python 3.10+ 和 ffmpeg-python 已安装）
  期望: exit 0 + "✅ Line 07 video-remake thin 骨架 Golden Path 验证通过"
