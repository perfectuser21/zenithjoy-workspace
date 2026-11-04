'use strict';
/** Provider acceptance only. A webhook response cannot prove message delivery/readback. */
async function sendFeishuQrCard(platform, screenshotBuffer, { fetchFn = fetch, env = process.env } = {}) {
  const appId = env.FEISHU_APP_ID || '', appSecret = env.FEISHU_APP_SECRET || '', webhook = env.ZENITHJOY_FEISHU_WEBHOOK || '';
  if (!appId || !appSecret || !webhook) return { status: 'missing_configuration', delivery_verified: false };
  try {
    const post = async (url, options) => {
      const response = await fetchFn(url, { ...options, signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
      return response.json();
    };
    const token = await post('https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    if (token.code !== 0 || !token.app_access_token) throw new Error('provider token rejected');
    const form = new FormData(); form.append('image_type', 'message');
    form.append('image', new Blob([screenshotBuffer], { type: 'image/png' }), 'qr.png');
    const image = await post('https://open.feishu.cn/open-apis/im/v1/images', { method: 'POST', headers: { Authorization: `Bearer ${token.app_access_token}` }, body: form });
    const imageKey = image.data?.image_key;
    if (image.code !== 0 || !imageKey) throw new Error('provider image rejected');
    const display = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', shipinhao: '视频号', toutiao: '头条', weibo: '微博', zhihu: '知乎', gongzhonghao: '公众号' }[platform] || platform;
    const card = await post(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ msg_type: 'interactive', card: {
      header: { title: { tag: 'plain_text', content: `🔑 ${display} 扫码绑定请求` }, template: 'blue' },
      elements: [{ tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '二维码' } }, { tag: 'div', text: { tag: 'plain_text', content: '请在 3 分钟内用手机扫描上方二维码' } }],
    } }) });
    const apiCode = card.code ?? card.StatusCode;
    if (apiCode !== 0) throw new Error('provider card rejected');
    return { status: 'api_accepted', image_key: imageKey, api_code: apiCode,
      message_id: card.data?.message_id ?? null, delivery_verified: false };
  } catch (error) { return { status: 'failed', error: error.message, delivery_verified: false }; }
}
module.exports = { sendFeishuQrCard };
