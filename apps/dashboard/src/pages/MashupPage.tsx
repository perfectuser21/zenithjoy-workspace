/**
 * 批量混剪
 *
 * 客户上传的素材已经过 S1 自动打标签。这一页是 S2-S4 三步的客户界面：
 * ① 挑模板 + 挑已识别的素材 → 槽位分配 ② 生成候选方案 → 挑一个
 * ③ 渲染出高清成片，内容安全/水印 fail-closed 把关（proposal-v2.md A1）。
 *
 * 只有后端服务这一件事是新的——前四刀（S1-S4）已经分别落地并各自有 smoke
 * 守着；本页把它们串成客户能点着走完的一条路，不重新发明任何一步的逻辑。
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Film, RefreshCw, CheckCircle2, XCircle, Clock, ArrowLeft, Download, Layers } from 'lucide-react';
import { listMaterials, formatSize, type Material } from '../api/materials.api';
import {
  listTemplates,
  createTemplateFromScript,
  createRun,
  getRun,
  generateCandidates,
  listCandidates,
  selectCandidate,
  renderCandidate,
  previewCandidate,
  getCandidateDetail,
  listRuns,
  type MashupRun,
  type CandidatesResult,
  type RenderResult,
  type SlotAssignmentStatus,
  type PreviewStatus,
  type MashupRunSummary,
  type CandidateDetail,
  type CreateTemplateFromScriptResult,
  type DynamicSlot,
  type AspectRatio,
} from '../api/mashup.api';

/** 轮询候选详情直到（渲染或预览）落终态，或超过最大次数放弃（避免网络异常时无限空转）。 */
async function pollCandidateUntil(
  candidateId: string,
  isTerminal: (detail: Awaited<ReturnType<typeof getCandidateDetail>>) => boolean,
  opts: { intervalMs: number; maxAttempts: number },
) {
  for (let attempt = 0; attempt < opts.maxAttempts; attempt += 1) {
    const detail = await getCandidateDetail(candidateId);
    if (isTerminal(detail)) return detail;
    await new Promise((r) => setTimeout(r, opts.intervalMs));
  }
  throw new Error('处理耗时过长，请稍后刷新查看');
}

type TaggedMaterial = Material & { tag_status?: string; ai_tags?: string[] };

type Step = 'pick' | 'assigned' | 'candidates' | 'result' | 'history';

const SLOT_LABEL: Record<string, string> = {
  hook: '钩子', product: '产品', evidence: '证据', cta: '行动号召',
};

const ASSIGNMENT_BADGE: Record<SlotAssignmentStatus, { text: string; className: string }> = {
  assigned: { text: '已匹配', className: 'bg-green-100 text-green-800' },
  reshoot_skipped: { text: '暂缺素材，已跳过', className: 'bg-amber-100 text-amber-800' },
  unfilled: { text: '选填，未匹配', className: 'bg-gray-100 text-gray-500' },
};

/**
 * 后端 fail() helper 统一落 { error: { code, message } }。axios 的 err.message
 * 只有"Request failed with status code 500"这种没信息量的话——真机人工验证时
 * 亲眼看到这坨字出现在界面上，用户根本不知道发生了什么。优先取后端给的原因。
 */
function extractErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const backendMsg = err.response?.data?.error?.message;
    if (typeof backendMsg === 'string' && backendMsg) return backendMsg;
  }
  return err instanceof Error ? err.message : fallback;
}

function StepBar({ step }: { step: Step }) {
  if (step === 'history') return null;
  const steps: { key: Step; label: string }[] = [
    { key: 'pick', label: '① 选素材' },
    { key: 'assigned', label: '② 槽位分配' },
    { key: 'candidates', label: '③ 选候选' },
    { key: 'result', label: '④ 成片' },
  ];
  const idx = steps.findIndex((s) => s.key === step);
  return (
    <div className="mb-6 flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className={i <= idx ? 'font-medium text-blue-600' : 'text-gray-400'}>{s.label}</span>
          {i < steps.length - 1 ? <span className="text-gray-300">→</span> : null}
        </div>
      ))}
    </div>
  );
}

