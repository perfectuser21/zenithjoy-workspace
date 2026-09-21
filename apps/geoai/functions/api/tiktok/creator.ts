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
    idempotencyConfigured: Boolean(env.TIKTOK_IDEMPOTENCY),
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

