import { apiClient } from './client';

// ============ 类型定义 ============
// 与后端 apps/api/src/routes/mashup.ts 的响应形状一一对应。

export interface MashupTemplateSlot {
  key: string;
  required: boolean;
  match_tags: string[];
}

export interface MashupTemplate {
  id: string;
  name: string;
  slots: MashupTemplateSlot[];
}

export type SlotTagMapping = 'matched' | 'fallback';

/** 文案分段出的动态槽位，比内置模板的 MashupTemplateSlot 多两个字段：
 *  suggestedCount（该段建议素材数）、tagMapping（match_tags 是否命中固定标签枚举，
 *  越界标签被过滤后落 fallback——与后端 apps/api/src/services/mashup-slot-assignment.ts 同口径）。 */
export interface DynamicSlot {
  key: string;
  required: boolean;
  match_tags: string[];
  suggestedCount: number;
  tagMapping: SlotTagMapping;
}

export interface CreateTemplateFromScriptResult {
  templateId: string;
  name: string;
  slots: DynamicSlot[];
  /** true = AI 分段不可用，已降级成固定四槽位。调用方必须原样展示，不能假装分段成功。 */
  degraded: boolean;
  source: 'ai' | 'fallback';
}

export type SlotAssignmentStatus = 'assigned' | 'reshoot_skipped' | 'unfilled';

export interface SlotAssignment {
  slotKey: string;
  materialId?: string;
  status: SlotAssignmentStatus;
  reason?: string;
}

export type RunStatus = 'pending' | 'completed' | 'completed_partial';

export interface MashupRun {
  runId: string;
  templateId?: string;
  status: RunStatus;
  assignments: SlotAssignment[];
}

/** 历史列表里一条 run 的摘要。stage 由服务端按库里事实派生，前端不再自己判。 */
export type MashupRunStage = 'completed' | 'rendering' | 'candidates_pending' | 'assigned';

export interface MashupRunSummary {
  runId: string;
  templateId: string;
  status: RunStatus;
  stage: MashupRunStage;
  createdAt: string;
  candidateCount: number;
  thumbnailUrl: string | null;
  selectedCandidateId: string | null;
}

export interface MashupRunListResult {
  items: MashupRunSummary[];
  limit: number;
  offset: number;
  count: number;
}

export type RenderStatus = 'pending' | 'queued' | 'rendering' | 'rendered' | 'render_failed';
export type PreviewStatus = 'none' | 'generating' | 'ready' | 'failed';

export interface MashupCandidate {
  id: string;
  score: number;
  slotFill: Record<string, string | undefined>;
  thumbnailUrl?: string | null;
  renderStatus?: RenderStatus;
  previewStatus?: PreviewStatus;
  previewUrl?: string | null;
}

export interface CandidatesResult {
  runId: string;
  generatedCount?: number;
  selectedCandidateId?: string;
  candidates: MashupCandidate[];
}

export interface SelectCandidateResult {
  runId: string;
  selectedCandidateId: string;
}

export type GateStatus = 'passed' | 'flagged' | 'failed_pending_review';

export interface RenderResult {
  contentId: string;
  safetyCheckStatus: GateStatus;
  watermarkCheckStatus: GateStatus;
  exportUrl?: string;
  downloadUrl?: string;
}

/**
 * 候选渲染改并发=1队列后（决策 d6bedf80），POST /candidates/:id/render 立即回的
 * 是队列态，不是终版结果——终版结果（RenderResult）要轮询 getCandidateDetail
 * 拿 content 字段（修复 PR#1905 引入的契约断层：旧类型误标成同步拿到 RenderResult）。
 */
export interface EnqueueRenderResult {
  candidateId: string;
  renderStatus: RenderStatus;
  queuePosition: number;
  contentId: string | null;
}

export interface EnqueuePreviewResult {
  candidateId: string;
  previewStatus: PreviewStatus;
  queuePosition: number;
  previewUrl: string | null;
}

export interface CandidateDetail {
  id: string;
  runId: string;
  score: number;
  slotFill: Record<string, string | undefined>;
  thumbnailUrl: string | null;
  renderStatus: RenderStatus;
  previewStatus: PreviewStatus;
  previewUrl: string | null;
  content: RenderResult | null;
}

