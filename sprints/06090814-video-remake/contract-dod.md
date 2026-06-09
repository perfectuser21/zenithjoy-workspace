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

- [ ] [ARTIFACT] `services/video-remake/requirements.txt` 存在，含 fastapi + uvicorn
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/requirements.txt','utf8');if(!c.includes('fastapi'))process.exit(1);if(!c.includes('uvicorn'))process.exit(1);console.log('OK')"

- [ ] [ARTIFACT] `services/video-remake/frontend/src/App.tsx` 存在，含 React Flow + 9 个节点定义（节点 id 01–09 均出现）
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/frontend/src/App.tsx','utf8');if(!c.includes('ReactFlow')&&!c.includes('react-flow'))process.exit(1);const ids=['01','02','03','04','05','06','07','08','09'];ids.forEach(id=>{if(!c.includes(id))process.exit(1);});console.log('OK')"

- [ ] [ARTIFACT] `.github/workflows/scripts/smoke/line07-video-remake-smoke.sh` 存在，含实质 curl 调用（≥5 行非注释内容）
  Test: node -e "const fs=require('fs');const p='.github/workflows/scripts/smoke/line07-video-remake-smoke.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');const lines=c.split('\n').filter(l=>l.trim()&&!l.startsWith('#'));if(lines.length<5)process.exit(1);if(!c.includes('curl'))process.exit(1);if(!c.includes('8899'))process.exit(1);console.log('OK lines='+lines.length)"

- [ ] [ARTIFACT] `services/video-remake/frontend/package.json` 存在，含 reactflow 或 react-flow-renderer 依赖
  Test: node -e "const c=require('fs').readFileSync('services/video-remake/frontend/package.json','utf8');if(!c.includes('reactflow')&&!c.includes('react-flow'))process.exit(1);console.log('OK')"

---

## BEHAVIOR 条目（运行时 API 验证，evaluator 直接跑 pytest — server 由 tests/test_api.py session fixture 自动启动）

> **注**：pytest 测试通过 session-scoped fixture 自动启动 `services/video-remake/server.py`；evaluator 只需确保 Python 依赖已安装（`pip install -r services/video-remake/requirements.txt requests pytest`）。

- [ ] [BEHAVIOR] `/health` 运行时返回 `{"status":"ok"}`，禁用字段 state/healthy 不存在（对应 Golden Path Step 1）
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py::TestHealthEndpoint -v --tb=short 2>&1 | tail -5'
  期望: 2 passed, 0 failed

- [ ] [BEHAVIOR] `/api/nodes` 运行时返回 9 节点数组，schema 完整性（必填字段均在），禁用字段 node_id/state/name 反向检查通过（对应 Golden Path Step 3）
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py::TestNodesEndpoint -v --tb=short 2>&1 | tail -5'
  期望: 4 passed, 0 failed

- [ ] [BEHAVIOR] `POST /api/nodes/01/confirm` 运行时返回 `{"ok":true,...}`，keys 完整性检查通过，禁用字段 success/state 不存在，且 `~/video-remake-projects/<任务名>/` 目录已创建（对应 Golden Path Step 4）
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py::TestNodeConfirmEndpoint -v --tb=short 2>&1 | tail -5'
  期望: 5 passed, 0 failed

- [ ] [BEHAVIOR] 节点 02–09 全流程可点通，每节点 confirm 均返回 HTTP 200 + ok==true + status==completed（对应 Golden Path Step 5）
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py::TestNodeClickThrough -v --tb=short 2>&1 | tail -5'
  期望: 8 passed, 0 failed

- [ ] [BEHAVIOR] error path — 不存在节点 99 返回 HTTP 404（防 catch-all 路由假绿）
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py::TestNodeConfirmEndpoint::test_nonexistent_node_returns_404 -v --tb=short 2>&1 | tail -3'
  期望: 1 passed, 0 failed

---

## BEHAVIOR:E2E 条目（local_api user_facing，final-e2e 跑）

- [ ] [BEHAVIOR:E2E] pytest 全量套件通过（server 自启动），验证 Golden Path 全程端到端
  Test: manual:bash -c 'cd /workspace && python -m pytest sprints/06090814-video-remake/tests/test_api.py -v --tb=short 2>&1 | tail -8'
  期望: 20 passed, 0 failed（含 8 个参数化节点 02-09 测试）

- [ ] [BEHAVIOR:E2E] bash e2e 脚本（含 schema 完整性 + 禁用字段反向检查 + 项目目录创建 + 02-09 全流程）exit 0
  Test: 通过 `bash sprints/06090814-video-remake/e2e-smoke.sh` 触发（evaluator 本地执行，需 Python 3.10+ 已安装）
  期望: exit 0 + "✅ Line 07 video-remake thin 骨架 Golden Path 验证通过"
