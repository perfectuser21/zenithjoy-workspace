/**
 * Migration: Create zenithjoy.acquisition_collect_videos
 *
 * Sprint 07021006 — Line02 获客工作台 IA 重设计
 * 存储采集任务下抓到的视频元数据（标题/封面/日期/评论数）
 */
export async function up(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zenithjoy.acquisition_collect_videos (
      video_id       TEXT        NOT NULL,
      task_id        UUID        NOT NULL REFERENCES zenithjoy.acquisition_collect_tasks(id) ON DELETE CASCADE,
      tenant_id      TEXT        NOT NULL,
      title          TEXT,
      thumbnail_url  TEXT,
      publish_date   TIMESTAMPTZ,
      comment_count  INTEGER     NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (video_id)
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_acquisition_collect_videos_task_id
      ON zenithjoy.acquisition_collect_videos (task_id)
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_acquisition_collect_videos_tenant_id
      ON zenithjoy.acquisition_collect_videos (tenant_id)
  `);
}

export async function down(pool: { query: (sql: string) => Promise<unknown> }): Promise<void> {
  await pool.query(`DROP TABLE IF EXISTS zenithjoy.acquisition_collect_videos`);
}