export default function MashupPage() {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>('pick');
  const [templateId, setTemplateId] = useState<string>('');
  // 默认竖屏——抖音主流是 9:16，横屏先天限流（客户原话"抖音横屏和竖屏是我们要
  // 选择的呀"）。跟套路模板同一步做决定，属于"这批片子怎么出"的设定。
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('portrait');
  const [selectedMaterialIds, setSelectedMaterialIds] = useState<Set<string>>(new Set());
  const [run, setRun] = useState<MashupRun | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResult | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewByCandidate, setPreviewByCandidate] = useState<Record<string, { status: PreviewStatus; url: string | null }>>({});
  const [scriptText, setScriptText] = useState('');
  const [scriptResult, setScriptResult] = useState<CreateTemplateFromScriptResult | null>(null);
  const [scriptError, setScriptError] = useState<string | null>(null);

  const templatesQuery = useQuery({ queryKey: ['mashup', 'templates'], queryFn: listTemplates, staleTime: 5 * 60 * 1000 });
  const materialsQuery = useQuery({
    queryKey: ['materials', 'mashup-pick'],
    queryFn: () => listMaterials({ limit: 100 }),
    staleTime: 60 * 1000,
  });

  const templates = useMemo(() => templatesQuery.data ?? [], [templatesQuery.data]);
  const allMaterials = useMemo(() => (materialsQuery.data?.items ?? []) as TaggedMaterial[], [materialsQuery.data]);
  const taggedMaterials = useMemo(() => allMaterials.filter((m) => m.tag_status === 'tagged'), [allMaterials]);
  const materialsById = useMemo(() => new Map(allMaterials.map((m) => [m.id, m])), [allMaterials]);

  // 只有一个模板时直接默认选中——proposal-v2.md 现阶段只有内置的标准四槽位模板，
  // 不强迫客户多点一步。
  useEffect(() => {
    if (!templateId && templates.length > 0) {
      setTemplateId(templates[0].id);
    }
  }, [templateId, templates]);

  // 客户主线入口（proposal-v2.md Step1）：粘贴文案 → AI 分段落成专属模板 → 自动
  // 选中，继续走原有挑素材流程。degraded 原样存进 scriptResult，PickStep 如实
  // 展示，绝不假装分段成功——本仓库硬性要求。
  const createTemplateFromScriptMutation = useMutation({
    mutationFn: () => createTemplateFromScript(scriptText),
    onSuccess: (r) => {
      setScriptResult(r);
      setScriptError(null);
      setTemplateId(r.templateId);
      // 新模板已落库但不在当前已拉取的模板列表缓存里，刷新后下拉才能选中它。
      qc.invalidateQueries({ queryKey: ['mashup', 'templates'] });
    },
    onError: (e) => setScriptError(extractErrorMessage(e, '文案分段失败')),
  });

  const createRunMutation = useMutation({
    mutationFn: () => createRun(templateId, Array.from(selectedMaterialIds), aspectRatio),
    onSuccess: (r) => { setRun(r); setErrorMsg(null); setStep('assigned'); },
    onError: (e) => setErrorMsg(extractErrorMessage(e, '生成槽位分配失败')),
  });

  const generateCandidatesMutation = useMutation({
    mutationFn: () => generateCandidates(run!.runId),
    onSuccess: (r) => { setCandidates(r); setErrorMsg(null); setStep('candidates'); },
    onError: (e) => setErrorMsg(extractErrorMessage(e, '生成候选方案失败')),
  });

  // 决策 d6bedf80：渲染并发=1队列，POST /render 立即回队列态而非终版结果——
  // 这里入队后轮询候选详情直到渲染落终态，再取 content 呈现（修复 PR#1905
  // 引入的"点了选这个之后一直显示旧的失败态"契约断层）。
  const selectAndRenderMutation = useMutation({
    mutationFn: async (candidateId: string) => {
      setSelectedCandidateId(candidateId);
      await selectCandidate(candidateId);
      const enqueued = await renderCandidate(candidateId);
      if (enqueued.renderStatus === 'rendered' || enqueued.renderStatus === 'render_failed') {
        return getCandidateDetail(candidateId);
      }
      return pollCandidateUntil(
        candidateId,
        (d) => d.renderStatus === 'rendered' || d.renderStatus === 'render_failed',
        { intervalMs: 1500, maxAttempts: 80 },
      );
    },
    onSuccess: (detail) => {
      if (detail.content) {
        setRenderResult(detail.content);
      } else {
        // 落 render_failed 但还没来得及写 contents 行——按未通过口径呈现，不是裸崩。
        setRenderResult({ contentId: '', safetyCheckStatus: 'failed_pending_review', watermarkCheckStatus: 'failed_pending_review' });
      }
      setErrorMsg(null);
      setStep('result');
    },
    onError: (e) => setErrorMsg(extractErrorMessage(e, '渲染成片失败')),
  });

  // 候选真实轻量预览（决策 623a81d7）：点击才现渲染，渲染完内联播放，客户看完
  // 再决定要不要选它合成终版——不再是纯缩略图盲选。
  async function handlePreview(candidateId: string) {
    setPreviewByCandidate((prev) => ({ ...prev, [candidateId]: { status: 'generating', url: null } }));
    try {
      const enqueued = await previewCandidate(candidateId);
      if (enqueued.previewStatus === 'ready' && enqueued.previewUrl) {
        setPreviewByCandidate((prev) => ({ ...prev, [candidateId]: { status: 'ready', url: enqueued.previewUrl } }));
        return;
      }
      const detail = await pollCandidateUntil(
        candidateId,
        (d) => d.previewStatus === 'ready' || d.previewStatus === 'failed',
        { intervalMs: 1000, maxAttempts: 40 },
      );
      setPreviewByCandidate((prev) => ({
        ...prev,
        [candidateId]: { status: detail.previewStatus, url: detail.previewUrl },
      }));
    } catch {
      setPreviewByCandidate((prev) => ({ ...prev, [candidateId]: { status: 'failed', url: null } }));
    }
  }

  function toggleMaterial(id: string) {
    setSelectedMaterialIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function resetAll() {
    setStep('pick');
    setAspectRatio('portrait');
    setSelectedMaterialIds(new Set());
    setRun(null);
    setCandidates(null);
    setSelectedCandidateId(null);
    setRenderResult(null);
    setErrorMsg(null);
    setPreviewByCandidate({});
    setScriptText('');
    setScriptResult(null);
    setScriptError(null);
    qc.invalidateQueries({ queryKey: ['materials', 'mashup-pick'] });
  }

  const runsQuery = useQuery({
    queryKey: ['mashup', 'runs'],
    queryFn: () => listRuns({ limit: 50 }),
    enabled: step === 'history',
    staleTime: 30 * 1000,
  });

  const openHistoryMutation = useMutation({
    mutationFn: (summary: MashupRunSummary) =>
      resolveHistoryTarget(summary, { getRun, listCandidates, getCandidateDetail, generateCandidates }),
    onSuccess: (target) => {
      if (target.run) setRun(target.run);
      if (target.candidates) setCandidates(target.candidates);
      if (target.renderResult) setRenderResult(target.renderResult);
      if (target.selectedCandidateId !== undefined) setSelectedCandidateId(target.selectedCandidateId);
      setErrorMsg(null);
      setStep(target.step);
    },
    onError: (e) => setErrorMsg(extractErrorMessage(e, '打开历史记录失败')),
  });

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">批量混剪</h1>
          <p className="mt-1 text-sm text-gray-500">从已识别的素材里挑一批，自动分配到套路模板，选一个候选方案渲染成高清成片</p>
        </div>
        {step !== 'pick' ? (
          <button
            type="button"
            onClick={resetAll}
            className="flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            <ArrowLeft className="h-4 w-4" />
            重新开始
          </button>
        ) : null}
      </div>

      <StepBar step={step} />

      {errorMsg ? (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMsg}</div>
      ) : null}

      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => { resetAll(); setStep('pick'); }}
          className={`rounded-md px-3 py-1.5 text-sm ${step === 'history' ? 'text-gray-600 hover:bg-gray-100' : 'bg-blue-600 text-white'}`}
        >
          新建
        </button>
        <button
          type="button"
          onClick={() => setStep('history')}
          className={`rounded-md px-3 py-1.5 text-sm ${step === 'history' ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
        >
          历史记录
        </button>
      </div>

      {step === 'history' ? (
        <HistoryStep
          runs={runsQuery.data?.items ?? []}
          loading={runsQuery.isLoading || openHistoryMutation.isPending}
          onOpen={(r) => openHistoryMutation.mutate(r)}
          onNew={() => { resetAll(); setStep('pick'); }}
        />
      ) : null}

      {step === 'pick' ? (
        <PickStep
          templates={templates}
          templateId={templateId}
          onTemplateChange={setTemplateId}
          templatesLoading={templatesQuery.isLoading}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          materials={taggedMaterials}
          materialsLoading={materialsQuery.isLoading}
          materialsError={materialsQuery.isError}
          selectedMaterialIds={selectedMaterialIds}
          onToggle={toggleMaterial}
          onSubmit={() => createRunMutation.mutate()}
          submitting={createRunMutation.isPending}
          scriptText={scriptText}
          onScriptChange={setScriptText}
          onGenerateFromScript={() => createTemplateFromScriptMutation.mutate()}
          scriptSubmitting={createTemplateFromScriptMutation.isPending}
          scriptError={scriptError}
          scriptResult={scriptResult}
        />
      ) : null}

      {step === 'assigned' && run ? (
        <AssignedStep
          run={run}
          materialsById={materialsById}
          onNext={() => generateCandidatesMutation.mutate()}
          generating={generateCandidatesMutation.isPending}
        />
      ) : null}

      {step === 'candidates' && candidates ? (
        <CandidatesStep
          candidates={candidates}
          materialsById={materialsById}
          onSelect={(id) => selectAndRenderMutation.mutate(id)}
          rendering={selectAndRenderMutation.isPending}
          renderingCandidateId={selectedCandidateId}
          previewByCandidate={previewByCandidate}
          onPreview={handlePreview}
        />
      ) : null}

      {step === 'result' && renderResult ? <ResultStep result={renderResult} onBack={() => setStep('candidates')} /> : null}
    </div>
  );
}

// ============ Step 1：选模板 + 选素材 ============

/** 出片比例文案：值 → { label, hint }。hint 只在竖屏上标"抖音推荐"，横屏不给差评式提示，
 *  客户自己有横屏需求时不该觉得被劝退。 */
const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; hint?: string }[] = [
  { value: 'portrait', label: '竖屏 9:16', hint: '抖音推荐' },
  { value: 'landscape', label: '横屏 16:9' },
];

export function PickStep(props: {
  templates: { id: string; name: string }[];
  templateId: string;
  onTemplateChange: (id: string) => void;
  templatesLoading: boolean;
  /** 出片横竖屏。不传按 'portrait'（抖音推荐）显示——保持组件在旧调用点/旧测试下可用。 */
  aspectRatio?: AspectRatio;
  onAspectRatioChange?: (v: AspectRatio) => void;
  materials: TaggedMaterial[];
  materialsLoading: boolean;
  materialsError: boolean;
  selectedMaterialIds: Set<string>;
  onToggle: (id: string) => void;
  onSubmit: () => void;
  submitting: boolean;
  scriptText: string;
  onScriptChange: (v: string) => void;
  onGenerateFromScript: () => void;
  scriptSubmitting: boolean;
  scriptError: string | null;
  scriptResult: { degraded: boolean; slots: DynamicSlot[] } | null;
}) {
  const {
    templates, templateId, onTemplateChange, templatesLoading,
    aspectRatio = 'portrait', onAspectRatioChange,
    materials, materialsLoading, materialsError,
    selectedMaterialIds, onToggle, onSubmit, submitting,
    scriptText, onScriptChange, onGenerateFromScript, scriptSubmitting, scriptError, scriptResult,
  } = props;

  return (
    <div>
      {/* 主路径：粘贴带货文案，AI 按镜头分段落成专属模板——放在模板下拉之前，
          但不强制，不写文案直接用内置模板的路径原样保留在下面。 */}
      <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50/40 p-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">
          带货文案（主路径：粘贴文案，AI 自动按镜头分段匹配素材）
        </label>
        <textarea
          value={scriptText}
          onChange={(e) => onScriptChange(e.target.value)}
          rows={4}
          placeholder="粘贴一段带货文案，AI 会按镜头拆成有序分段…"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            disabled={!scriptText.trim() || scriptSubmitting}
            onClick={onGenerateFromScript}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {scriptSubmitting ? 'AI 分段中…' : '按文案生成分段模板'}
          </button>
          <span className="text-xs text-gray-400">不写文案也可以，直接用下面的内置模板</span>
        </div>

        {scriptError ? (
          <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{scriptError}</div>
        ) : null}

        {scriptResult ? (
          <div className="mt-3">
            {scriptResult.degraded ? (
              <div className="mb-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                AI 分段没跑成，已用固定四槽位继续
              </div>
            ) : (
              <div className="mb-2 text-xs text-green-700">AI 已把文案分成 {scriptResult.slots.length} 段</div>
            )}
            <div className="space-y-1">
              {scriptResult.slots.map((s, i) => (
                <div key={`${s.key}-${i}`} className="rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700">
                  <span className="font-medium">{SLOT_LABEL[s.key] ?? s.key}</span>
                  {!s.required ? '（选填）' : ''}
                  ：{s.match_tags.length > 0 ? s.match_tags.join('、') : '未匹配到标签'}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">套路模板</label>
        {templatesLoading ? (
          <div className="text-sm text-gray-400">加载中…</div>
        ) : (
          <select
            value={templateId}
            onChange={(e) => onTemplateChange(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}
      </div>

      {/* 出片比例：跟套路模板同区域——都是"这批片子怎么出"的一次性设定，客户
          原话"抖音横屏和竖屏是我们要选择的呀，有的是横屏，有的是竖屏"。 */}
      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-700">出片比例</label>
        <div className="flex gap-2">
          {ASPECT_RATIO_OPTIONS.map((opt) => {
            const selected = aspectRatio === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={selected}
                onClick={() => onAspectRatioChange?.(opt.value)}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
                  selected ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {opt.label}
                {opt.hint ? (
                  <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-800">{opt.hint}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2 text-sm font-medium text-gray-700">
        选素材（只显示已识别的，{materials.length} 条可选）
      </div>

      {materialsLoading ? (
        <div className="py-10 text-center text-gray-400">加载中…</div>
      ) : materialsError ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">加载素材失败</div>
      ) : materials.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
          <Film className="mx-auto h-8 w-8 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">还没有已识别的素材</p>
          <p className="mt-1 text-xs text-gray-400">在「素材库」上传素材后，等它状态变成"已识别"再回来挑</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {materials.map((m) => {
            const checked = selectedMaterialIds.has(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onToggle(m.id)}
                className={`rounded-lg border p-2 text-left text-xs transition ${
                  checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center justify-between">
                  <Film className="h-4 w-4 text-gray-400" />
                  {checked ? <CheckCircle2 className="h-4 w-4 text-blue-500" /> : null}
                </div>
                <div className="mt-1 truncate font-medium text-gray-800" title={m.file_name}>{m.file_name}</div>
                <div className="mt-0.5 truncate text-gray-400">{(m.ai_tags ?? []).slice(0, 3).join('、') || '无标签'}</div>
                <div className="mt-0.5 text-gray-400">{formatSize(m.size_bytes)}</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={!templateId || selectedMaterialIds.size === 0 || submitting}
          onClick={onSubmit}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? '分配中…' : `生成槽位分配（已选 ${selectedMaterialIds.size} 条）`}
        </button>
      </div>
    </div>
  );
}

