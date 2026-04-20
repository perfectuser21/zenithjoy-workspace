import { readFileSync, existsSync, statSync } from 'fs';
import { dirname, resolve, sep } from 'path';
import pool from '../db/connection';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOCKER_ROOT = '/home/cecelia/content-output';
const HOST_ROOT = `${process.env.HOME}/content-output`;

export function isUuid(s: string | null | undefined): boolean {
  return !!s && UUID_RE.test(s);
}

export function translateDockerPath(p: string | null | undefined): string | null {
  if (!p) return null;
  if (p.startsWith(DOCKER_ROOT)) return HOST_ROOT + p.slice(DOCKER_ROOT.length);
  return p;
}

interface EventPayload {
  node: string;
  step_index: number;
  error?: string | null;
  findings_path?: string;
  copy_path?: string;
  cards_dir?: string;
  manifest_path?: string;
  nas_url?: string;
  copy_review_verdict?: 'APPROVED' | 'REVISION';
  copy_review_round?: number;
  image_review_verdict?: 'PASS' | 'FAIL';
  image_review_round?: number;
  [k: string]: unknown;
}

export interface PipelineEvent {
  id: number;
  payload: EventPayload;
  created_at: string;
}

export async function fetchLangGraphEvents(ceceliaTaskId: string): Promise<PipelineEvent[]> {
  const { rows } = await pool.query<PipelineEvent>(
    `SELECT id, payload, created_at
     FROM cecelia_events
     WHERE event_type = 'content_pipeline_step' AND task_id = $1
     ORDER BY id`,
    [ceceliaTaskId]
  );
  return rows;
}

const NODE_TO_STAGE: Record<string, string> = {
  research: 'content-research',
  copywrite: 'content-copywriting',
  copy_review: 'content-copy-review',
  generate: 'content-generate',
  image_review: 'content-image-review',
  export: 'content-export',
};

export interface StageInfo {
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  started_at?: string;
  completed_at?: string;
  review_passed?: boolean;
}

export function buildStagesFromEvents(events: PipelineEvent[]): Record<string, StageInfo> {
  const stages: Record<string, StageInfo> = {};
  const lastByNode: Record<string, PipelineEvent> = {};
  let last: PipelineEvent | null = null;
  for (const e of events) {
    lastByNode[e.payload.node] = e;
    last = e;
  }
  const lastNode = last?.payload.node;

  for (const [node, stageKey] of Object.entries(NODE_TO_STAGE)) {
    const evt = lastByNode[node];
    if (!evt) {
      stages[stageKey] = { status: 'pending' };
      continue;
    }
    const isLast = node === lastNode;
    const hasError = !!evt.payload.error;
    const info: StageInfo = {
      status: hasError
        ? 'failed'
        : isLast
        ? node === 'export'
          ? 'completed'
          : 'in_progress'
        : 'completed',
      started_at: evt.created_at,
      completed_at: isLast && node !== 'export' ? undefined : evt.created_at,
    };
    if (node === 'copy_review') info.review_passed = evt.payload.copy_review_verdict === 'APPROVED';
    if (node === 'image_review') info.review_passed = evt.payload.image_review_verdict === 'PASS';
    stages[stageKey] = info;
  }
  return stages;
}

export function overallStatusFromEvents(
  events: PipelineEvent[]
): 'pending' | 'running' | 'completed' | 'failed' {
  if (events.length === 0) return 'pending';
  const last = events[events.length - 1];
  if (last.payload.error) return 'failed';
  if (last.payload.node === 'export') return 'completed';
  return 'running';
}

export function resolveTaskDir(events: PipelineEvent[]): string | null {
  let exportEvt: PipelineEvent | undefined;
  let generateEvt: PipelineEvent | undefined;
  let researchEvt: PipelineEvent | undefined;
  for (const e of events) {
    if (e.payload.node === 'export') exportEvt = e;
    else if (e.payload.node === 'generate') generateEvt = e;
    else if (e.payload.node === 'research') researchEvt = e;
  }
  const manifest = translateDockerPath(exportEvt?.payload.manifest_path);
  if (manifest) return dirname(manifest);
  const cards = translateDockerPath(generateEvt?.payload.cards_dir);
  if (cards) return dirname(cards);
  const findings = translateDockerPath(researchEvt?.payload.findings_path);
  if (findings) return dirname(dirname(findings));
  return null;
}

interface ManifestFile {
  path?: string;
  status?: string;
}
interface LangGraphManifestFile {
  path: string;
  size?: number;
  sha256?: string;
}
// 兼容两种 manifest schema：
// 老（zenithjoy callback）：{ article: {path}, copy: {path}, image_set: {files: [...]} }
// 新（LangGraph export 节点）：{ files: [{path, size, sha256}] }
interface PipelineManifest {
  status?: string;
  stage?: string;
  keyword?: string;
  article?: ManifestFile;
  copy?: ManifestFile;
  image_set?: { files?: string[]; status?: string; framework?: string };
  files?: LangGraphManifestFile[];
  pipeline_id?: string;
  created_at?: string;
}

