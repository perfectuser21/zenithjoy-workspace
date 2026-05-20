import pool from '../db/connection';

export interface PipelineJob {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  template_id: string | null;
  src_video: string | null;
  src_logo: string | null;
  topic: string | null;
  result_url: string | null;
  output_dir: string | null;
  error_msg: string | null;
  license_id: string | null;
  created_at: Date;
  updated_at: Date;
}

export class AiVideoPipelineService {
  async createJob(params: {
    srcVideo: string;
    srcLogo: string | null;
    topic: string | null;
    templateId?: string | null;
    licenseId?: string | null;
  }): Promise<PipelineJob> {
    const result = await pool.query(
      `INSERT INTO zenithjoy.ai_video_pipeline_jobs
         (src_video, src_logo, topic, template_id, license_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [params.srcVideo, params.srcLogo, params.topic, params.templateId ?? null, params.licenseId ?? null],
    );
    return result.rows[0];
  }

  async getJob(id: string): Promise<PipelineJob | null> {
    const result = await pool.query(
      'SELECT * FROM zenithjoy.ai_video_pipeline_jobs WHERE id = $1',
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listPending(licenseId?: string | null): Promise<PipelineJob[]> {
    if (licenseId) {
      const result = await pool.query(
        `SELECT * FROM zenithjoy.ai_video_pipeline_jobs
         WHERE status = 'pending' AND license_id = $1
         ORDER BY created_at ASC LIMIT 10`,
        [licenseId],
      );
      return result.rows;
    }
    // Unauthenticated callers only get unlicensed jobs — prevents foreign agents from
    // stealing jobs that belong to a specific license/tenant.
    const result = await pool.query(
      `SELECT * FROM zenithjoy.ai_video_pipeline_jobs
       WHERE status = 'pending' AND license_id IS NULL
       ORDER BY created_at ASC`,
    );
    return result.rows;
  }

  async listStale(staleMinutes: number): Promise<PipelineJob[]> {
    const result = await pool.query(
      `SELECT * FROM zenithjoy.ai_video_pipeline_jobs
       WHERE status = 'processing'
         AND updated_at < NOW() - ($1 || ' minutes')::interval
       ORDER BY updated_at ASC`,
      [staleMinutes],
    );
    return result.rows;
  }

  async updateStatus(
    id: string,
    params: {
      status?: PipelineJob['status'];
      progress?: number;
      resultUrl?: string;
      outputDir?: string;
      errorMsg?: string;
    },
  ): Promise<PipelineJob> {
    const fields: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let i = 1;

    if (params.status !== undefined) { fields.push(`status = $${i++}`); values.push(params.status); }
    if (params.progress !== undefined) { fields.push(`progress = $${i++}`); values.push(params.progress); }
    if (params.resultUrl !== undefined) { fields.push(`result_url = $${i++}`); values.push(params.resultUrl); }
    if (params.outputDir !== undefined) { fields.push(`output_dir = $${i++}`); values.push(params.outputDir); }
    if (params.errorMsg !== undefined) { fields.push(`error_msg = $${i++}`); values.push(params.errorMsg); }

    values.push(id);
    const result = await pool.query(
      `UPDATE zenithjoy.ai_video_pipeline_jobs SET ${fields.join(', ')} WHERE id = $${i} RETURNING *`,
      values,
    );
    return result.rows[0];
  }
}
