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

export interface MashupCandidate {
  id: string;
  score: number;
  slotFill: Record<string, string | undefined>;
}

export interface CandidatesResult {
  runId: string;
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

// ============ 鉴权 ============
// Dashboard 用登录态，mashup 端点认 X-Upload-Token（license_key）——两套鉴权
// 对不上，用登录态先换出 license_key 再去调。与 materials.api.ts 同口径
// （该文件已有同名 helper，这里独立一份而不是共享导入：两个 api 模块各自
// 独立、不互相依赖，避免以后其中一个改鉴权方式牵连另一个）。
async function getUploadToken(): Promise<string> {
  const { data } = await apiClient.get<{ license?: { license_key?: string } | null }>('/account');
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

export async function renderCandidate(candidateId: string): Promise<RenderResult> {
  const opts = await authHeaders();
  const { data } = await apiClient.post<{ data: RenderResult }>(
    `/mashup/candidates/${candidateId}/render`,
    {},
    opts,
  );
  return data.data;
}