// ============ Step 2：槽位分配结果 ============

function AssignedStep(props: {
  run: MashupRun;
  materialsById: Map<string, TaggedMaterial>;
  onNext: () => void;
  generating: boolean;
}) {
  const { run, materialsById, onNext, generating } = props;
  const hasUsable = run.assignments.some((a) => a.status === 'assigned');

  return (
    <div>
      <div className="space-y-2">
        {run.assignments.map((a) => {
          const badge = ASSIGNMENT_BADGE[a.status];
          const material = a.materialId ? materialsById.get(a.materialId) : undefined;
          return (
            <div key={a.slotKey} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
              <div>
                <div className="text-sm font-medium text-gray-800">{SLOT_LABEL[a.slotKey] ?? a.slotKey}</div>
                <div className="text-xs text-gray-500">{material?.file_name ?? '（无素材）'}</div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${badge.className}`}>{badge.text}</span>
            </div>
          );
        })}
      </div>

      {!hasUsable ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          所有必填槽位都没匹配到素材，生成的候选会很有限。建议返回补选更多素材。
        </div>
      ) : null}

      <button
        type="button"
        disabled={!hasUsable || generating}
        onClick={onNext}
        className="mt-4 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? '生成中…' : '生成候选方案'}
      </button>
    </div>
  );
}

// ============ Step 3：候选方案 ============

export function CandidatesStep(props: {
  candidates: CandidatesResult;
  materialsById: Map<string, TaggedMaterial>;
  onSelect: (candidateId: string) => void;
  rendering: boolean;
  renderingCandidateId: string | null;
  previewByCandidate: Record<string, { status: PreviewStatus; url: string | null }>;
  onPreview: (candidateId: string) => void;
}) {
  const { candidates, materialsById, onSelect, rendering, renderingCandidateId, previewByCandidate, onPreview } = props;

  if (candidates.candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center text-sm text-gray-500">
        没有生成出候选方案——素材可能不够多样，回上一步补选素材再试。
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {candidates.candidates.map((c) => {
        const filledSlots = Object.entries(c.slotFill).filter(([, v]) => v);
        const preview = previewByCandidate[c.id];
        const previewing = preview?.status === 'generating';
        return (
          <div key={c.id} className="rounded-lg border border-gray-200 p-3">
            {preview?.status === 'ready' && preview.url ? (
              <video src={preview.url} controls className="mb-2 aspect-video w-full rounded-md bg-black" />
            ) : c.thumbnailUrl ? (
              <img src={c.thumbnailUrl} alt="候选缩略图" className="mb-2 aspect-video w-full rounded-md bg-gray-100 object-cover" />
            ) : (
              <div className="mb-2 flex aspect-video w-full items-center justify-center rounded-md bg-gray-100 text-gray-300">
                <Film className="h-6 w-6" />
              </div>
            )}

            <div className="mb-2 text-xs text-gray-400">匹配分 {c.score.toFixed(2)}</div>
            <div className="space-y-1">
              {filledSlots.map(([slotKey, materialId]) => (
                <div key={slotKey} className="truncate text-xs text-gray-700">
                  <span className="font-medium">{SLOT_LABEL[slotKey] ?? slotKey}：</span>
                  {materialId ? materialsById.get(materialId)?.file_name ?? materialId : ''}
                </div>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={previewing || preview?.status === 'ready'}
                onClick={() => onPreview(c.id)}
                className="flex-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {previewing ? '预览生成中…' : preview?.status === 'ready' ? '已预览' : preview?.status === 'failed' ? '预览失败，重试' : '先看看效果'}
              </button>
              <button
                type="button"
                disabled={rendering}
                onClick={() => onSelect(c.id)}
                className="flex-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {rendering && renderingCandidateId === c.id ? '渲染中…' : '选这个，合成正式成片'}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============ Step 4：成片结果 ============

export function ResultStep({ result, onBack }: { result: RenderResult; onBack: () => void }) {
  const passed = result.safetyCheckStatus === 'passed' && result.watermarkCheckStatus === 'passed';

  return (
    <div className="rounded-lg border border-gray-200 p-6 text-center">
      {passed && result.downloadUrl ? (
        <>
          <CheckCircle2 className="mx-auto h-10 w-10 text-green-500" />
          <p className="mt-3 text-sm font-medium text-gray-800">成片已生成，内容安全审核通过</p>
          <video
            src={result.downloadUrl}
            controls
            className="mx-auto mt-4 max-h-[480px] w-full max-w-md rounded-lg bg-black"
          />
          <a
            href={result.downloadUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Download className="h-4 w-4" />
            下载成片
          </a>
        </>
      ) : result.safetyCheckStatus === 'failed_pending_review' || result.watermarkCheckStatus === 'failed_pending_review' ? (
        <>
          <Clock className="mx-auto h-10 w-10 text-amber-500" />
          <p className="mt-3 text-sm font-medium text-gray-800">审核处理中/暂时失败，已转人工复核</p>
          <p className="mt-1 text-xs text-gray-500">可以回上一步换个候选再试一次</p>
        </>
      ) : (
        <>
          <XCircle className="mx-auto h-10 w-10 text-red-500" />
          <p className="mt-3 text-sm font-medium text-gray-800">内容安全或水印自查未通过，不能导出</p>
          <p className="mt-1 text-xs text-gray-500">
            {result.safetyCheckStatus !== 'passed' ? '内容安全：未通过 ' : ''}
            {result.watermarkCheckStatus !== 'passed' ? '水印自查：检测到水印' : ''}
          </p>
        </>
      )}

      <button
        type="button"
        onClick={onBack}
        className="mt-4 flex items-center gap-1.5 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 mx-auto"
      >
        <RefreshCw className="h-4 w-4" />
        换个候选再试
      </button>
    </div>
  );
}

// ============ 历史记录 ============

/** 恢复历史 run 时要调的接口集合。显式传入而不是直接 import，便于单测锁"没调生成接口"。 */
export interface HistoryDeps {
  getRun: (runId: string) => Promise<MashupRun>;
  listCandidates: (runId: string) => Promise<CandidatesResult>;
  getCandidateDetail: (candidateId: string) => Promise<CandidateDetail>;
  generateCandidates: (runId: string, targetCount?: number) => Promise<CandidatesResult>;
}

export interface HistoryTarget {
  step: Step;
  run?: MashupRun;
  candidates?: CandidatesResult;
  renderResult?: RenderResult;
  selectedCandidateId?: string | null;
}

/**
 * 历史记录点进去落到哪一步。
 *
 * 要害在候选态走 listCandidates（GET）而不是 generateCandidates（POST）——客户
 * 等的就是不用重算向量、不用重拼缩略图。deps 显式传进来，测试才能断言
 * "生成接口一次都没被调用"。
 */
export async function resolveHistoryTarget(
  summary: MashupRunSummary,
  deps: HistoryDeps,
): Promise<HistoryTarget> {
  if (summary.selectedCandidateId) {
    const detail = await deps.getCandidateDetail(summary.selectedCandidateId);
    return {
      step: 'result',
      selectedCandidateId: summary.selectedCandidateId,
      // 落 render_failed 但还没写 contents 行——按未通过口径呈现，与
      // selectAndRenderMutation 同口径，不裸崩。
      renderResult: detail.content ?? {
        contentId: '',
        safetyCheckStatus: 'failed_pending_review',
        watermarkCheckStatus: 'failed_pending_review',
      },
    };
  }

  const run = await deps.getRun(summary.runId);
  if (summary.candidateCount > 0) {
    const candidates = await deps.listCandidates(summary.runId);
    return { step: 'candidates', run, candidates };
  }
  return { step: 'assigned', run };
}

const STAGE_LABEL: Record<MashupRunSummary['stage'], string> = {
  completed: '已完成',
  rendering: '渲染中',
  candidates_pending: '候选待选定',
  assigned: '待生成候选',
};

const STAGE_CLASS: Record<MashupRunSummary['stage'], string> = {
  completed: 'bg-green-100 text-green-700',
  rendering: 'bg-amber-100 text-amber-700',
  candidates_pending: 'bg-blue-100 text-blue-700',
  assigned: 'bg-gray-100 text-gray-600',
};

function formatRunTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function HistoryStep(props: {
  runs: MashupRunSummary[];
  loading: boolean;
  onOpen: (run: MashupRunSummary) => void;
  onNew: () => void;
}) {
  const { runs, loading, onOpen, onNew } = props;

  if (loading) {
    return <div className="py-16 text-center text-sm text-gray-400">加载中…</div>;
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-300 py-12 text-center">
        <p className="text-sm text-gray-500">还没有混剪记录</p>
        <button
          type="button"
          onClick={onNew}
          className="mt-3 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          新建一次混剪
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {runs.map((r) => (
        <button
          key={r.runId}
          type="button"
          onClick={() => onOpen(r)}
          className="flex w-full items-center gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-blue-400 hover:bg-blue-50/40"
        >
          <div className="h-14 w-20 shrink-0 overflow-hidden rounded bg-gray-100">
            {r.thumbnailUrl ? (
              <img src={r.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-gray-300">
                <Layers className="h-5 w-5" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] ${STAGE_CLASS[r.stage]}`}>
                {STAGE_LABEL[r.stage]}
              </span>
              <span className="text-xs text-gray-400">{formatRunTime(r.createdAt)}</span>
            </div>
            <div className="mt-1 text-xs text-gray-500">
              {r.candidateCount > 0 ? `${r.candidateCount} 个候选方案` : '尚未生成候选'}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
