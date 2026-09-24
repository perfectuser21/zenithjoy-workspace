import {
  authenticateTikTokRequest,
  jsonResponse,
  missingTikTokPublishConfig,
  tiktokRequest,
  type TikTokCreatorInfo,
  type TikTokPublishEnv,
} from './_lib';

export async function onRequestGet(context: {
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

  const result = await tiktokRequest<TikTokCreatorInfo>(
    env,
    '/v2/post/publish/creator_info/query/',
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'tiktok_error', detail: result.error }, result.status);
  }

  return jsonResponse({
    ok: true,
    publishingEnabled: env.TIKTOK_PUBLISH_ENABLED === 'true',
    // 必须与 publish/draft 的 resolveTikTokStore 同一套优先级：D1 优先、KV 兜底。
    // 只看 KV 会在 D1 迁移后误报"没配幂等"，诱使把无原子声明的 KV 加回来——
    // 那正是重复发帖的来源。健康检查说反话比没有健康检查更糟。
    idempotencyConfigured: Boolean(env.TIKTOK_PUBLISH_DB || env.TIKTOK_IDEMPOTENCY),
    idempotencyBackend: env.TIKTOK_PUBLISH_DB ? 'd1' : (env.TIKTOK_IDEMPOTENCY ? 'kv' : null),
    creator: {
      username: result.data.creator_username || null,
      nickname: result.data.creator_nickname || null,
      privacyLevelOptions: result.data.privacy_level_options || [],
      interactionRestrictions: {
        commentsDisabled: Boolean(result.data.comment_disabled),
        duetDisabled: Boolean(result.data.duet_disabled),
        stitchDisabled: Boolean(result.data.stitch_disabled),
      },
      maxVideoDurationSeconds: result.data.max_video_post_duration_sec || null,
    },
  });
}

