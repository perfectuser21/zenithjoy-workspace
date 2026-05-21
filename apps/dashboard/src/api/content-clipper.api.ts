export interface Clip {
  id: string;
  user_id: string;
  url: string;
  platform: 'douyin' | 'xiaohongshu';
  status: 'pending' | 'processing' | 'done' | 'failed';
  title: string | null;
  transcript: string | null;
  images: string[];
  author: string | null;
  like_count: number | null;
  cover_url: string | null;
  video_url: string | null;
  output_url: string | null;
  output_type: string | null;
  output_status: string | null;
  error_msg: string | null;
  retry_count: number;
  created_at: string;
  processed_at: string | null;
}

export interface ClipSettings {
  defaultOutputUrl: string | null;
  defaultOutputType: string | null;
}

const BASE = '/api/clips';

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'include', ...init });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (json as { error?: string }).error || res.statusText;
    const e = Object.assign(new Error(err), { status: res.status, body: json });
    throw e;
  }
  return json as T;
}

export async function submitClip(
  url: string,
  outputUrl?: string
): Promise<Clip & { alreadyExists?: boolean }> {
  try {
    return await apiFetch<Clip>(BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, output_url: outputUrl || undefined }),
    });
  } catch (err: unknown) {
    const e = err as { status?: number; body?: { id?: string } };
    if (e.status === 409 && e.body?.id) {
      return { id: e.body.id } as Clip & { alreadyExists: true };
    }
    throw err;
  }
}

export async function listClips(params: {
  platform?: string;
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<{ data: Clip[]; total: number }> {
  const q = new URLSearchParams();
  if (params.platform && params.platform !== 'all') q.set('platform', params.platform);
  if (params.status && params.status !== 'all') q.set('status', params.status);
  q.set('limit', String(params.limit ?? 20));
  q.set('offset', String(params.offset ?? 0));
  return apiFetch<{ success: true; data: Clip[]; total: number }>(`${BASE}?${q}`);
}

export async function getClip(id: string): Promise<Clip> {
  return apiFetch<Clip>(`${BASE}/${id}`);
}

export async function retryClip(id: string): Promise<Clip> {
  return apiFetch<Clip>(`${BASE}/${id}/retry`, { method: 'POST' });
}

export async function getClipSettings(): Promise<ClipSettings> {
  return apiFetch<ClipSettings>(`${BASE}/settings`);
}

export async function saveClipSettings(settings: {
  defaultOutputUrl: string;
  defaultOutputType: string;
}): Promise<void> {
  await apiFetch<{ ok: true }>(`${BASE}/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
