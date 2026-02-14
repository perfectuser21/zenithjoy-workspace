import pool from '../db/connection';
import { ApiError } from '../middleware/error';
import { ToAPIClient } from '../clients/toapi.client';

export interface AiVideoGeneration {
  id: string;
  platform: string;
  model: string;
  prompt: string;
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress: number;
  video_url?: string;
  error_message?: string;
  created_at: Date;
  completed_at?: Date;
  updated_at: Date;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}

export interface CreateAiVideoParams {
  platform: string;
  model: string;
  prompt: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  image_urls?: string[];
}

export interface UpdateAiVideoParams {
  status?: 'queued' | 'in_progress' | 'completed' | 'failed';
  progress?: number;
  video_url?: string;
  error_message?: string;
  completed_at?: Date;
}

export class AiVideoService {
  private toapiClient: ToAPIClient;

  constructor() {
    this.toapiClient = new ToAPIClient();
  }

  async getAllGenerations(filters?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ data: AiVideoGeneration[]; total: number }> {
    let query = `
      SELECT * FROM zenithjoy.ai_video_generations
    `;
    const values: any[] = [];
    let paramIndex = 1;

    if (filters?.status && filters.status !== 'all') {
      query += ` WHERE status = $${paramIndex}`;
      values.push(filters.status);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC`;

    if (filters?.limit) {
      query += ` LIMIT $${paramIndex}`;
      values.push(filters.limit);
      paramIndex++;
    }

    if (filters?.offset) {
      query += ` OFFSET $${paramIndex}`;
      values.push(filters.offset);
    }

    const result = await pool.query(query, values);

    // Get total count
    const countQuery = filters?.status && filters.status !== 'all'
      ? 'SELECT COUNT(*) FROM zenithjoy.ai_video_generations WHERE status = $1'
      : 'SELECT COUNT(*) FROM zenithjoy.ai_video_generations';
    const countValues = filters?.status && filters.status !== 'all' ? [filters.status] : [];
    const countResult = await pool.query(countQuery, countValues);

    return {
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
    };
  }

  async getGenerationById(id: string): Promise<AiVideoGeneration | null> {
    // Get from database first
    const query = `
      SELECT * FROM zenithjoy.ai_video_generations
      WHERE id = $1
    `;
    const result = await pool.query(query, [id]);
    const generation = result.rows[0];

    if (!generation) {
      return null;
    }

    // If task is not completed/failed, sync latest status from ToAPI
    if (generation.platform === 'toapi' &&
        generation.status !== 'completed' &&
        generation.status !== 'failed') {
      try {
        const toapiTask = await this.toapiClient.getTaskStatus(id);

        // Update database with latest status
        const updateQuery = `
          UPDATE zenithjoy.ai_video_generations
          SET status = $1, progress = $2, video_url = $3, error_message = $4,
              completed_at = $5, updated_at = NOW()
          WHERE id = $6
          RETURNING *
        `;

        const updateValues = [
          toapiTask.status,
          toapiTask.progress,
          toapiTask.video_url || null,
          toapiTask.error_message || null,
          toapiTask.completed_at ? new Date(toapiTask.completed_at * 1000) : null,
          id,
        ];

        const updateResult = await pool.query(updateQuery, updateValues);
        return updateResult.rows[0];
      } catch (error) {
        console.error('[AiVideoService] Failed to sync ToAPI status:', error);
        // Return cached database record if ToAPI sync fails
        return generation;
      }
    }

    return generation;
  }

  async getActiveGenerations(): Promise<AiVideoGeneration[]> {
    const query = `
      SELECT * FROM zenithjoy.ai_video_generations
      WHERE status IN ('queued', 'in_progress')
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    return result.rows;
  }

  async createGeneration(params: CreateAiVideoParams): Promise<AiVideoGeneration> {
    // Step 1: Call ToAPI to create video generation task
    let toapiTask;
    try {
      toapiTask = await this.toapiClient.createVideoGeneration({
        model: params.model,
        prompt: params.prompt,
        duration: params.duration,
        aspectRatio: params.aspect_ratio,
        resolution: params.resolution,
        imageUrls: params.image_urls,
      });
    } catch (error) {
      console.error('[AiVideoService] ToAPI create error:', error);
      throw new ApiError(
        'TOAPI_ERROR',
        `Failed to create video generation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }

    // Step 2: Save to database with ToAPI task ID
    const query = `
      INSERT INTO zenithjoy.ai_video_generations (
        id, platform, model, prompt, status, progress,
        duration, aspect_ratio, resolution
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const values = [
      toapiTask.id,  // Use ToAPI task ID
      params.platform,
      params.model,
      params.prompt,
      toapiTask.status,
      toapiTask.progress,
      params.duration || null,
      params.aspect_ratio || null,
      params.resolution || null,
    ];

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async updateGeneration(id: string, params: UpdateAiVideoParams): Promise<AiVideoGeneration> {
    // Check if generation exists
    const checkQuery = 'SELECT * FROM zenithjoy.ai_video_generations WHERE id = $1';
    const checkResult = await pool.query(checkQuery, [id]);

    if (checkResult.rows.length === 0) {
      throw new ApiError('NOT_FOUND', 'Video generation not found', 404);
    }

    const fields: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      fields.push(`status = $${paramIndex}`);
      values.push(params.status);
      paramIndex++;
    }

    if (params.progress !== undefined) {
      fields.push(`progress = $${paramIndex}`);
      values.push(params.progress);
      paramIndex++;
    }

    if (params.video_url !== undefined) {
      fields.push(`video_url = $${paramIndex}`);
      values.push(params.video_url);
      paramIndex++;
    }

    if (params.error_message !== undefined) {
      fields.push(`error_message = $${paramIndex}`);
      values.push(params.error_message);
      paramIndex++;
    }

    if (params.completed_at !== undefined) {
      fields.push(`completed_at = $${paramIndex}`);
      values.push(params.completed_at);
      paramIndex++;
    }

    if (fields.length === 0) {
      return checkResult.rows[0];
    }

    const query = `
      UPDATE zenithjoy.ai_video_generations
      SET ${fields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;
    values.push(id);

    const result = await pool.query(query, values);
    return result.rows[0];
  }

  async deleteGeneration(id: string): Promise<void> {
    const result = await pool.query(
      'DELETE FROM zenithjoy.ai_video_generations WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      throw new ApiError('NOT_FOUND', 'Video generation not found', 404);
    }
  }
}
