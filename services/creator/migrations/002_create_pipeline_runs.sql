-- Migration 002: 创建 pipeline_runs 表 + topics 表添加'待发布'状态
-- Brain Task: b7f7649d-bdc2-4c7c-a27d-f40b672a182e
-- 内容工厂 Pipeline Worker 阶段3

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running'
        CHECK(status IN ('running', 'completed', 'failed')),
    current_stage TEXT,
    error_message TEXT,
    output_manifest TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_topic ON pipeline_runs(topic_id);

-- 注意：topics 表的 CHECK 约束添加 '待发布' 需要表重建，
-- 在 pipeline_worker/worker.py 的 _ensure_topics_has_waiting_status() 中动态处理。