function extractArticlePath(m: PipelineManifest | null): string | undefined {
  if (!m) return undefined;
  if (m.article?.path) return m.article.path;
  const hit = m.files?.find((f) => f.path === 'article/article.md' || f.path.endsWith('/article.md'));
  return hit?.path;
}

function extractCopyPath(m: PipelineManifest | null): string | undefined {
  if (!m) return undefined;
  if (m.copy?.path) return m.copy.path;
  const hit = m.files?.find((f) => f.path === 'cards/copy.md' || f.path.endsWith('/copy.md'));
  return hit?.path;
}

function extractImageFiles(m: PipelineManifest | null): string[] {
  if (!m) return [];
  if (m.image_set?.files && m.image_set.files.length > 0) return m.image_set.files;
  // LangGraph manifest：从 files[] 里挑 .png/.jpg/.webp
  const IMG_RE = /\.(png|jpe?g|webp)$/i;
  return (m.files || [])
    .filter((f) => IMG_RE.test(f.path))
    .map((f) => {
      // 剥掉 cards/ 前缀 — content-images 路由接 filename 不接子目录
      const idx = f.path.lastIndexOf('/');
      return idx >= 0 ? f.path.slice(idx + 1) : f.path;
    });
}

function safeJoin(baseDir: string, relPath: string): string | null {
  if (!baseDir || !relPath) return null;
  if (relPath.includes('\0')) return null;
  const base = resolve(baseDir);
  const full = resolve(base, relPath);
  if (full !== base && !full.startsWith(base + sep)) return null;
  return full;
}

function readFileIfExists(baseDir: string, relPath: string | undefined): string | null {
  if (!relPath) return null;
  const full = safeJoin(baseDir, relPath);
  if (!full) return null;
  try {
    if (!existsSync(full) || !statSync(full).isFile()) return null;
    return readFileSync(full, 'utf-8');
  } catch {
    return null;
  }
}

function readManifest(taskDir: string): PipelineManifest | null {
  const path = safeJoin(taskDir, 'manifest.json');
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export interface BuiltOutput {
  pipeline_id: string;
  keyword: string;
  status: string;
  article_text: string | null;
  cards_text: string | null;
  image_urls: Array<{ type: 'cover' | 'card'; url: string }>;
  export_path: string | null;
  images: PipelineManifest['image_set'] | null;
  nas_url?: string | null;
}

export function buildOutputFromEvents(
  pipelineId: string,
  events: PipelineEvent[],
  routeId: string,
  topicKeyword?: string | null
): BuiltOutput {
  const taskDir = resolveTaskDir(events);
  const manifest = taskDir ? readManifest(taskDir) : null;

  const articleText = taskDir
    ? readFileIfExists(taskDir, extractArticlePath(manifest) || 'article/article.md')
    : null;
  const cardsText = taskDir
    ? readFileIfExists(taskDir, extractCopyPath(manifest) || 'cards/copy.md')
    : null;

  const exportEvt = events.find((e) => e.payload.node === 'export');
  const cacheBuster =
    events.length > 0 ? Date.parse(events[events.length - 1].created_at) : Date.now();
  const imageFiles = extractImageFiles(manifest);
  const imageUrls = imageFiles.map((f) => ({
    type: (f.toLowerCase().includes('cover') ? 'cover' : 'card') as 'cover' | 'card',
    url: `/api/content-images/${routeId}/${encodeURIComponent(f)}?v=${cacheBuster}`,
  }));

  return {
    pipeline_id: pipelineId,
    keyword: manifest?.keyword || topicKeyword || '',
    status: manifest?.status || overallStatusFromEvents(events),
    article_text: articleText,
    cards_text: cardsText,
    image_urls: imageUrls,
    export_path: taskDir,
    images: manifest?.image_set || (imageFiles.length > 0 ? { files: imageFiles } : null),
    nas_url: exportEvt?.payload.nas_url || null,
  };
}

export async function resolveTaskDirByPipelineId(
  pipelineId: string
): Promise<{ taskDir: string | null; ceceliaTaskId: string | null }> {
  const { rows } = await pool.query<{ cecelia_task_id: string | null }>(
    `SELECT cecelia_task_id FROM zenithjoy.pipeline_runs WHERE id = $1`,
    [pipelineId]
  );
  const ceceliaTaskId = rows[0]?.cecelia_task_id ?? (isUuid(pipelineId) ? pipelineId : null);
  if (!ceceliaTaskId) return { taskDir: null, ceceliaTaskId: null };
  const events = await fetchLangGraphEvents(ceceliaTaskId);
  return { taskDir: resolveTaskDir(events), ceceliaTaskId };
}
