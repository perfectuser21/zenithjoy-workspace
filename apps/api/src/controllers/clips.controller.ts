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
import { extractClip, ocrImages } from '../services/clips-extractor.service';
import { parseOutputUrl, pushClipOutput } from '../services/clip-output.service';
import { validateNotionToken } from '../services/clips-auth.service';
import { upsertNotionToken, clearFeishuBinding, clearNotionToken } from '../services/clips.service';

async function getSession(req: Request) {
  return auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
}

// 把 jingxuan?modal_id=VIDEOID 转换成 /video/VIDEOID 让 content-service 能识别
function normalizeDouyinUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'www.douyin.com' && u.pathname.includes('jingxuan')) {
      const modalId = u.searchParams.get('modal_id');
      if (modalId) return `https://www.douyin.com/video/${modalId}`;
    }
  } catch {}
  return url;
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

    const normalizedUrl = normalizeDouyinUrl(rawUrl.trim());
    const platform = detectPlatform(normalizedUrl);
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

    const existing = await getExistingClip(userId, normalizedUrl);
    if (existing) {
      return res.status(409).json({ error: 'already_exists', id: existing.id });
    }

    const clip = await createClip({ userId, url: normalizedUrl, platform, outputUrl, outputType });
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
      content_type?: '图文' | '短视频';
      duration_ms?: number;
      title?: string; transcript?: string; text?: string; images?: unknown[];
      author?: string; author_id?: string;
      like_count?: number; comment_count?: number; share_count?: number;
      cover_url?: string; video_url?: string; raw_response?: unknown;
      error?: string;
    };

    if (!body.success) {
      let errorMsg = body.error ?? 'content-service 返回失败';
      // 短链解析到平台首页时给出更友好的提示
      if (/Cannot determine.*type|douyin\.com["']?\s*$/.test(errorMsg)) {
        errorMsg = '链接无法解析，可能已失效，请重新复制分享链接';
      }
      await updateClipStatus(id, 'failed', { error_msg: errorMsg });
      return res.json({ ok: true });
    }

    // 图文判断：XHS 直接看 content_type；抖音图文被 content-service 误判为短视频，用 duration_ms===0 识别
    const isGraphicPost = body.content_type === '图文' || (body.content_type === '短视频' && body.duration_ms === 0);
    const effectiveContentType = isGraphicPost ? '图文' : '短视频';

    // 检测短链解析到平台首页（标题是平台首页标题，无封面无图片）
    const HOMEPAGE_TITLES = ['小红书 - 你的生活兴趣社区', '你的生活兴趣社区', '抖音-记录美好生活'];
    const isHomepageContent = HOMEPAGE_TITLES.some(t => body.title?.includes(t));
    if (isHomepageContent) {
      await updateClipStatus(id, 'failed', { error_msg: '链接无法访问或已失效，请重新复制分享链接后提交' });
      return res.json({ ok: true });
    }
    // 图文只要 title（帖子文字描述），transcript 是背景音乐不要；短视频用语音转写
    const effectiveTranscript = isGraphicPost ? null : (body.transcript ?? null);

    const clip = await updateClipStatus(id, 'done', {
      content_type: effectiveContentType,
      title: body.title, transcript: effectiveTranscript ?? undefined, text: body.text ?? undefined,
      images: body.images,
      author: body.author, author_id: body.author_id,
      like_count: body.like_count, comment_count: body.comment_count, share_count: body.share_count,
      cover_url: body.cover_url, video_url: body.video_url,
      raw_response: body.raw_response, processed_at: new Date(),
    });

    pushClipOutput(clip as Parameters<typeof pushClipOutput>[0]).then(async (result) => {
      const outStatus = result.success ? 'pushed' : (['no_output_configured', 'no_binding'].includes(result.error ?? '') ? 'skipped' : 'failed');
      await updateClipStatus(id, 'done', { output_status: outStatus }).catch(() => {});
    }).catch(() => {});

    // 图文帖子：异步 OCR 图片文字
    if (isGraphicPost && Array.isArray(body.images) && body.images.length > 0) {
      const imageUrls = (body.images as string[]).filter(u => typeof u === 'string');
      if (imageUrls.length > 0) {
        ocrImages(imageUrls).then(async (ocrText) => {
          if (ocrText) await updateClipStatus(id, 'done', { ocr_text: ocrText }).catch(() => {});
        }).catch(() => {});
      }
    }

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

export async function saveNotionToken(req: Request, res: Response) {
  const session = await getSession(req);
  if (!session?.user) return res.status(401).json({ error: 'unauthorized' });

  const { token } = req.body as { token: string };
  if (!token || (!token.startsWith('ntn_') && !token.startsWith('secret_'))) {
    return res.status(400).json({ error: 'invalid_token_format' });
  }

  const valid = await validateNotionToken(token);
  if (!valid) return res.status(400).json({ error: 'notion_token_invalid' });

  await upsertNotionToken(session.user.id, token);
  return res.json({ success: true });
}

export async function deleteFeishuBinding(req: Request, res: Response) {
  const session = await getSession(req);
  if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
  await clearFeishuBinding(session.user.id);
  return res.json({ success: true });
}

export async function deleteNotionBinding(req: Request, res: Response) {
  const session = await getSession(req);
  if (!session?.user) return res.status(401).json({ error: 'unauthorized' });
  await clearNotionToken(session.user.id);
  return res.json({ success: true });
}
