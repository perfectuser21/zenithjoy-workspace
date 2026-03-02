// 页面计数器 + 评论 + 点赞 Worker

export default {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const slug = url.searchParams.get('slug');

    if (!slug) {
      return jsonResponse({ error: 'Missing slug' }, 400, corsHeaders);
    }

    try {
      // 阅读量
      if (path === '/' || path === '/views') {
        return await handleViews(request, env, slug, corsHeaders);
      }

      // 评论
      if (path === '/comments') {
        return await handleComments(request, env, slug, corsHeaders);
      }

      // 点赞
      if (path === '/likes') {
        return await handleLikes(request, env, slug, corsHeaders);
      }

      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500, corsHeaders);
    }
  },
};

// 阅读量处理
async function handleViews(request, env, slug, corsHeaders) {
  const key = `views:${slug}`;
  let views = parseInt(await env.PAGE_VIEWS.get(key)) || 0;

  if (request.method === 'POST') {
    views += 1;
    await env.PAGE_VIEWS.put(key, views.toString());
  }

  return jsonResponse({ slug, views }, 200, corsHeaders);
}

// 评论处理
async function handleComments(request, env, slug, corsHeaders) {
  const key = `comments:${slug}`;

  if (request.method === 'GET') {
    const data = await env.COMMENTS.get(key, 'json') || [];
    return jsonResponse({ slug, comments: data }, 200, corsHeaders);
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const content = (body.content || '').trim();

    if (!content || content.length > 500) {
      return jsonResponse({ error: 'Invalid comment' }, 400, corsHeaders);
    }

    const comments = await env.COMMENTS.get(key, 'json') || [];

    const newComment = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      content,
      nickname: (body.nickname || '').trim().slice(0, 20) || '匿名',
      createdAt: new Date().toISOString(),
    };

    comments.unshift(newComment); // 新评论在前

    // 最多保留 100 条
    if (comments.length > 100) {
      comments.pop();
    }

    await env.COMMENTS.put(key, JSON.stringify(comments));

    return jsonResponse({ slug, comment: newComment, total: comments.length }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
}

// 点赞处理
async function handleLikes(request, env, slug, corsHeaders) {
  const key = `likes:${slug}`;

  if (request.method === 'GET') {
    const likes = parseInt(await env.PAGE_VIEWS.get(key)) || 0;
    return jsonResponse({ slug, likes }, 200, corsHeaders);
  }

  if (request.method === 'POST') {
    let likes = parseInt(await env.PAGE_VIEWS.get(key)) || 0;
    likes += 1;
    await env.PAGE_VIEWS.put(key, likes.toString());
    return jsonResponse({ slug, likes }, 200, corsHeaders);
  }

  return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
}

function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
