const PROXY_URL = process.env.CONTENT_SERVICE_PROXY_URL;
const API_PUBLIC_URL = process.env.API_PUBLIC_URL;
const OCR_RELAY_URL = process.env.OCR_RELAY_URL;

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

export async function ocrImages(imageUrls: string[]): Promise<string | null> {
  if (!imageUrls || imageUrls.length === 0) return null;
  if (!OCR_RELAY_URL) {
    console.warn('[clips-extractor] OCR_RELAY_URL 未配置，跳过 OCR');
    return null;
  }
  try {
    const resp = await fetch(`${OCR_RELAY_URL}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_urls: imageUrls.slice(0, 9) }),
      signal: AbortSignal.timeout(90000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { ocr_text?: string };
    return data.ocr_text?.trim() || null;
  } catch {
    return null;
  }
}
