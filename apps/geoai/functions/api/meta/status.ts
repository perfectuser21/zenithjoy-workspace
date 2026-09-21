import {
  authenticateRequest,
  graphRequest,
  jsonResponse,
  missingMetaConfig,
  type MetaEnv,
} from './_lib';

interface PageAssetResponse {
  id?: string;
  name?: string;
  instagram_business_account?: {
    id?: string;
    username?: string;
  };
}
export async function onRequestGet(context: {
  request: Request;
  env: MetaEnv;
}): Promise<Response> {
  const { request, env } = context;
  if (!authenticateRequest(request, env)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  const missing = missingMetaConfig(env);
  if (missing.length > 0) {
    return jsonResponse({ ok: false, error: 'not_configured', missing }, 503);
  }

  const pageId = env.META_PAGE_ID!;
  const instagramId = env.META_INSTAGRAM_BUSINESS_ACCOUNT_ID!;
  const result = await graphRequest<PageAssetResponse>(env, pageId, {
    method: 'GET',
    params: {
      fields: 'id,name,instagram_business_account{id,username}',
    },
  });
  if (!result.ok) {
    return jsonResponse({ ok: false, error: 'graph_error', detail: result.error }, result.status);
  }

  const actualPageId = result.data.id || '';
  const actualInstagram = result.data.instagram_business_account;
  if (actualPageId !== pageId || actualInstagram?.id !== instagramId) {
    return jsonResponse(
      {
        ok: false,
        error: 'asset_mismatch',
        expected: { pageId, instagramBusinessAccountId: instagramId },
        observed: {
          pageId: actualPageId || null,
          instagramBusinessAccountId: actualInstagram?.id || null,
        },
      },
      409,
    );
  }

  return jsonResponse({
    ok: true,
    graphApiVersion: env.META_GRAPH_API_VERSION,
    publishingEnabled: env.META_PUBLISH_ENABLED === 'true',
    // 必须与 publish.ts 的 resolveStore 同一套优先级：D1 优先、KV 兜底。
    // 只看 KV 会在 D1 迁移后误报"没配幂等"，诱使运维把不安全的 KV 加回来。
    idempotencyConfigured: Boolean(env.META_PUBLISH_DB || env.META_IDEMPOTENCY),
    idempotencyBackend: env.META_PUBLISH_DB ? 'd1' : (env.META_IDEMPOTENCY ? 'kv' : null),
    assets: {
      page: { id: actualPageId, name: result.data.name || null },
      instagram: {
        id: actualInstagram.id,
        username: actualInstagram.username || null,
      },
    },
  });
}
