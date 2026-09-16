import {
  authenticateRequest,
  fingerprint,
  graphRequest,
  isHttpsUrl,
  jsonResponse,
  missingMetaConfig,
  type MetaEnv,
  type MetaIdempotencyStore,
  d1IdempotencyStore,
} from './_lib';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_FACEBOOK_MESSAGE = 63_000;
const MAX_INSTAGRAM_CAPTION = 2_200;
const PENDING_TTL_SECONDS = 24 * 60 * 60;
const SUCCEEDED_TTL_SECONDS = 7 * 24 * 60 * 60;

type Platform = 'facebook' | 'instagram';
type Mode = 'preview' | 'publish';

interface PublishInput {
  platform: Platform;
  mode: Mode;
  confirm?: string;
  idempotencyKey?: string;
  message?: string;
  caption?: string;
  mediaUrl?: string;
}
interface StoredAttempt {
  state: 'pending' | 'instagram_container_created' | 'succeeded';
  fingerprint: string;
  createdAt: string;
  containerId?: string;
  result?: { id: string };
}

function parseText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

function parseInput(raw: unknown):
  | { ok: true; value: PublishInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_json' };
  const body = raw as Record<string, unknown>;
  const platform = body.platform;
  if (platform !== 'facebook' && platform !== 'instagram') {
    return { ok: false, error: 'invalid_platform' };
  }
  const mode = body.mode === undefined ? 'preview' : body.mode;
  if (mode !== 'preview' && mode !== 'publish') {
    return { ok: false, error: 'invalid_mode' };
  }

  const message = parseText(body.message);
  const caption = parseText(body.caption);
  const mediaUrl = parseText(body.mediaUrl);
  if (mediaUrl && !isHttpsUrl(mediaUrl)) {
    return { ok: false, error: 'media_url_must_be_https' };
  }
  if (platform === 'facebook' && !message && !mediaUrl) {
    return { ok: false, error: 'facebook_message_or_media_required' };
  }
  if (message && message.length > MAX_FACEBOOK_MESSAGE) {
    return { ok: false, error: 'facebook_message_too_long' };
  }
  if (platform === 'instagram' && !mediaUrl) {
    return { ok: false, error: 'instagram_media_required' };
  }
  if (caption && caption.length > MAX_INSTAGRAM_CAPTION) {
    return { ok: false, error: 'instagram_caption_too_long' };
  }

  return {
    ok: true,
    value: {
      platform,
      mode,
      confirm: parseText(body.confirm),
      idempotencyKey: parseText(body.idempotencyKey),
      message,
      caption,
      mediaUrl,
    },
  };
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(text);
}

function validIdempotencyKey(value: string | undefined): value is string {
  return Boolean(value && /^[A-Za-z0-9._:-]{8,128}$/.test(value));
}

async function resolveStore(env: MetaEnv): Promise<MetaIdempotencyStore | null> {
  // D1 优先：只有它能提供原子声明。KV 形态的 META_IDEMPOTENCY 仅供单测注入。
  if (env.META_PUBLISH_DB) return d1IdempotencyStore(env.META_PUBLISH_DB);
  return env.META_IDEMPOTENCY ?? null;
}

function publicPreview(input: PublishInput) {
  return {
    platform: input.platform,
    mediaUrl: input.mediaUrl || null,
    textLength: input.platform === 'facebook'
      ? (input.message || input.caption || '').length
      : (input.caption || '').length,
  };
}

async function publishFacebook(env: MetaEnv, input: PublishInput) {
  const pageId = env.META_PAGE_ID!;
  if (input.mediaUrl) {
    return graphRequest<{ id: string }>(env, `${pageId}/photos`, {
      method: 'POST',
      params: {
        url: input.mediaUrl,
        caption: input.message || input.caption || '',
        published: 'true',
      },
    });
  }
  return graphRequest<{ id: string }>(env, `${pageId}/feed`, {
    method: 'POST',
    params: { message: input.message! },
  });
}

