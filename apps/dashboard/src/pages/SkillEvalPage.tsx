import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, BookOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

const API_UPLOAD = '/api/staff/skill-eval/upload';
const API_STATUS = (jobId: string) => `/api/staff/skill-eval/status/${jobId}`;
const API_REPORT = (jobId: string) => `/api/staff/skill-eval/report/${jobId}`;
const API_WIZARD_ANSWERS = (jobId: string) => `/api/staff/skill-eval/wizard/${jobId}/answers`;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 40 * 60 * 1000;

const PLATFORM_OPTIONS = ['Claude', 'Codex', 'ChatGPT', 'Other'];

const JOURNEY_OPTIONS = [
  { value: 'line00', label: 'Line 00 — ZenithJoy 运营中枢' },
  { value: 'line01', label: 'Line 01 — 智能发布' },
  { value: 'line02', label: 'Line 02 — 客户智能获客路径' },
  { value: 'line03', label: 'Line 03 — GEO' },
  { value: 'line04', label: 'Line 04 — 客户私域 AI 接管' },
  { value: 'line05', label: 'Line 05 — 视频剪辑' },
  { value: 'line06', label: 'Line 06 — 小龙虾' },
  { value: 'line07', label: 'Line 07 — AI 爆款视频翻拍' },
  { value: 'line10', label: 'Line 10 — ZenithJoy 客户管理' },
];

const AREA_OPTIONS = ['运营中枢', '内容发布', '客户获取', '视频创作', '客户服务', '数据分析'];

interface WizardQuestion {
  id: number;
  question: string;
  reason: string;
  dimension: string;
}

type WizardAnswer = 'yes' | 'no' | 'uncertain';

type PageState =
  | { phase: 'idle' }
  | { phase: 'uploading' }
  | { phase: 'parsing'; jobId: string; startedAt: number }
  | { phase: 'wizard'; jobId: string; questions: WizardQuestion[]; startedAt: number }
  | { phase: 'polling'; jobId: string; startedAt: number }
  | { phase: 'done'; jobId: string; reportHtml: string }
  | { phase: 'failed'; jobId: string; reason: string }
  | { phase: 'error'; message: string };

const PROGRESS_STEPS = [
  { label: '上传', key: 'upload' },
  { label: 'AI 解析', key: 'parse', hint: '约 3 分钟' },
  { label: '确认', key: 'wizard', hint: '约 2 分钟' },
  { label: '自动评估', key: 'eval', hint: '约 40 分钟' },
  { label: '报告', key: 'report' },
];

function phaseToStep(phase: string): number {
  if (phase === 'uploading') return 0;
  if (phase === 'parsing') return 1;
  if (phase === 'wizard') return 2;
  if (phase === 'polling') return 3;
  if (phase === 'done') return 4;
  return -1;
}

