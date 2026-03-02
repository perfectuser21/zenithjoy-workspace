"""
Label Studio 集成模块
"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from typing import Optional, List

router = APIRouter(prefix="/api/labeling", tags=["labeling"])

LABEL_STUDIO_URL = "http://label-studio:8080"
LABEL_STUDIO_TOKEN = "048f955ad4b8e221bf91316955edfe4eb219fade"

def get_ls_headers():
    return {"Authorization": f"Token {LABEL_STUDIO_TOKEN}"}

class ProjectCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    label_config: str

class AnnotationCreate(BaseModel):
    result: List[dict]

@router.get("/projects")
async def list_projects():
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{LABEL_STUDIO_URL}/api/projects/", headers=get_ls_headers())
        return resp.json()

@router.post("/projects")
async def create_project(project: ProjectCreate):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{LABEL_STUDIO_URL}/api/projects/",
            headers=get_ls_headers(),
            json={"title": project.title, "description": project.description, "label_config": project.label_config}
        )
        if resp.status_code != 201:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()

@router.get("/projects/{project_id}/tasks")
async def list_tasks(project_id: int):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{LABEL_STUDIO_URL}/api/tasks/", headers=get_ls_headers(), params={"project": project_id})
        return resp.json()

@router.get("/tasks/{task_id}")
async def get_task(task_id: int):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(f"{LABEL_STUDIO_URL}/api/tasks/{task_id}/", headers=get_ls_headers())
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail="任务不存在")
        return resp.json()

@router.post("/tasks/{task_id}/submit")
async def submit_annotation(task_id: int, annotation: AnnotationCreate):
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.post(
            f"{LABEL_STUDIO_URL}/api/tasks/{task_id}/annotations/",
            headers=get_ls_headers(),
            json={"result": annotation.result}
        )
        if resp.status_code not in [200, 201]:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return {"success": True, "annotation_id": resp.json().get("id")}

@router.post("/projects/{project_id}/import")
async def import_tasks(project_id: int, tasks: List[dict]):
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{LABEL_STUDIO_URL}/api/projects/{project_id}/import", headers=get_ls_headers(), json=tasks)
        if resp.status_code not in [200, 201]:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        return resp.json()
