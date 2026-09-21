import {
  authenticateTikTokRequest,
  fingerprint,
  isAllowedTikTokMediaUrl,
  jsonResponse,
  missingTikTokPublishConfig,
  tiktokRequest,
  type TikTokIdempotencyStore,
  type TikTokPublishEnv,
} from './_lib';

const MAX_BODY_BYTES = 16 * 1024;
const PENDING_TTL_SECONDS = 24 * 60 * 60;
const INITIALIZED_TTL_SECONDS = 7 * 24 * 60 * 60;

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

async function loadAttempt(store: TikTokIdempotencyStore, key: string): Promise<StoredAttempt | null> {
  const raw = await store.get(`tiktok-draft:${key}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredAttempt;
  } catch {
    return { state: 'pending', fingerprint: 'corrupt', createdAt: new Date().toISOString() };
  }
}

async function saveAttempt(
  store: TikTokIdempotencyStore,
  key: string,
  attempt: StoredAttempt,
  ttl: number,
): Promise<void> {
  await store.put(`tiktok-draft:${key}`, JSON.stringify(attempt), { expirationTtl: ttl });
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
  const store = env.TIKTOK_IDEMPOTENCY;
  if (!store) {
    return jsonResponse({ ok: false, error: 'idempotency_store_not_configured' }, 503);
  }

  const digest = await fingerprint(preview);
  const existing = await loadAttempt(store, input.idempotencyKey);
  if (existing && existing.fingerprint !== digest) {
    return jsonResponse({ ok: false, error: 'idempotency_key_conflict' }, 409);
  }
  if (existing?.state === 'initialized' && existing.publishId) {
    return jsonResponse({ ok: true, replayed: true, result: { publishId: existing.publishId } });
  }
  if (existing?.state === 'pending') {
    return jsonResponse({ ok: false, error: 'upload_outcome_requires_review' }, 409);
  }

  await saveAttempt(
    store,
    input.idempotencyKey,
    { state: 'pending', fingerprint: digest, createdAt: new Date().toISOString() },
    PENDING_TTL_SECONDS,
  );

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

  await saveAttempt(
    store,
    input.idempotencyKey,
    {
      state: 'initialized',
      fingerprint: digest,
      createdAt: new Date().toISOString(),
      publishId: result.data.publish_id,
    },
    INITIALIZED_TTL_SECONDS,
  );

  return jsonResponse({
    ok: true,
    replayed: false,
    result: { publishId: result.data.publish_id },
  });
}