function ProgressBar({ phase }: { phase: string }) {
  const activeIdx = phaseToStep(phase);
  if (activeIdx < 0) return null;
  return (
    <div className="flex items-start gap-0 mb-6">
      {PROGRESS_STEPS.map((step, idx) => (
        <div key={step.key} className="flex items-center flex-1 min-w-0">
          <div className="flex flex-col items-center min-w-0 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
              idx < activeIdx
                ? 'bg-blue-600 border-blue-600 text-white'
                : idx === activeIdx
                ? 'bg-white dark:bg-slate-800 border-blue-600 text-blue-600'
                : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-400'
            }`}>
              {idx < activeIdx ? '✓' : idx + 1}
            </div>
            <div className={`mt-1 text-center text-xs font-medium truncate w-full ${
              idx === activeIdx ? 'text-blue-600' : idx < activeIdx ? 'text-gray-500' : 'text-gray-400'
            }`}>{step.label}</div>
            {step.hint && idx === activeIdx && (
              <div className="text-xs text-gray-400 text-center whitespace-nowrap">{step.hint}</div>
            )}
          </div>
          {idx < PROGRESS_STEPS.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mt-3 transition-colors ${idx < activeIdx ? 'bg-blue-600' : 'bg-gray-200 dark:bg-slate-700'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function SkillEvalPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<PageState>({ phase: 'idle' });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [platform, setPlatform] = useState('');
  const [journeyId, setJourneyId] = useState('');
  const [area, setArea] = useState('');
  const [ability, setAbility] = useState('');
  const [wizardAnswers, setWizardAnswers] = useState<Record<number, WizardAnswer>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const fetchReport = useCallback(async (jobId: string) => {
    try {
      const res = await adminFetch(API_REPORT(jobId), user?.email);
      if (!res.ok) {
        setState({ phase: 'error', message: `报告获取失败（${res.status}）` });
        return;
      }
      const reportHtml = await res.text();
      setState({ phase: 'done', jobId, reportHtml });
    } catch {
      setState({ phase: 'error', message: '报告获取失败（网络错误）' });
    }
  }, [user?.email]);

  const poll = useCallback(async (jobId: string, startedAt: number) => {
    const elapsed = Date.now() - startedAt;
    if (elapsed > POLL_TIMEOUT_MS) {
      stopPolling();
      setState({ phase: 'error', message: '评测服务暂不可用（轮询超时，请稍后重试）' });
      return;
    }

    try {
      const res = await adminFetch(API_STATUS(jobId), user?.email);
      if (res.status === 504) {
        stopPolling();
        setState({ phase: 'error', message: '评测服务暂不可用（网关超时 504）' });
        return;
      }
      if (!res.ok) {
        stopPolling();
        setState({ phase: 'error', message: `评测状态查询失败（${res.status}）` });
        return;
      }
      const json = await res.json();
      const job = json.data ?? json;

      if (job.status === 'completed') {
        stopPolling();
        await fetchReport(jobId);
        return;
      }
      if (job.status === 'failed') {
        stopPolling();
        setState({ phase: 'failed', jobId, reason: job.failure_reason ?? '未知错误' });
        return;
      }

      // 向导问题就绪
      const wizardReady = job.wizard_status === 'ready' && Array.isArray(job.wizard_questions?.questions);
      if (wizardReady) {
        stopPolling();
        setState({ phase: 'wizard', jobId, questions: job.wizard_questions.questions, startedAt });
        return;
      }

      // 向导生成中或等待评估
      const isParsing = !job.wizard_status || job.wizard_status === 'none' || job.wizard_status === 'generating';
      if (isParsing && job.status === 'pending') {
        setState((prev) => prev.phase === 'parsing' ? prev : { phase: 'parsing', jobId, startedAt });
      } else {
        setState((prev) => prev.phase === 'polling' ? prev : { phase: 'polling', jobId, startedAt });
      }
    } catch {
      // 网络错误继续重试
    }

    pollTimerRef.current = setTimeout(() => poll(jobId, startedAt), POLL_INTERVAL_MS);
  }, [stopPolling, user?.email, fetchReport]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setSelectedFile(file);
    if (state.phase !== 'idle') setState({ phase: 'idle' });
  };

  const handleSubmit = useCallback(async () => {
    if (!selectedFile) return;
    if (!platform) {
      setState({ phase: 'error', message: '请选择来源平台' });
      return;
    }
    if (!journeyId) {
      setState({ phase: 'error', message: '请选择归属线' });
      return;
    }
    setState({ phase: 'uploading' });

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('platform', platform);
    formData.append('journey_id', journeyId);
    if (area) formData.append('area', area);
    if (ability) formData.append('ability', ability);
    const journeyLabel = JOURNEY_OPTIONS.find((j) => j.value === journeyId)?.label ?? '';
    if (journeyLabel) formData.append('line_name', journeyLabel);

    try {
      const res = await adminFetch(API_UPLOAD, user?.email, { method: 'POST', body: formData });
      if (res.status === 504) {
        setState({ phase: 'error', message: '评测服务暂不可用（网关超时 504）' });
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setState({ phase: 'error', message: err?.error?.message ?? `上传失败（${res.status}）` });
        return;
      }
      const json = await res.json();
      const jobId: string = json.data?.job_id ?? json.job_id;
      if (!jobId) {
        setState({ phase: 'error', message: '上传失败（服务未返回 job_id）' });
        return;
      }
      const startedAt = Date.now();
      setState({ phase: 'parsing', jobId, startedAt });
      poll(jobId, startedAt);
    } catch {
      setState({ phase: 'error', message: '上传失败（网络错误，请检查连接）' });
    }
  }, [selectedFile, platform, journeyId, area, ability, poll, user?.email]);

  const handleWizardAnswer = (questionId: number, answer: WizardAnswer) => {
    setWizardAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleWizardSubmit = useCallback(async () => {
    if (state.phase !== 'wizard') return;
    const { jobId, startedAt } = state as { jobId: string; startedAt: number };
    const answersPayload: Record<string, string> = {};
    for (const [id, ans] of Object.entries(wizardAnswers)) {
      answersPayload[id] = ans;
    }
    try {
      await adminFetch(API_WIZARD_ANSWERS(jobId), user?.email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answersPayload }),
      });
    } catch { /* best-effort */ }
    setState({ phase: 'polling', jobId, startedAt });
    poll(jobId, startedAt);
  }, [state, wizardAnswers, poll, user?.email]);

  const handleWizardSkip = useCallback(async () => {
    if (state.phase !== 'wizard') return;
    const { jobId, startedAt } = state as { jobId: string; startedAt: number };
    try {
      await adminFetch(API_WIZARD_ANSWERS(jobId), user?.email, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: {} }),
      });
    } catch { /* best-effort */ }
    setState({ phase: 'polling', jobId, startedAt });
    poll(jobId, startedAt);
  }, [state, poll, user?.email]);

  const handleReset = () => {
    stopPolling();
    setSelectedFile(null);
    setWizardAnswers({});
    setState({ phase: 'idle' });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const currentPhase = state.phase;
  const isProcessing = currentPhase === 'uploading' || currentPhase === 'parsing' || currentPhase === 'polling';
  const jobId = 'jobId' in state ? (state as { jobId: string }).jobId : '';

  return (
    <div className="h-screen flex flex-col bg-gray-50 dark:bg-slate-900">
      <div className="flex-none flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <span className="text-sm font-semibold text-gray-900 dark:text-white">Skill 评测</span>
        <button
          onClick={() => navigate('/staff/skill-library')}
          className="ml-auto flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline"
        >
          <BookOpen size={13} /> 技能库
        </button>
      </div>

      {/* 完整报告页 */}
      {currentPhase === 'done' && (
        <div data-testid="skill-eval-report" className="flex-1 flex flex-col min-h-0">
          <iframe
            title="评测报告"
            data-testid="skill-eval-report-frame"
            srcDoc={(state as { reportHtml: string }).reportHtml}
            sandbox="allow-scripts allow-modals"
            className="flex-1 w-full border-0"
          />
          <div className="flex-none p-2 text-center border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <button onClick={handleReset} className="text-xs text-blue-700 dark:text-blue-400 underline hover:no-underline">
              重新上传
            </button>
          </div>
        </div>
      )}

      {/* 向导页 */}
      {currentPhase === 'wizard' && (
        <div className="flex-1 overflow-auto flex items-start justify-center py-8 px-4">
          <div className="w-full max-w-2xl">
            <ProgressBar phase="wizard" />
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">梳理向导</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                AI 读完 Skill 后，发现了 {(state as { questions: WizardQuestion[] }).questions.length} 个边界模糊的地方。请确认，回答会直接影响评估结果的准确性。
              </p>
              <div className="space-y-5">
                {(state as { questions: WizardQuestion[] }).questions.map((q) => (
                  <div key={q.id} data-testid={`skill-eval-wizard-q-${q.id}`} className="border border-gray-200 dark:border-slate-600 rounded-xl p-4">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">{q.question}</p>
                    <p className="text-xs text-gray-400 mb-3">{q.reason}</p>
                    <div className="flex gap-2 flex-wrap">
                      {(['yes', 'no', 'uncertain'] as WizardAnswer[]).map((ans) => {
                        const label = ans === 'yes' ? '是' : ans === 'no' ? '否' : '不确定，让评估员判断';
                        const active = wizardAnswers[q.id] === ans;
                        return (
                          <button
                            key={ans}
                            data-testid={`skill-eval-wizard-${ans}-${q.id}`}
                            onClick={() => handleWizardAnswer(q.id, ans)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                              active
                                ? 'bg-blue-600 border-blue-600 text-white'
                                : 'bg-white dark:bg-slate-700 border-gray-300 dark:border-slate-500 text-gray-700 dark:text-gray-300 hover:border-blue-400'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  data-testid="skill-eval-wizard-submit"
                  onClick={handleWizardSubmit}
                  className="flex-1 py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors"
                >
                  提交回答，开始评估
                </button>
                <button
                  onClick={handleWizardSkip}
                  className="px-4 py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-300 dark:border-slate-600 rounded-xl"
                >
                  跳过
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 上传/进度页 */}
      {currentPhase !== 'done' && currentPhase !== 'wizard' && (
        <div className="flex-1 overflow-auto flex items-start justify-center py-8 px-4">
          <div className="w-full max-w-2xl">
            {isProcessing && <ProgressBar phase={currentPhase} />}

            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-gray-200 dark:border-slate-700 p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">来源平台</label>
                <select
                  data-testid="skill-eval-platform"
                  value={platform}
                  onChange={(e) => setPlatform(e.target.value)}
                  disabled={isProcessing}
                  className="block w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50"
                >
                  <option value="">请选择平台</option>
                  {PLATFORM_OPTIONS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">归属线（LINE）</label>
                <select
                  data-testid="skill-eval-journey"
                  value={journeyId}
                  onChange={(e) => setJourneyId(e.target.value)}
                  disabled={isProcessing}
                  className="block w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50"
                >
                  <option value="">请选择归属线</option>
                  {JOURNEY_OPTIONS.map((j) => <option key={j.value} value={j.value}>{j.label}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">所属领域（AREA）</label>
                  <select
                    data-testid="skill-eval-area"
                    value={area}
                    onChange={(e) => setArea(e.target.value)}
                    disabled={isProcessing}
                    className="block w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50"
                  >
                    <option value="">可选</option>
                    {AREA_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">能力名（ABILITY）</label>
                  <input
                    data-testid="skill-eval-ability"
                    type="text"
                    value={ability}
                    onChange={(e) => setAbility(e.target.value)}
                    disabled={isProcessing}
                    placeholder="可选，如「日报生成」"
                    className="block w-full text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 placeholder-gray-400 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">选择技能包（.zip）</label>
                <input
                  ref={fileInputRef}
                  data-testid="skill-eval-upload"
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  disabled={isProcessing}
                  className="block w-full text-sm text-gray-500 dark:text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 dark:file:bg-blue-900/30 dark:file:text-blue-300 disabled:opacity-50"
                />
                {selectedFile && (
                  <p className="mt-1 text-xs text-gray-500">
                    已选择：{selectedFile.name}（{(selectedFile.size / 1024).toFixed(1)} KB）
                  </p>
                )}
              </div>

              <button
                data-testid="skill-eval-submit"
                onClick={handleSubmit}
                disabled={!selectedFile || isProcessing}
                className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
              >
                {currentPhase === 'uploading' ? '上传中...' : isProcessing ? '评测中...' : '开始上传评测'}
              </button>

              {currentPhase === 'uploading' && (
                <div data-testid="skill-eval-loading" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
                  <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                  正在上传文件...
                </div>
              )}

              {currentPhase === 'parsing' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    AI 正在解析 Skill 文档，生成梳理问题…（约 3 分钟）
                  </div>
                  <p data-testid="skill-eval-job-id" className="text-xs text-gray-400">任务 ID：{jobId}</p>
                </div>
              )}

              {currentPhase === 'polling' && (
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-sm">
                    <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                    评测中，请稍候…（约 40 分钟）
                  </div>
                  <p data-testid="skill-eval-job-id" className="text-xs text-gray-400">任务 ID：{jobId}</p>
                </div>
              )}

              {currentPhase === 'error' && (
                <div data-testid="skill-eval-error" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-700 dark:text-red-400">{(state as { message: string }).message}</p>
                  <button onClick={handleReset} className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:no-underline">
                    重新选择文件
                  </button>
                </div>
              )}

              {currentPhase === 'failed' && (
                <div data-testid="skill-eval-error" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                  <p className="text-sm text-red-700 dark:text-red-400">评测失败：{(state as { reason: string }).reason}</p>
                  <button onClick={handleReset} className="mt-2 text-xs text-red-600 dark:text-red-400 underline hover:no-underline">
                    重新上传
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
