import {
  authenticateTikTokRequest,
  jsonResponse,
  missingTikTokPublishConfig,
  tiktokRequest,
  type TikTokPublishEnv,
} from './_lib';

const MAX_BODY_BYTES = 8 * 1024;

interface StatusResponse {
  status?: string;
  fail_reason?: string;
  publicaly_available_post_id?: Array<string | number>;
  uploaded_bytes?: number;
  downloaded_bytes?: number;
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

  let publishId = '';
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) throw new Error('body_too_large');
    const body = JSON.parse(text) as Record<string, unknown>;
    publishId = typeof body.publishId === 'string' ? body.publishId.trim() : '';
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'invalid_json' },
      400,
    );
  }
  if (!publishId || publishId.length > 64) {
    return jsonResponse({ ok: false, error: 'valid_publish_id_required' }, 400);
  }

  const result = await tiktokRequest<StatusResponse>(
    env,
    '/v2/post/publish/status/fetch/',
    { publish_id: publishId },
  );
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'tiktok_error', detail: result.error }, result.status);
  }

  return jsonResponse({
    ok: true,
    publishId,
    status: result.data.status || null,
    failReason: result.data.fail_reason || null,
    publicPostIds: result.data.publicaly_available_post_id || [],
    transferredBytes: result.data.downloaded_bytes ?? result.data.uploaded_bytes ?? null,
  });
}

