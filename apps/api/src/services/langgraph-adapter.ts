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

// EventPayload 导出供外部（路由/测试）引用
export interface EventPayload {
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
  copy_review_rule_details?: RuleDetail[];
  image_review_verdict?: 'PASS' | 'FAIL';
  image_review_round?: number;
  image_review_rule_details?: RuleDetail[];
  // ─── WF-3 观察性字段（Brain 侧每步 Docker 执行元数据） ───
  // Brain content-pipeline-graph-runner.js 每步通过 onStep 回调写入：
  //   prompt_sent    Brain 发给 Claude 的 prompt（前 8KB）
  //   raw_stdout     Claude 吐的 stdout（前 10KB）
  //   raw_stderr     Claude 吐的 stderr（前 2KB）
  //   exit_code      容器退出码
  //   duration_ms    节点耗时毫秒
  //   container_id   容器 ID 前 12 位（--cidfile）
  // API 不做任何加工，原样透传给前端（pipeline 详情页事件展开后展示）。
  prompt_sent?: string;
  raw_stdout?: string;
  raw_stderr?: string;
  exit_code?: number | null;
  duration_ms?: number;
  container_id?: string | null;
  [k: string]: unknown;
}

export interface RuleDetail {
  id: string;
  label?: string;
  pass: boolean;
  value?: number | string | null;
  reason?: string;
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

export interface LangGraphListRow {
  id: string;
  cecelia_task_id: string;
  topic: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  content_type: 'content-pipeline';
  output_dir: null;
  output_manifest: null;
  triggered_by: 'langgraph';
  topic_id: null;
  notebook_id: null;
  created_at: string;
  updated_at: string;
  source: 'langgraph';
}

// 列出"只走 LangGraph、没写 zenithjoy.pipeline_runs"的任务
export async function listLangGraphOnlyRuns(limit = 50): Promise<LangGraphListRow[]> {
  const { rows } = await pool.query<{
    id: string;
    title: string | null;
    created_at: string;
    updated_at: string;
    last_node: string | null;
    last_error: string | null;
  }>(
    `SELECT t.id::text AS id,
            t.title,
            t.created_at,
            COALESCE(t.updated_at, t.created_at) AS updated_at,
            last_e.payload->>'node' AS last_node,
            last_e.payload->>'error' AS last_error
     FROM tasks t
     JOIN LATERAL (
       SELECT payload FROM cecelia_events
       WHERE task_id = t.id AND event_type = 'content_pipeline_step'
       ORDER BY id DESC LIMIT 1
     ) last_e ON TRUE
     WHERE t.task_type = 'content-pipeline'
       AND NOT EXISTS (
         SELECT 1 FROM zenithjoy.pipeline_runs pr
         WHERE pr.cecelia_task_id::uuid = t.id
       )
     ORDER BY t.created_at DESC
     LIMIT $1`,
    [limit]
  );

  return rows.map((r) => ({
    id: r.id,
    cecelia_task_id: r.id,
    topic: (r.title || '').replace(/^\[.*?\]\s*/, ''), // 剥掉 "[内容流水线] " 前缀
    status: r.last_error
      ? 'failed'
      : r.last_node === 'export'
      ? 'completed'
      : 'running',
    content_type: 'content-pipeline',
    output_dir: null,
    output_manifest: null,
    triggered_by: 'langgraph',
    topic_id: null,
    notebook_id: null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    source: 'langgraph',
  }));
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
  // 逐条规则打分（给前端现有 rule_scores UI 用；只对 copy_review / image_review 有值）
  rule_scores?: Array<{
    id: string;
    label?: string;
    score: number;       // 0 或 1，对齐前端 UI
    pass: boolean;
    comment?: string;
  }>;
  llm_reviewed?: boolean;
}

function ruleDetailsToScores(details?: RuleDetail[]): StageInfo['rule_scores'] | undefined {
  if (!details || details.length === 0) return undefined;
  return details.map((r) => {
    const commentParts: string[] = [];
    if (r.value !== null && r.value !== undefined && r.value !== '') {
      commentParts.push(`${r.value}`);
    }
    if (r.reason) commentParts.push(r.reason);
    return {
      id: r.id,
      label: r.label,
      score: r.pass ? 1 : 0,
      pass: r.pass,
      comment: commentParts.length > 0 ? commentParts.join(' · ') : undefined,
    };
  });
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
    if (node === 'copy_review') {
      info.review_passed = evt.payload.copy_review_verdict === 'APPROVED';
      info.rule_scores = ruleDetailsToScores(evt.payload.copy_review_rule_details);
    }
    if (node === 'image_review') {
      info.review_passed = evt.payload.image_review_verdict === 'PASS';
      info.rule_scores = ruleDetailsToScores(evt.payload.image_review_rule_details);
    }
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
// 兼容三种 manifest schema：
// V1（zenithjoy callback）：{ article: {path}, copy: {path}, image_set: {files: [...]} }
// V2（LangGraph export 早期）：{ files: [{path, size, sha256}] }
// V3（LangGraph export 当前）：{ cards: [...], copy: "path", article: "path", findings, person_data }
interface PipelineManifest {
  status?: string;
  stage?: string;
  keyword?: string;
  // V1
  article?: ManifestFile | string;
  copy?: ManifestFile | string;
  image_set?: { files?: string[]; status?: string; framework?: string };
  // V2
  files?: LangGraphManifestFile[];
  // V3
  cards?: string[];
  findings?: string;
  person_data?: string;
  pipeline_id?: string;
  created_at?: string;
}

export function extractArticlePath(m: PipelineManifest | null): string | undefined {
  if (!m) return undefined;
  // V1: article 是对象
  if (typeof m.article === 'object' && m.article?.path) return m.article.path;
  // V3: article 是字符串
  if (typeof m.article === 'string') return m.article;
  // V2: 从 files 数组里找
  const hit = m.files?.find((f) => f.path === 'article/article.md' || f.path.endsWith('/article.md'));
  return hit?.path;
}

export function extractCopyPath(m: PipelineManifest | null): string | undefined {
  if (!m) return undefined;
  if (typeof m.copy === 'object' && m.copy?.path) return m.copy.path;
  if (typeof m.copy === 'string') return m.copy;
  const hit = m.files?.find((f) => f.path === 'cards/copy.md' || f.path.endsWith('/copy.md'));
  return hit?.path;
}

export function extractImageFiles(m: PipelineManifest | null): string[] {
  if (!m) return [];
  // V1: image_set.files
  if (m.image_set?.files && m.image_set.files.length > 0) return m.image_set.files;
  // V3: cards 数组（字符串列表，文件名已不含子目录）
  if (Array.isArray(m.cards) && m.cards.length > 0) {
    return m.cards.map((f) => {
      const idx = f.lastIndexOf('/');
      return idx >= 0 ? f.slice(idx + 1) : f;
    });
  }
  // V2: files 数组里挑 .png/.jpg/.webp
  const IMG_RE = /\.(png|jpe?g|webp)$/i;
  return (m.files || [])
    .filter((f) => IMG_RE.test(f.path))
    .map((f) => {
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
