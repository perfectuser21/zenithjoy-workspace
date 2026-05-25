import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import pool from '../db/connection';

const XIAN_M4 = 'jinnuoshengyuan@100.86.57.69';
const REMOTE_BASE = '/opt/video-pipeline/jobs';
const LOCAL_BASE = `${process.env.HOME}/video-pipeline/jobs`;

export interface UploadVideoParams {
  jobId: string;
  videoPath: string;
  scriptText: string;
  logoPath?: string;
  platform?: string;
}

export class AiVideoUploadService {
  async createJob(params: UploadVideoParams): Promise<string> {
    const { jobId, videoPath, scriptText, logoPath } = params;
    await pool.query(
      `INSERT INTO zenithjoy.ai_video_generations (
        id, platform, model, prompt, status, progress,
        source_video_path, script_text, logo_path
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [jobId, 'local-whisper-ffmpeg', 'whisper-base', scriptText,
       'queued', 0, videoPath, scriptText, logoPath || null]
    );
    return jobId;
  }

  async dispatch(params: UploadVideoParams): Promise<void> {
    const { jobId, videoPath, scriptText, logoPath } = params;
    const localJobDir = path.join(LOCAL_BASE, jobId);
    const remoteJobDir = `${REMOTE_BASE}/${jobId}`;

    const configPath = path.join(localJobDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      job_id: jobId,
      script_text: scriptText,
      min_silence_gap: 1.5,
      openai_api_key: process.env.OPENAI_API_KEY || '',
    }));

    await pool.query(
      `UPDATE zenithjoy.ai_video_generations SET status='in_progress', progress=5 WHERE id=$1`,
      [jobId]
    );

    execSync(
      `ssh -o StrictHostKeyChecking=no ${XIAN_M4} "mkdir -p ${remoteJobDir}/src ${remoteJobDir}/out"`,
      { timeout: 15000 }
    );
    execSync(
      `scp -o StrictHostKeyChecking=no "${videoPath}" "${XIAN_M4}:${remoteJobDir}/src/video.mp4"`,
      { timeout: 120000 }
    );
    execSync(
      `scp -o StrictHostKeyChecking=no "${configPath}" "${XIAN_M4}:${remoteJobDir}/config.json"`,
      { timeout: 15000 }
    );
    if (logoPath && fs.existsSync(logoPath)) {
      execSync(
        `scp -o StrictHostKeyChecking=no "${logoPath}" "${XIAN_M4}:${remoteJobDir}/src/logo.png"`,
        { timeout: 15000 }
      );
    }

    const processPyLocal = path.join(__dirname, '../../../..', 'services/video-pipeline/process.py');
    if (fs.existsSync(processPyLocal)) {
      execSync(
        `scp -o StrictHostKeyChecking=no "${processPyLocal}" "${XIAN_M4}:/opt/video-pipeline/process.py"`,
        { timeout: 15000 }
      );
    }

    execSync(
      `ssh -o StrictHostKeyChecking=no ${XIAN_M4} ` +
      `"mkdir -p /opt/video-pipeline && ` +
      `nohup python3 /opt/video-pipeline/process.py ${remoteJobDir} ` +
      `> ${remoteJobDir}/process.log 2>&1 &"`,
      { timeout: 15000 }
    );

    this.startPolling(jobId, remoteJobDir);
  }

  private startPolling(jobId: string, remoteJobDir: string) {
    const localJobDir = path.join(LOCAL_BASE, jobId);
    const outDir = path.join(localJobDir, 'out');
    let attempts = 0;
    const maxAttempts = 360;

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > maxAttempts) {
        clearInterval(interval);
        await pool.query(
          `UPDATE zenithjoy.ai_video_generations SET status='failed', error_message='timeout' WHERE id=$1`,
          [jobId]
        );
        return;
      }
      try {
        const raw = execSync(
          `ssh -o StrictHostKeyChecking=no ${XIAN_M4} "cat ${remoteJobDir}/status.json" 2>/dev/null || echo '{}'`,
          { timeout: 10000 }
        ).toString().trim();
        const status = JSON.parse(raw);
        if (!status.status) return;
        await pool.query(
          `UPDATE zenithjoy.ai_video_generations SET progress=$1 WHERE id=$2`,
          [status.progress || 0, jobId]
        );
        if (status.status === 'completed') {
          clearInterval(interval);
          fs.mkdirSync(outDir, { recursive: true });
          execSync(
            `scp -o StrictHostKeyChecking=no "${XIAN_M4}:${remoteJobDir}/out/9_16.mp4" "${outDir}/9_16.mp4"`,
            { timeout: 120000 }
          );
          execSync(
            `scp -o StrictHostKeyChecking=no "${XIAN_M4}:${remoteJobDir}/out/16_9.mp4" "${outDir}/16_9.mp4"`,
            { timeout: 120000 }
          );
          await pool.query(
            `UPDATE zenithjoy.ai_video_generations
             SET status='completed', progress=100, completed_at=NOW(),
                 output_9_16_url=$1, output_16_9_url=$2
             WHERE id=$3`,
            [
              `/api/ai-video/download/${jobId}/9_16.mp4`,
              `/api/ai-video/download/${jobId}/16_9.mp4`,
              jobId,
            ]
          );
        } else if (status.status === 'failed') {
          clearInterval(interval);
          await pool.query(
            `UPDATE zenithjoy.ai_video_generations SET status='failed', error_message=$1 WHERE id=$2`,
            [status.error || 'processing failed', jobId]
          );
        }
      } catch {
        // SSH temporary failure — keep polling
      }
    }, 5000);
  }
}