// ============ 鉴权 ============
// Dashboard 用登录态，mashup 端点认 X-Upload-Token（license_key）——两套鉴权
// 对不上，用登录态先换出 license_key 再去调。与 materials.api.ts 同口径
// （该文件已有同名 helper，这里独立一份而不是共享导入：两个 api 模块各自
// 独立、不互相依赖，避免以后其中一个改鉴权方式牵连另一个）。
async function getUploadToken(): Promise<string> {
  const { data } = await apiClient.get<{ license?: { license_key?: string } | null }>('/account/me');
  const key = data?.license?.license_key;
  if (!key) {
    throw new Error('当前账号还没有上传凭据。请先在「License」页确认账号已开通。');
  }
  return key;
}

async function authHeaders(): Promise<{ headers: { 'X-Upload-Token': string } }> {
  const token = await getUploadToken();
  return { headers: { 'X-Upload-Token': token } };
}

// ============ 请求 ============

export async function listTemplates(): Promise<MashupTemplate[]> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: MashupTemplate[] }>('/mashup/templates', opts);
  return data.data;
}

/**
 * 客户主线入口（proposal-v2.md Step1）：粘贴一段带货文案，后端 AI 拆成有序镜头
 * 分段落成专属 mashup_template。degraded=true 时后端已降级固定四槽位——这是
 * 唯一真相，调用方（MashupPage）必须原样透出给客户，不能吞掉或假装成功。
 */
export async function createTemplateFromScript(script: string): Promise<CreateTemplateFromScriptResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: CreateTemplateFromScriptResult }>(
    '/mashup/templates/from-script',
    { script },
    opts,
  );
  return data.data;
}

export async function createRun(templateId: string, materialIds: string[]): Promise<MashupRun> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: MashupRun }>(
    '/mashup/runs',
    { templateId, materialIds },
    opts,
  );
  return data.data;
}

export async function getRun(runId: string): Promise<MashupRun> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: MashupRun }>(`/mashup/runs/${runId}`, opts);
  return data.data;
}

/** 本租户的混剪历史，最新的在前。租户由服务端从凭据反查，前端传什么都不作数。 */
export async function listRuns(params: { limit?: number; offset?: number } = {}): Promise<MashupRunListResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: MashupRunListResult }>('/mashup/runs', {
    ...opts,
    params: { limit: params.limit, offset: params.offset },
  });
  return data.data;
}

export async function generateCandidates(runId: string, targetCount?: number): Promise<CandidatesResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: CandidatesResult }>(
    `/mashup/runs/${runId}/candidates`,
    targetCount !== undefined ? { targetCount } : {},
    opts,
  );
  return data.data;
}

export async function listCandidates(runId: string): Promise<CandidatesResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: CandidatesResult }>(`/mashup/runs/${runId}/candidates`, opts);
  return data.data;
}

export async function selectCandidate(candidateId: string): Promise<SelectCandidateResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: SelectCandidateResult }>(
    `/mashup/candidates/${candidateId}/select`,
    {},
    opts,
  );
  return data.data;
}

/** 入队渲染，立即回队列态（不是终版结果，见 EnqueueRenderResult 注释）。 */
export async function renderCandidate(candidateId: string): Promise<EnqueueRenderResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: EnqueueRenderResult }>(
    `/mashup/candidates/${candidateId}/render`,
    {},
    opts,
  );
  return data.data;
}

/** 入队候选真实轻量预览渲染（决策 623a81d7），立即回队列态。 */
export async function previewCandidate(candidateId: string): Promise<EnqueuePreviewResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: EnqueuePreviewResult }>(
    `/mashup/candidates/${candidateId}/preview`,
    {},
    opts,
  );
  return data.data;
}

/** 候选详情：预览态 + 终版渲染态一起给，选中候选触发渲染后轮询这个端点。 */
export async function getCandidateDetail(candidateId: string): Promise<CandidateDetail> {
  const opts = await authHeaders();
  const { data } = await apiClient.get<{ data: CandidateDetail }>(`/mashup/candidates/${candidateId}`, opts);
  return data.data;
}