async function publishInstagram(
  env: MetaEnv,
  input: PublishInput,
  store: MetaIdempotencyStore,
  key: string,
  digest: string,
  existing: StoredAttempt | null,
) {
  let containerId = existing?.state === 'instagram_container_created'
    ? existing.containerId
    : undefined;
  if (!containerId) {
    const created = await graphRequest<{ id: string }>(
      env,
      `${env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID!}/media`,
      {
        method: 'POST',
        params: {
          image_url: input.mediaUrl!,
          caption: input.caption || '',
        },
      },
    );
    if (!created.ok) return created;
    containerId = created.data.id;
    // 容器已建：先落盘再 publish。若此处之后失败，重试会复用同一容器，
    // 不会在 Instagram 侧留下第二个容器。
    await store.update(key, {
      state: 'instagram_container_created',
      fingerprint: digest,
      createdAt: new Date().toISOString(),
      containerId,
    });
  }

  return graphRequest<{ id: string }>(
    env,
    `${env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID!}/media_publish`,
    { method: 'POST', params: { creation_id: containerId } },
  );
}

export async function onRequestPost(context: {
  request: Request;
  env: MetaEnv;
}): Promise<Response> {
  const { request, env } = context;
  if (!authenticateRequest(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
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
  const parsed = parseInput(raw);
  if (!parsed.ok) return jsonResponse({ ok: false, error: parsed.error }, 400);
  const input = parsed.value;

  // preview 不触碰 Graph API、不需要任何 Meta 凭据，故刻意放在配置闸之前：
  // 否则「先审内容、后配凭据」的审批流程无法进行（凭据到位前连预览都做不了）。
  // 真实发布的门禁一个不少，全在下面。
  if (input.mode === 'preview') {
    return jsonResponse({ ok: true, mode: 'preview', request: publicPreview(input) });
  }

  // ↓↓↓ 以下为真实发布路径，配置必须齐全 ↓↓↓
  const missing = missingMetaConfig(env);
  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: 'not_configured', missing }, 503);
  }
  if (env.META_PUBLISH_ENABLED !== 'true' || input.confirm !== 'PUBLISH') {
    return jsonResponse({ ok: false, error: 'publishing_not_confirmed' }, 403);
  }
  if (!validIdempotencyKey(input.idempotencyKey)) {
    return jsonResponse({ ok: false, error: 'valid_idempotency_key_required' }, 400);
  }
  const store = await resolveStore(env);
  if (!store) {
    return jsonResponse({ ok: false, error: 'idempotency_store_not_configured' }, 503);
  }

  const contentFingerprint = await fingerprint({
    platform: input.platform,
    message: input.message || null,
    caption: input.caption || null,
    mediaUrl: input.mediaUrl || null,
  });
  // 原子声明：同一 key 只有一个调用者能拿到 claimed=true。
  // 绝不能改回「先 read 再 write」——那之间的窗口会让并发请求重复发帖。
  const claimResult = await store.claim(input.idempotencyKey, {
    state: 'pending',
    fingerprint: contentFingerprint,
    createdAt: new Date().toISOString(),
  });

  let existing: StoredAttempt | null = null;
  if (!claimResult.claimed) {
    existing = claimResult.existing;
    if (existing.fingerprint !== contentFingerprint) {
      return jsonResponse({ ok: false, error: 'idempotency_key_conflict' }, 409);
    }
    if (existing.state === 'succeeded' && existing.result) {
      return jsonResponse({ ok: true, replayed: true, result: existing.result });
    }
    // 已被他人声明但尚未收敛：可能正在发布、也可能上次结果丢失。
    // 一律要求人工复核，绝不盲目重试（重试会重复发帖）。
    return jsonResponse({ ok: false, error: 'publish_outcome_requires_review' }, 409);
  }

  const result = input.platform === 'facebook'
    ? await publishFacebook(env, input)
    : await publishInstagram(
        env,
        input,
        store,
        input.idempotencyKey,
        contentFingerprint,
        existing,
      );
  if (!result.ok) {
    // Keep pending/container state. Blind retry after an ambiguous network or
    // upstream failure can duplicate a public post.
    return jsonResponse({ ok: false, error: 'graph_error', detail: result.error }, result.status);
  }

  const publicResult = { id: result.data.id };
  await store.update(input.idempotencyKey, {
    state: 'succeeded',
    fingerprint: contentFingerprint,
    createdAt: new Date().toISOString(),
    result: publicResult,
  });
  return jsonResponse({ ok: true, replayed: false, result: publicResult });
}
