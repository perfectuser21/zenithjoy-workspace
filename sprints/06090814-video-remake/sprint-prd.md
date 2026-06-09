# Sprint PRD — Line 07 AI 爆款视频翻拍 · 9 节点画布 thin 骨架

## OKR 对齐

- **对应 KR**：Line 07「AI 爆款视频翻拍」首个 Sprint（新建 Journey）
- **当前进度**：0%
- **本次推进预期**：thin 骨架建立，9 节点画布可访问，全流程可点通

## 背景

新建 Line 07，第一刀建立 9 节点 Canvas UI（React Flow）+ Python FastAPI localhost:8899 骨架，复现本地 ComfyUI 同款体验：浏览器打开 localhost:8899 看到节点画布，按节点顺序走完翻拍流程，最终下载合成视频。全程本地文件路径，不上传云端。

## Golden Path（核心场景）

用户从 [浏览器打开 localhost:8899] → 经过 [依次点击 9 个节点、填写输入、触发处理、审核输出] → 到达 [下载合成视频文件]

具体步骤：
1. **[触发]** 用户运行 `python server.py`，浏览器打开 `localhost:8899`，看到 9 节点画布（React Flow）
2. **[01 输入素材]** 点击节点 → 侧面板填写：本地视频路径 / 模特参考图路径 / 产品图路径 / 一句话目标 → 确认 → 节点变绿 + 生成项目目录 `~/video-remake-projects/<任务名>/`
3. **[02 拆视频]** 点击 → Python FastAPI 调 ffmpeg 按场景切片 → 进度条 → 节点绿 + 产出 scene × N + 候选帧
4. **[03 关键帧筛选]** 侧面板展示每个 scene 三帧缩略图（start/mid/end）→ 用户逐 scene 选帧（或一键 mid）→ 确认 → 产出 base frame × N
5. **[04 出图模型]** 单选 `Doubao-Seedream-4.5` 或 `GPT-Image-2` → 确认
6. **[05 锁模特]** 调选定模型 Image2Image，保构图姿态背景，换人物 → 进度条 → 产出 model-locked.png × N
7. **[06 锁产品]** 调选定模型 Image2Image，保脸和背景，替换产品 → 进度条 → 产出 start-final.png × N
8. **[07 开始图通过]** 侧面板展示 N 张 start-final.png → 用户逐张标记"通过"或"重新生成"（重跑该 scene 05+06）→ 全通过后确认
9. **[08 HappyHorse i2v]** 每张通过图调 i2v API → 进度条 → 产出 i2v-Ns.mp4 × N
10. **[09 视频输出]** 自动拼接所有片段 → 节点绿 → 侧面板预览 + 用户点击下载

## 边界情况

- i2v 失败 → 节点变红 → 用户点重试 → 只重跑该 scene [08]，其他 scene 不受影响
- 开始图不通过 → 只重跑该 scene [05]+[06]，不影响其他 scene
- 项目目录已存在 → 画布恢复上次节点状态（缓存复用）
- API Key 缺失 → 节点变红 + 侧面板显示缺失的 Key 名称

## 范围限定

**在范围内**：9 节点 Canvas UI（React Flow）、Python FastAPI localhost:8899、Doubao-Seedream-4.5 / GPT-Image-2 双模型切换、HappyHorse i2v 调用（thin：可 stub）、本地文件路径全流程、单 scene 重跑
**不在范围内**：多场景并行生图、云端协作、自动关键帧筛选（第一刀人工选）、视频发布到平台

## 假设

- [ASSUMPTION: HappyHorse i2v API 接入方式未确认，第一刀用 stub 返回固定 mp4，待 API 文档后替换]
- [ASSUMPTION: Doubao-Seedream-4.5 和 GPT-Image-2 API Key 已在 ~/.credentials/doubao.env / ~/.credentials/openai.env 就绪]
- [ASSUMPTION: 用户本地已安装 ffmpeg 和 Python 3.10+]
- [ASSUMPTION: Line 07 Journey UUID 待 Brain API 恢复后填入]

## 预期受影响文件

- `services/video-remake/server.py`：Python FastAPI 主入口，/health + /api/nodes + 9 个节点路由
- `services/video-remake/requirements.txt`：fastapi uvicorn ffmpeg-python 等依赖
- `services/video-remake/frontend/src/App.tsx`：React Flow 9 节点画布
- `services/video-remake/frontend/package.json`：react react-flow-renderer 等依赖
- `.github/workflows/scripts/smoke/line07-video-remake-smoke.sh`：API 启动 + 基础路由 smoke

## E2E 验收（smoke）

```bash
#!/usr/bin/env bash
set -e
cd services/video-remake

python server.py &
SERVER_PID=$!
sleep 3

curl -f http://localhost:8899/health | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['status']=='ok'"
curl -f http://localhost:8899/api/nodes | python3 -c "import sys,json; d=json.load(sys.stdin); assert len(d)==9, f'expected 9 nodes, got {len(d)}'"
curl -f http://localhost:8899/ -o /dev/null -w "%{http_code}" | grep -q "200"

kill $SERVER_PID 2>/dev/null || true
echo "✅ Line 07 smoke 通过"
```

## journey_type: user_facing
## journey_type_reason: 用户通过浏览器访问 localhost:8899 的 React Flow 9 节点画布，是典型用户界面交互场景
## target_environment: local_api
## target_environment_reason: Python FastAPI 运行在本机 localhost:8899，smoke test 走本地 curl 验证 API 启动和基础路由
## journey_id: <待 Brain API 返回 Line 07 UUID>
## step_id: L07-S1
