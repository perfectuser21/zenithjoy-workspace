from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse

app = FastAPI(title="Video Remake API — Line 07")

NODES = [
    {"id": "01", "label": "输入素材", "status": "pending", "order": 1},
    {"id": "02", "label": "拆视频", "status": "pending", "order": 2},
    {"id": "03", "label": "关键帧筛选", "status": "pending", "order": 3},
    {"id": "04", "label": "出图模型", "status": "pending", "order": 4},
    {"id": "05", "label": "锁模特", "status": "pending", "order": 5},
    {"id": "06", "label": "锁产品", "status": "pending", "order": 6},
    {"id": "07", "label": "开始图通过", "status": "pending", "order": 7},
    {"id": "08", "label": "HappyHorse i2v", "status": "pending", "order": 8},
    {"id": "09", "label": "视频输出", "status": "pending", "order": 9},
]

VALID_NODE_IDS = {n["id"] for n in NODES}

FRONTEND_DIST = Path(__file__).parent / "frontend" / "dist"


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/nodes")
def get_nodes():
    return NODES


@app.post("/api/nodes/{node_id}/confirm")
async def confirm_node(node_id: str, request: Request):
    if node_id not in VALID_NODE_IDS:
        raise HTTPException(status_code=404, detail=f"node {node_id} not found")

    try:
        payload = await request.json()
    except Exception:
        payload = {}

    if node_id == "01":
        goal = payload.get("goal", "")
        if goal:
            project_dir = Path.home() / "video-remake-projects" / goal
            project_dir.mkdir(parents=True, exist_ok=True)

    return {"ok": True, "node_id": node_id, "status": "completed"}


@app.get("/")
async def root():
    index = FRONTEND_DIST / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return HTMLResponse(
        "<html><body><h1>Line 07 — AI 爆款视频翻拍画布</h1></body></html>",
        status_code=200,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8899)
