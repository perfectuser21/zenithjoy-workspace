export interface Clip { id: string; user_id: string; url: string; platform: string; status: string; title: null; transcript: null; images: unknown[]; author: null; like_count: null; cover_url: null; video_url: null; output_url: null; output_type: null; output_status: null; error_msg: null; retry_count: number; created_at: string; processed_at: null; }
export interface ClipSettings { defaultOutputUrl: string | null; defaultOutputType: string | null; }
export async function submitClip(_url: string, _outputUrl?: string): Promise<Clip & { alreadyExists?: boolean }> { throw new Error('not implemented'); }
export async function listClips(_params: object): Promise<{ data: Clip[]; total: number }> { throw new Error('not implemented'); }
export async function getClip(_id: string): Promise<Clip> { throw new Error('not implemented'); }
export async function retryClip(_id: string): Promise<Clip> { throw new Error('not implemented'); }
export async function getClipSettings(): Promise<ClipSettings> { throw new Error('not implemented'); }
export async function saveClipSettings(_s: object): Promise<void> { throw new Error('not implemented'); }
