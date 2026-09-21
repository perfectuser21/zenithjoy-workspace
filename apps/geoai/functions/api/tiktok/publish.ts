import {
  authenticateTikTokRequest,
  fingerprint,
  isAllowedTikTokMediaUrl,
  jsonResponse,
  missingTikTokPublishConfig,
  tiktokRequest,
  type TikTokCreatorInfo,
  resolveTikTokStore,
  type TikTokPublishEnv,
} from './_lib';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_TITLE_LENGTH = 2_200;

interface PublishInput {
  mode: 'preview' | 'publish';
  confirm?: string;
  idempotencyKey?: string;
  videoUrl: string;
  durationSeconds: number;
  title?: string;
  isAigc: boolean;
  promotesOwnBrand: boolean;
  paidPartnership: boolean;
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
  | { ok: true; value: PublishInput }
  | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid_json' };
  const body = raw as Record<string, unknown>;
  const mode = body.mode === undefined ? 'preview' : body.mode;
  if (mode !== 'preview' && mode !== 'publish') return { ok: false, error: 'invalid_mode' };

  const videoUrl = text(body.videoUrl);
  if (!videoUrl || !isAllowedTikTokMediaUrl(videoUrl, env)) {
    return { ok: false, error: 'video_url_must_use_verified_https_host' };
  }
  const title = text(body.title);
  if (title && title.length > MAX_TITLE_LENGTH) {
    return { ok: false, error: 'title_too_long' };
  }
  if (body.isAigc !== undefined && typeof body.isAigc !== 'boolean') {
    return { ok: false, error: 'is_aigc_must_be_boolean' };
  }
  if (body.promotesOwnBrand !== undefined && typeof body.promotesOwnBrand !== 'boolean') {
    return { ok: false, error: 'promotes_own_brand_must_be_boolean' };
  }
  if (body.paidPartnership !== undefined && typeof body.paidPartnership !== 'boolean') {
    return { ok: false, error: 'paid_partnership_must_be_boolean' };
  }
  if (
    typeof body.durationSeconds !== 'number' ||
    !Number.isFinite(body.durationSeconds) ||
    body.durationSeconds <= 0 ||
    body.durationSeconds > 600
  ) {
    return { ok: false, error: 'valid_duration_seconds_required' };
  }

  return {
    ok: true,
    value: {
      mode,
      confirm: text(body.confirm),
      idempotencyKey: text(body.idempotencyKey),
      videoUrl,
      durationSeconds: body.durationSeconds,
      title,
      isAigc: body.isAigc === true,
      promotesOwnBrand: body.promotesOwnBrand === true,
      paidPartnership: body.paidPartnership === true,
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
    privacyLevel: 'SELF_ONLY',
    videoUrl: input.videoUrl,
    durationSeconds: input.durationSeconds,
    titleLength: input.title?.length || 0,
    interactionsDisabled: true,
    isAigc: input.isAigc,
    promotesOwnBrand: input.promotesOwnBrand,
    paidPartnership: input.paidPartnership,
  };
  if (input.mode === 'preview') {
    return jsonResponse({ ok: true, mode: 'preview', request: preview });
  }
  if (env.TIKTOK_PUBLISH_ENABLED !== 'true' || input.confirm !== 'PUBLISH_PRIVATE') {
    return jsonResponse({ ok: false, error: 'private_publishing_not_confirmed' }, 403);
  }
  if (!validIdempotencyKey(input.idempotencyKey)) {
    return jsonResponse({ ok: false, error: 'valid_idempotency_key_required' }, 400);
  }
  const store = resolveTikTokStore(env);
  if (!store) {
    return jsonResponse({ ok: false, error: 'idempotency_store_not_configured' }, 503);
  }

  const digest = await fingerprint(preview);

  // 快路径：结果已经确定的（重放 / 指纹冲突 / 待人工复核）直接返回，
  // 省掉一次 creator_info 往返。这只是优化——真正的互斥在下面的 claim，
  // 读到空并不代表可以发布。
  const known = await store.read('publish', input.idempotencyKey);
  if (known) {
    if (known.fingerprint !== digest) {
      return jsonResponse({ ok: false, error: 'idempotency_key_conflict' }, 409);
    }
    if (known.state === 'initialized' && known.publishId) {
      return jsonResponse({ ok: true, replayed: true, result: { publishId: known.publishId } });
    }
    return jsonResponse({ ok: false, error: 'publish_outcome_requires_review' }, 409);
  }

  const creator = await tiktokRequest<TikTokCreatorInfo>(
    env,
    '/v2/post/publish/creator_info/query/',
  );
  if (!creator.ok) {
    return jsonResponse({ ok: false, error: 'tiktok_error', detail: creator.error }, creator.status);
  }
  if (!creator.data.privacy_level_options?.includes('SELF_ONLY')) {
    return jsonResponse({ ok: false, error: 'self_only_not_available' }, 409);
  }
  const creatorMaxDuration = creator.data.max_video_post_duration_sec;
  if (
    typeof creatorMaxDuration === 'number' &&
    input.durationSeconds > creatorMaxDuration
  ) {
    return jsonResponse(
      {
        ok: false,
        error: 'video_exceeds_creator_duration_limit',
        maxVideoDurationSeconds: creatorMaxDuration,
      },
      409,
    );
  }

  // 原子声明：同一 (operation, key) 只有一个调用者能拿到 claimed=true。
  // 绝不能改回「先 read 再 write」——那之间的窗口会让并发请求各自调一次
  // TikTok 发布接口，也就是重复发帖。
  const claimed = await store.claim('publish', input.idempotencyKey, {
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
    // 已被他人声明但尚未收敛：可能正在发布、也可能上次结果丢失。
    // 一律要求人工复核，绝不盲目重试（重试会重复发帖）。
    return jsonResponse({ ok: false, error: 'publish_outcome_requires_review' }, 409);
  }

  const result = await tiktokRequest<InitResponse>(env, '/v2/post/publish/video/init/', {
    post_info: {
      title: input.title || '',
      privacy_level: 'SELF_ONLY',
      disable_duet: true,
      disable_comment: true,
      disable_stitch: true,
      brand_content_toggle: input.paidPartnership,
      brand_organic_toggle: input.promotesOwnBrand,
      is_aigc: input.isAigc,
    },
    source_info: {
      source: 'PULL_FROM_URL',
      video_url: input.videoUrl,
    },
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'tiktok_error', detail: result.error }, result.status);
  }
  if (!result.data.publish_id) {
    return jsonResponse({ ok: false, error: 'missing_publish_id' }, 502);
  }

  await store.update('publish', input.idempotencyKey, {
    state: 'initialized',
    fingerprint: digest,
    createdAt: new Date().toISOString(),
    publishId: result.data.publish_id,
  });
  return jsonResponse({ ok: true, replayed: false, result: { publishId: result.data.publish_id } });
}
