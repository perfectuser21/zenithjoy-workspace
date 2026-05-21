const PROXY_URL = process.env.CONTENT_SERVICE_PROXY_URL || 'http://38.23.47.81:7786';
const API_PUBLIC_URL = process.env.API_PUBLIC_URL || 'http://38.23.47.81:5200';

export async function extractClip(clipId: string, url: string): Promise<void> {
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
