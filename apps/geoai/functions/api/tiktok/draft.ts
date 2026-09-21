import {
  authenticateTikTokRequest,
  fingerprint,
  isAllowedTikTokMediaUrl,
  jsonResponse,
  missingTikTokPublishConfig,
  tiktokRequest,
  resolveTikTokStore,
  type TikTokPublishEnv,
} from './_lib';

const MAX_BODY_BYTES = 16 * 1024;

interface DraftInput {
  mode: 'preview' | 'upload';
  confirm?: string;
  idempotencyKey?: string;
  videoUrl: string;
}

interface StoredAttempt {
  state: 'pending' | 'initialized';
  fingerprint: string;
  createdAt: string;
  publishId?: string;
}

interface InitResponse {
  publish_id?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function parseInput(raw: unknown, env: TikTokPublishEnv):
  | { ok: true; value: DraftInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_json' };
  const body = raw as Record<string, unknown>;
  const mode = body.mode === undefined ? 'preview' : body.mode;
  if (mode !== 'preview' && mode !== 'upload') return { ok: false, error: 'invalid_mode' };

  const videoUrl = text(body.videoUrl);
  if (!videoUrl || !isAllowedTikTokMediaUrl(videoUrl, env)) {
    return { ok: false, error: 'video_url_must_use_verified_https_host' };
  }

  return {
    ok: true,
    value: {
      mode,
      confirm: text(body.confirm),
      idempotencyKey: text(body.idempotencyKey),
      videoUrl,
    },
  };
}

async function readJson(request: Request): Promise<unknown> {
  const value = await request.text();
  if (value.length > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(value);
}

function validIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9._:-]{8,128}$/.test(value));
}

export async function onRequestPost(context: {
  request: Request;
  env: TikTokPublishEnv;
}): Promise<Response> {
  const { request, env } = context;
  if (!authenticateTikTokRequest(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  const missing = missingTikTokPublishConfig(env);
  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: 'not_configured', missing }, 503);
  }
  if (!request.headers.get('Content-Type')?.toLowerCase().includes('application/json')) {
    return jsonResponse({ ok: false, error: 'content_type_must_be_json' }, 415);
  }

  let raw: unknown;
  try {
    raw = await readJson(request);
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'invalid_json' },
      400,
    );
  }
  const parsed = parseInput(raw, env);
  if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
  const input = parsed.value;

  const preview = {
    destination: 'TIKTOK_INBOX_DRAFT',
    videoUrl: input.videoUrl,
  };
  if (input.mode === 'preview') {
    return jsonResponse({ ok: true, mode: 'preview', request: preview });
  }
  if (env.TIKTOK_DRAFT_UPLOAD_ENABLED !== 'true' || input.confirm !== 'UPLOAD_DRAFT') {
    return jsonResponse({ ok: false, error: 'draft_upload_not_confirmed' }, 403);
  }
  if (!validIdempotencyKey(input.idempotencyKey)) {
    return jsonResponse({ ok: false, error: 'valid_idempotency_key_required' }, 400);
  }
  const store = resolveTikTokStore(env);
  if (!store) {
    return jsonResponse({ ok: false, error: 'idempotency_store_not_configured' }, 503);
  }

  const digest = await fingerprint(preview);

  // 快路径，语义同 publish.ts：只处理已确定的结果，不承担互斥职责。
  const known = await store.read('draft', input.idempotencyKey);
  if (known) {
    if (known.fingerprint !== digest) {
      return jsonResponse({ ok: false, error: 'idempotency_key_conflict' }, 409);
    }
    if (known.state === 'initialized' && known.publishId) {
      return jsonResponse({ ok: true, replayed: true, result: { publishId: known.publishId } });
    }
    return jsonResponse({ ok: false, error: 'upload_outcome_requires_review' }, 409);
  }

  // 原子声明，理由同 publish.ts：先 read 再 write 的窗口会让并发请求重复上传。
  const claimed = await store.claim('draft', input.idempotencyKey, {
    state: 'pending',
    fingerprint: digest,
    createdAt: new Date().toISOString(),
  });
  if (!claimed.claimed) {
    const existing = claimed.existing;
    if (existing.fingerprint !== digest) {
      return jsonResponse({ ok: false, error: 'idempotency_key_conflict' }, 409);
    }
    if (existing.state === 'initialized' && existing.publishId) {
      return jsonResponse({ ok: true, replayed: true, result: { publishId: existing.publishId } });
    }
    return jsonResponse({ ok: false, error: 'upload_outcome_requires_review' }, 409);
  }

  const result = await tiktokRequest<InitResponse>(
    env,
    '/v2/post/publish/inbox/video/init/',
    {
      source_info: {
        source: 'PULL_FROM_URL',
        video_url: input.videoUrl,
      },
    },
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'tiktok_error', detail: result.error }, result.status);
  }
  if (!result.data.publish_id) {
    return jsonResponse({ ok: false, error: 'missing_publish_id' }, 502);
  }

  await store.update('draft', input.idempotencyKey, {
    state: 'initialized',
    fingerprint: digest,
    createdAt: new Date().toISOString(),
    publishId: result.data.publish_id,
  });

  return jsonResponse({
    ok: true,
    replayed: false,
    result: { publishId: result.data.publish_id },
  });
}
