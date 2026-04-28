import { Router, Request, Response } from 'express';
import { spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { randomUUID } from 'crypto';
import { pushAccountsToBitable } from '../services/feishu-bitable';

const router = Router();

// ─── Job Store（内存） ────────────────────────────────────────────
interface Job {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  logs: string[];
  progress: number;
  resultFile?: string;
  error?: string;
  feishuUrl?: string;
  createdAt: string;
}

const jobStore = new Map<string, Job>();

// ─── POST /api/competitor-research/start ─────────────────────────
router.post('/start', (req: Request, res: Response) => {
  const { topic = '一人公司', roundLimit = 20 } = req.body as {
    topic?: string;
    roundLimit?: number;
  };

  const jobId = randomUUID();
  const job: Job = {
    id: jobId,
    status: 'pending',
    logs: [],
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  jobStore.set(jobId, job);

  // 脚本路径
  const scriptPath = path.join(
    __dirname,
    '../../../../services/creator/scripts/publishers/douyin-publisher/sop-account-search.js'
  );
  const scriptCwd = path.join(scriptPath, '../../');

  // 异步启动子进程，立即返回 jobId
  setImmediate(() => {
    job.status = 'running';
    job.logs.push(`[${new Date().toISOString()}] 启动采集任务 topic="${topic}" roundLimit=${roundLimit}`);

    const proc = spawn(process.execPath, [
      scriptPath,
      '--topic', topic,
      '--round-limit', String(roundLimit),
    ], {
      cwd: scriptCwd,
      env: {
        ...process.env,
        COMPETITOR_TOPIC: topic,
        COMPETITOR_ROUND_LIMIT: String(roundLimit),
      },
    });

    const addLog = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      job.logs.push(trimmed);
      // 粗略进度估算
      if (trimmed.includes('[Round')) job.progress = Math.min(job.progress + 10, 80);
      if (trimmed.includes('[初筛]')) job.progress = 85;
      if (trimmed.includes('[二筛]')) job.progress = 90;
      if (trimmed.includes('[最终]')) job.progress = 95;
      // 解析结果文件路径
      const match = trimmed.match(/\[保存\] 结果已写入：(.+)/);
      if (match) {
        job.resultFile = match[1].trim();
      }
    };

    proc.stdout.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(addLog);
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      chunk.toString().split('\n').forEach(addLog);
    });

    proc.on('close', async (code) => {
      if (code !== 0) {
        job.status = 'failed';
        job.error = `进程退出码 ${code}`;
        job.logs.push(`[${new Date().toISOString()}] 采集失败，退出码 ${code}`);
        return;
      }

      job.status = 'completed';
      job.progress = 100;
      job.logs.push(`[${new Date().toISOString()}] 采集完成`);

      // ── 推送到飞书多维表格 ──
      if (job.resultFile) {
        try {
          const raw = fs.readFileSync(job.resultFile, 'utf8');
          const data = JSON.parse(raw) as {
            primaryScreening: Array<{
              creatorName: string; douyinId: string; followers: number;
              bio: string; profileUrl: string; round: number; keyword: string;
            }>;
            secondaryScreening: Array<{ profileUrl: string }>;
            report: { topic: string; executedAt: string };
          };

          const secondaryUrls = new Set(data.secondaryScreening.map(a => a.profileUrl));
          const accounts = data.primaryScreening.map(acc => ({
            ...acc,
            topic: data.report.topic,
            passedSecondary: secondaryUrls.has(acc.profileUrl),
            executedAt: data.report.executedAt,
          }));

          job.logs.push(`[飞书] 正在写入 ${accounts.length} 条记录...`);
          const result = await pushAccountsToBitable(accounts);
          job.logs.push(`[飞书] 写入完成 ${result.successCount} 条 → ${result.url}`);
          job.feishuUrl = result.url;
        } catch (e) {
          const err = e as Error;
          job.logs.push(`[飞书] 写入失败：${err.message}`);
        }
      }
    });

    proc.on('error', (err) => {
      job.status = 'failed';
      job.error = err.message;
      job.logs.push(`[${new Date().toISOString()}] 启动脚本失败：${err.message}`);
    });
  });

  res.json({ jobId });
});

// ─── GET /api/competitor-research/status/:jobId ──────────────────
router.get('/status/:jobId', (req: Request, res: Response) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  res.json({
    status: job.status,
    logs: job.logs,
    progress: job.progress,
    error: job.error,
    feishuUrl: job.feishuUrl,
  });
});

// ─── GET /api/competitor-research/results/:jobId ─────────────────
router.get('/results/:jobId', (req: Request, res: Response) => {
  const job = jobStore.get(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: '任务不存在' });
    return;
  }
  if (job.status !== 'completed') {
    res.status(400).json({ error: `任务状态为 ${job.status}，尚未完成` });
    return;
  }
  if (!job.resultFile) {
    res.status(500).json({ error: '结果文件路径未找到' });
    return;
  }
  try {
    const raw = fs.readFileSync(job.resultFile, 'utf8');
    const data = JSON.parse(raw) as {
      primaryScreening: unknown[];
      secondaryScreening: unknown[];
      finalPool: unknown[];
      report: unknown;
    };
    res.json(data);
  } catch (e) {
    const err = e as Error;
    res.status(500).json({ error: `读取结果文件失败：${err.message}` });
  }
});

export default router;
