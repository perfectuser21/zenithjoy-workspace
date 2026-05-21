import { Request, Response, NextFunction } from 'express';
import { fromNodeHeaders } from 'better-auth/node';
import { auth } from '../auth';
import {
  createClip,
  getClips,
  getClipById,
  updateClipStatus,
  getExistingClip,
  getSettings,
  upsertSettings,
  detectPlatform,
} from '../services/clips.service';
import { extractClip } from '../services/clips-extractor.service';
import { parseOutputUrl, pushClipOutput } from '../services/clip-output.service';

async function getSession(req: Request) {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

export async function submitClip(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const userId = session.user.id;

    const { url: rawUrl, output_url: rawOutputUrl } = req.body as {
      url?: string;
      output_url?: string;
    };
    if (!rawUrl?.trim()) return res.status(400).json({ error: 'url_required' });

    const platform = detectPlatform(rawUrl.trim());
    if (!platform) return res.status(400).json({ error: 'unsupported_platform' });

    let outputUrl = rawOutputUrl?.trim() || null;
    let outputType: string | null = null;
    if (!outputUrl) {
      const settings = await getSettings(userId);
      outputUrl = settings?.defaultOutputUrl ?? null;
      outputType = settings?.defaultOutputType ?? null;
    }
    if (outputUrl && !outputType) {
      const parsed = parseOutputUrl(outputUrl);
      outputType = parsed?.type ?? null;
    }

    const existing = await getExistingClip(userId, rawUrl.trim());
    if (existing) {
      return res.status(409).json({ error: 'already_exists', id: existing.id });
    }

    const clip = await createClip({ userId, url: rawUrl.trim(), platform, outputUrl, outputType });
    extractClip(clip.id, clip.url).catch(() => {});
    return res.status(201).json(clip);
  } catch (err) {
    next(err);
  }
}

export async function listClips(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const { platform, status, limit, offset } = req.query as Record<string, string>;
    const result = await getClips(session.user.id, {
      platform, status,
      limit: limit ? parseInt(limit, 10) : 20,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getClipDetail(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const clip = await getClipById(req.params.id, session.user.id);
    if (!clip) return res.status(404).json({ error: 'not_found' });
    return res.json(clip);
  } catch (err) {
    next(err);
  }
}

export async function retryClip(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const existing = await getClipById(req.params.id, session.user.id);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    const clip = await updateClipStatus(req.params.id, 'pending', {
      error_msg: undefined,
      output_status: 'pending',
    });
    extractClip(clip.id, clip.url).catch(() => {});
    return res.json(clip);
  } catch (err) {
    next(err);
  }
}

export async function handleCallback(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const body = req.body as {
      success: boolean;
      title?: string; transcript?: string; images?: unknown[];
      author?: string; author_id?: string;
      like_count?: number; comment_count?: number; share_count?: number;
      cover_url?: string; video_url?: string; raw_response?: unknown;
      error?: string;
    };

    if (!body.success) {
      await updateClipStatus(id, 'failed', { error_msg: body.error ?? 'content-service 返回失败' });
      return res.json({ ok: true });
    }

    const clip = await updateClipStatus(id, 'done', {
      title: body.title, transcript: body.transcript, images: body.images,
      author: body.author, author_id: body.author_id,
      like_count: body.like_count, comment_count: body.comment_count, share_count: body.share_count,
      cover_url: body.cover_url, video_url: body.video_url,
      raw_response: body.raw_response, processed_at: new Date(),
    });

    pushClipOutput(clip as Parameters<typeof pushClipOutput>[0]).then(async (result) => {
      const outStatus = result.success ? 'pushed' : (result.error === 'no_output_configured' ? 'skipped' : 'failed');
      await updateClipStatus(id, 'done', { output_status: outStatus }).catch(() => {});
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}

export async function getUserSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const settings = await getSettings(session.user.id);
    return res.json(settings ?? { defaultOutputUrl: null, defaultOutputType: null });
  } catch (err) {
    next(err);
  }
}

export async function saveUserSettings(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await getSession(req);
    if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
    const { defaultOutputUrl, defaultOutputType } = req.body as { defaultOutputUrl?: string; defaultOutputType?: string };
    if (!defaultOutputUrl || !defaultOutputType) {
      return res.status(400).json({ error: 'defaultOutputUrl and defaultOutputType required' });
    }
    await upsertSettings(session.user.id, { defaultOutputUrl, defaultOutputType });
    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
