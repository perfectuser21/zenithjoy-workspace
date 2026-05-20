"""
统计数据模块 - Dashboard 和 Analytics
"""
from fastapi import APIRouter
import httpx
from typing import Optional

router = APIRouter(prefix="/api/stats", tags=["stats"])

LABEL_STUDIO_URL = "http://label-studio:8080"
LABEL_STUDIO_TOKEN = "048f955ad4b8e221bf91316955edfe4eb219fade"

def get_ls_headers():
    return {"Authorization": f"Token {LABEL_STUDIO_TOKEN}"}

@router.get("/dashboard")
async def get_dashboard_stats():
    """获取 Dashboard 统计数据"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 获取所有项目
            projects_resp = await client.get(f"{LABEL_STUDIO_URL}/api/projects/", headers=get_ls_headers())
            projects_data = projects_resp.json() if projects_resp.status_code == 200 else {}
            # Label Studio 返回 {count, results} 格式
            projects = projects_data.get("results", []) if isinstance(projects_data, dict) else projects_data

            total_tasks = 0
            completed_tasks = 0
            total_annotations = 0

            # 统计每个项目的任务
            for project in projects:
                project_id = project.get("id")
                if project_id:
                    tasks_resp = await client.get(
                        f"{LABEL_STUDIO_URL}/api/tasks/",
                        headers=get_ls_headers(),
                        params={"project": project_id}
                    )
                    if tasks_resp.status_code == 200:
                        tasks_data = tasks_resp.json()
                        tasks = tasks_data.get("tasks", tasks_data) if isinstance(tasks_data, dict) else tasks_data
                        if isinstance(tasks, list):
                            total_tasks += len(tasks)
                            for task in tasks:
                                if task.get("is_labeled"):
                                    completed_tasks += 1
                                total_annotations += task.get("total_annotations", 0)

            return {
                "total_projects": len(projects),
                "total_tasks": total_tasks,
                "completed_tasks": completed_tasks,
                "total_annotations": total_annotations,
                "completion_rate": round(completed_tasks / total_tasks * 100, 1) if total_tasks > 0 else 0
            }
    except Exception as e:
        return {
            "total_projects": 0,
            "total_tasks": 0,
            "completed_tasks": 0,
            "total_annotations": 0,
            "completion_rate": 0,
            "error": str(e)
        }

@router.get("/projects")
async def get_projects_stats():
    """获取各项目统计"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            projects_resp = await client.get(f"{LABEL_STUDIO_URL}/api/projects/", headers=get_ls_headers())
            projects_data = projects_resp.json() if projects_resp.status_code == 200 else {}
            projects = projects_data.get("results", []) if isinstance(projects_data, dict) else projects_data

            result = []
            for project in projects:
                project_id = project.get("id")
                title = project.get("title", f"项目 {project_id}")

                tasks_resp = await client.get(
                    f"{LABEL_STUDIO_URL}/api/tasks/",
                    headers=get_ls_headers(),
                    params={"project": project_id}
                )

                total = 0
                completed = 0
                if tasks_resp.status_code == 200:
                    tasks_data = tasks_resp.json()
                    tasks = tasks_data.get("tasks", tasks_data) if isinstance(tasks_data, dict) else tasks_data
                    if isinstance(tasks, list):
                        total = len(tasks)
                        completed = sum(1 for t in tasks if t.get("is_labeled"))

                result.append({
                    "id": project_id,
                    "title": title,
                    "total_tasks": total,
                    "completed_tasks": completed,
                    "completion_rate": round(completed / total * 100, 1) if total > 0 else 0
                })

            return result
    except Exception as e:
        return []

@router.get("/user/{phone}/history")
async def get_user_history(phone: str, limit: int = 10):
    """获取用户标注历史"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # 获取所有标注
            annotations_resp = await client.get(
                f"{LABEL_STUDIO_URL}/api/annotations/",
                headers=get_ls_headers(),
                params={"page_size": limit}
            )

            if annotations_resp.status_code != 200:
                return {"annotations": [], "total": 0}

            annotations = annotations_resp.json()

            return {
                "annotations": annotations[:limit] if isinstance(annotations, list) else [],
                "total": len(annotations) if isinstance(annotations, list) else 0
            }
    except Exception as e:
        return {"annotations": [], "total": 0, "error": str(e)}

@router.get("/analytics")
async def get_analytics():
    """获取数据分析图表数据"""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            projects_resp = await client.get(f"{LABEL_STUDIO_URL}/api/projects/", headers=get_ls_headers())
            projects_data = projects_resp.json() if projects_resp.status_code == 200 else {}
            projects = projects_data.get("results", []) if isinstance(projects_data, dict) else projects_data

            # 项目完成率数据
            project_labels = []
            project_completion = []

            for project in projects:
                project_id = project.get("id")
                title = project.get("title", f"项目 {project_id}")

                tasks_resp = await client.get(
                    f"{LABEL_STUDIO_URL}/api/tasks/",
                    headers=get_ls_headers(),
                    params={"project": project_id}
                )

                if tasks_resp.status_code == 200:
                    tasks_data = tasks_resp.json()
                    tasks = tasks_data.get("tasks", tasks_data) if isinstance(tasks_data, dict) else tasks_data
                    if isinstance(tasks, list):
                        total = len(tasks)
                        completed = sum(1 for t in tasks if t.get("is_labeled"))
                        rate = round(completed / total * 100, 1) if total > 0 else 0
                        project_labels.append(title[:10])
                        project_completion.append(rate)

            return {
                "projects": {
                    "labels": project_labels,
                    "data": project_completion
                }
            }
    except Exception as e:
        return {"projects": {"labels": [], "data": []}, "error": str(e)}
