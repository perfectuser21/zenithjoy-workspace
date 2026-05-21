const PROXY_URL = process.env.CONTENT_SERVICE_PROXY_URL;
const API_PUBLIC_URL = process.env.API_PUBLIC_URL;

export async function extractClip(clipId: string, url: string): Promise<void> {
  if (!PROXY_URL || !API_PUBLIC_URL) {
    console.warn('[clips-extractor] CONTENT_SERVICE_PROXY_URL / API_PUBLIC_URL 未配置，跳过内容提取');
    return;
  }
  const callbackUrl = `${API_PUBLIC_URL}/api/clips/${clipId}/callback`;
  try {
    await fetch(`${PROXY_URL}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, callback_url: callbackUrl }),
    });
  } catch (err) {
    console.error('[clips-extractor] content-service 请求失败:', err);
  }
}
