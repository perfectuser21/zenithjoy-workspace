import { Request, Response, NextFunction } from 'express';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';
import pool from '../db/connection';
import { auth } from '../auth';
import { fromNodeHeaders } from 'better-auth/node';

const svc = new AiVideoPipelineService();

export async function createJob(req: Request, res: Response, next: NextFunction) {
  try {
    const { local_path, topic, template_id, original_script, target_aspect } = req.body as {
      local_path?: string;
      topic?: string;
      template_id?: string;
      original_script?: string | null;
      target_aspect?: string | null;
    };
    if (!local_path) return res.status(400).json({ error: 'local_path required' });

    let licenseId: string | null = null;

    // 1. License key from Authorization: Bearer (agent-style auth; also used by E2E browser interceptor)
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const licenseKey = authHeader.slice(7).trim();
      if (licenseKey) {
        try {
          const licRow = await pool.query<{ id: string }>(
            `SELECT id FROM zenithjoy.licenses WHERE license_key = $1 AND status = 'active' LIMIT 1`,
            [licenseKey],
          );
          if (licRow.rows.length > 0) licenseId = licRow.rows[0].id;
        } catch (e) { console.warn('[createJob] failed to resolve license_id via Bearer, creating job without tenant stamp:', e); }
      }
    }

    // 2. Fall back to session-based lookup (Feishu SSO users via tenant_members)
    if (!licenseId) {
      try {
        const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
        if (session?.user?.id) {
          const licRow = await pool.query<{ id: string }>(
            `SELECT l.id FROM zenithjoy.licenses l
             JOIN zenithjoy.tenants t ON t.id = l.tenant_id
             JOIN zenithjoy.tenant_members tm ON tm.tenant_id = t.id
             WHERE tm.feishu_user_id = $1 AND l.status = 'active'
             ORDER BY l.created_at DESC LIMIT 1`,
            [session.user.id],
          );
          if (licRow.rows.length > 0) licenseId = licRow.rows[0].id;
        }
      } catch (e) { console.warn('[createJob] failed to resolve license_id, creating job without tenant stamp:', e); }
    }

    const job = await svc.createJob({
      srcVideo: local_path,
      srcLogo: null,
      topic: topic ?? null,
      templateId: template_id ?? null,
      licenseId,
      originalScript: original_script ?? null,
      targetAspect: target_aspect ?? null,
    });
    res.status(201).json({
      job: {
        id: job.id,
        status: job.status,
        original_script: job.original_script ?? null,
        target_aspect: job.target_aspect ?? null,
        detected_aspect: job.detected_aspect ?? null,
      },
    });
  } catch (err) { next(err); }
}

export async function getJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    res.json({
      ...job,
      detected_aspect: job.detected_aspect ?? null,
    });
  } catch (err) { next(err); }
}

export async function listJobs(req: Request, res: Response, next: NextFunction) {
  try {
    let licenseId: string | null = null;
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const licenseKey = authHeader.slice(7).trim();
      if (licenseKey) {
        const licRow = await pool.query<{ id: string }>(
          `SELECT id FROM zenithjoy.licenses WHERE license_key = $1 AND status = 'active' LIMIT 1`,
          [licenseKey],
        );
        if (licRow.rows.length > 0) licenseId = licRow.rows[0].id;
      }
    }

    const status = req.query.status as string | undefined;
    if (status === 'pending') {
      // null licenseId = unauthenticated caller — backward-compat: returns all pending jobs
      // non-null licenseId = authenticated agent — strict isolation: only that license's jobs
      const jobs = await svc.listPending(licenseId);
      return res.json({ data: jobs });
    }
    if (status === 'processing') {
      const staleMinutes = parseInt(req.query.stale_minutes as string, 10);
      if (!isNaN(staleMinutes) && staleMinutes > 0) {
        const jobs = await svc.listStale(staleMinutes);
        return res.json({ data: jobs });
      }
      return res.json({ data: [] });
    }
    // thin: only supports status=pending filter; other filters return empty as not-yet-implemented
    res.json({ data: [] });
  } catch (err) { next(err); }
}

export async function updateProgress(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { progress, status, detected_aspect } = req.body as { progress?: number; status?: string; detected_aspect?: string | null };
    const allowedStatuses = ['pending', 'processing', 'completed', 'failed'] as const;
    if (status !== undefined && !allowedStatuses.includes(status as typeof allowedStatuses[number])) {
      return res.status(400).json({ error: `invalid status: ${status}` });
    }
    const safeStatus = (status as typeof allowedStatuses[number]) ?? 'processing';
    const updated = await svc.updateStatus(req.params.id, {
      status: safeStatus,
      progress: typeof progress === 'number' ? progress : job.progress,
      detectedAspect: detected_aspect,
    });
    res.json(updated);
  } catch (err) { next(err); }
}

export async function completeJob(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });
    const { output_dir, error_msg } = req.body as { output_dir?: string; error_msg?: string };
    const updated = await svc.updateStatus(req.params.id, {
      status: error_msg ? 'failed' : 'completed',
      progress: error_msg ? job.progress : 100,
      outputDir: output_dir,
      errorMsg: error_msg,
    });
    res.json(updated);
  } catch (err) { next(err); }
}
