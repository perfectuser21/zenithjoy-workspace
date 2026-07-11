import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

/**
 * 「创建 Skill」Tab —— 对话式创建 skill 草稿（长跑异步版本）
 *
 * sprint_dir: sprints/07101942-skill-create-longrun
 *
 * 核心改造：
 * - 点"开始吧"后 API 立即返回 { status: "running" }，前端每 8 秒轮询 GET /:id
 * - 前端展示 running / needs_input / done / error 四种状态 UI
 * - needs_input：显示 AI 问题 + 答案输入框 + 提交按钮
 * - done：显示 zip 下载链接
 * - error：显示错误信息 + "重新开始"按钮
 */

const DRAFT_ID_STORAGE_KEY = 'skill_draft_id';
const GENERATE_TRIGGER = '生成吧';
const POLL_INTERVAL_MS = 8000; // B-17：每 8 秒轮询一次

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ChatPhase = 'idle' | 'sending' | 'running' | 'needs_input' | 'error' | 'done';

interface DraftData {
  id: string;
  status: string;
  messages_json: ChatMessage[];
  pending_question: string | null;
  result_json: { zip_path?: string; error_message?: string } | null;
  job_id?: string | null;
  callback_token?: string | null;
}

function draftUrl(id: string, suffix = ''): string {
  return id ? `/api/staff/skill-drafts/${id}${suffix}` : '/api/staff/skill-drafts';
}

/** 解析一个以 \n\n 分隔的 SSE 事件块，返回 { event, data } */
function parseSseBlock(block: string): { event: string; data: string } {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trim());
    }
  }
  return { event, data: dataLines.join('\n') };
}

export default function SkillCreateTab() {
  const { user } = useAuth();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zipPath, setZipPath] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [answerInput, setAnswerInput] = useState('');
  const initRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 停止轮询
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  // 轮询 GET /:id 直到终态
  const startPolling = useCallback(
    (id: string) => {
      stopPolling();

      const poll = async () => {
        try {
          const res = await adminFetch(draftUrl(id), user?.email);
          if (!res.ok) {
            setPhase('error');
            setErrorMessage('获取生成状态失败，请刷新页面');
            return;
          }
          const json = (await res.json()) as { data: DraftData };
          const data = json.data;

          if (data.status === 'done') {
            setPhase('done');
            setZipPath(data.result_json?.zip_path ?? null);
            stopPolling();
          } else if (data.status === 'needs_input') {
            setPhase('needs_input');
            setPendingQuestion(data.pending_question ?? null);
            stopPolling(); // 等员工答完再继续
          } else if (data.status === 'error') {
            setPhase('error');
            setErrorMessage(data.result_json?.error_message ?? '生成失败，请重试');
            stopPolling();
          } else {
            // running：继续轮询
            pollTimerRef.current = setTimeout(() => {
              void poll();
            }, POLL_INTERVAL_MS);
          }
        } catch {
          setPhase('error');
          setErrorMessage('网络错误，请刷新页面重试');
          stopPolling();
        }
      };

      // 首次立即调用
      void poll();
    },
    [user?.email, stopPolling]
  );

  // 挂载时：localStorage 有 draft_id → 断点续聊拉历史；没有 → 创建新草稿
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    const restore = async () => {
      const savedId = localStorage.getItem(DRAFT_ID_STORAGE_KEY);
      if (savedId) {
        try {
          const res = await adminFetch(draftUrl(savedId), user?.email);
          if (res.ok) {
            const json = (await res.json()) as { data: DraftData };
            const data = json.data ?? (json as unknown as DraftData);
            setDraftId(savedId);
            setMessages(Array.isArray(data.messages_json) ? data.messages_json : []);

            // 恢复非终态的轮询
            if (data.status === 'running') {
              setPhase('running');
              startPolling(savedId);
            } else if (data.status === 'needs_input') {
              setPhase('needs_input');
              setPendingQuestion(data.pending_question ?? null);
            } else if (data.status === 'done') {
              setPhase('done');
              setZipPath(data.result_json?.zip_path ?? null);
            } else if (data.status === 'error') {
              setPhase('error');
              setErrorMessage(data.result_json?.error_message ?? '生成失败，请重试');
            }
            return;
          }
        } catch {
          // 拉取历史失败，退化为创建新草稿
        }
      }

      try {
        const res = await adminFetch(draftUrl(''), user?.email, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const json = (await res.json()) as { data: DraftData };
          const id: string = json.data?.id;
          if (id) {
            localStorage.setItem(DRAFT_ID_STORAGE_KEY, id);
            setDraftId(id);
          }
        }
      } catch {
        setPhase('error');
        setErrorMessage('AI 暂时连不上，稍后重试');
      }
    };

    void restore();
  }, [user?.email, startPolling]);

  // 组件卸载时停止轮询
  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // 触发后台生成（异步，立即返回 running）
  const triggerGenerate = useCallback(
    async (id: string) => {
      setPhase('running');
      try {
        const res = await adminFetch(draftUrl(id, '/generate'), user?.email, { method: 'POST' });
        if (res.status === 409) {
          // 已在 running/needs_input 状态，直接开始轮询
          startPolling(id);
          return;
        }
        if (!res.ok) {
          setPhase('error');
          setErrorMessage('触发生成失败，请重试');
          return;
        }
        // 立即开始轮询
        startPolling(id);
      } catch {
        setPhase('error');
        setErrorMessage('AI 暂时连不上，稍后重试');
      }
    },
    [user?.email, startPolling]
  );

  // 提交答案（needs_input → running）
  const submitAnswer = useCallback(
    async (id: string, answer: string) => {
      setPhase('running');
      setPendingQuestion(null);
      try {
        const res = await adminFetch(draftUrl(id, '/answer'), user?.email, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answer }),
        });
        if (!res.ok) {
          setPhase('error');
          setErrorMessage('提交答案失败，请重试');
          return;
        }
        startPolling(id);
      } catch {
        setPhase('error');
        setErrorMessage('网络错误，请重试');
      }
    },
    [user?.email, startPolling]
  );

  const sendMessage = useCallback(
    async (id: string, text: string) => {
      setMessages((prev) => [...prev, { role: 'user', content: text }]);

      if (text.includes(GENERATE_TRIGGER)) {
        await triggerGenerate(id);
        return;
      }

      setPhase('sending');
      setErrorMessage(null);

      let assembled = '';
      let assistantIndex = -1;
      setMessages((prev) => {
        assistantIndex = prev.length;
        return [...prev, { role: 'assistant', content: '' }];
      });

      const updateAssistantBubble = (content: string) => {
        setMessages((prev) => {
          const next = [...prev];
          if (assistantIndex >= 0 && assistantIndex < next.length) {
            next[assistantIndex] = { role: 'assistant', content };
          }
          return next;
        });
      };

      try {
        const res = await adminFetch(draftUrl(id, '/chat'), user?.email, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
        });

        if (!res.ok || !res.body) {
          setPhase('error');
          setErrorMessage('AI 暂时连不上，稍后重试');
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let sawError = false;

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          let idx: number;
          while ((idx = buffer.indexOf('\n\n')) >= 0) {
            const rawBlock = buffer.slice(0, idx);
            buffer = buffer.slice(idx + 2);
            if (!rawBlock.trim()) continue;

            const { event, data } = parseSseBlock(rawBlock);
            if (event === 'error') {
              sawError = true;
              let msg = 'AI 暂时连不上，稍后重试';
              try {
                const parsed = JSON.parse(data) as { message?: string };
                if (parsed.message) msg = parsed.message;
              } catch {
                // ignore
              }
              setErrorMessage(msg);
            } else if (event === 'done') {
              // 结束标记，无需额外处理
            } else {
              try {
                const parsed = JSON.parse(data) as { type?: string; text?: string };
                if (parsed.text) {
                  assembled += parsed.text;
                  updateAssistantBubble(assembled);
                }
              } catch {
                // 非 JSON 行，忽略
              }
            }
          }
        }

        if (sawError) {
          setPhase('error');
        } else {
          setPhase('idle');
        }
      } catch {
        setPhase('error');
        setErrorMessage('AI 暂时连不上，稍后重试');
      }
    },
    [triggerGenerate, user?.email]
  );

  const handleSend = () => {
    const text = input.trim();
    if (!text || !draftId) return;
    setInput('');
    void sendMessage(draftId, text);
  };

  const handleRetry = () => {
    setPhase('idle');
    setErrorMessage(null);
    setZipPath(null);
    setPendingQuestion(null);
    // 清除草稿状态，重新开始
    localStorage.removeItem(DRAFT_ID_STORAGE_KEY);
    setDraftId(null);
    setMessages([]);
    initRef.current = false;
    // 重新触发 useEffect 初始化
    setTimeout(() => {
      initRef.current = false;
      const restore = async () => {
        try {
          const res = await adminFetch(draftUrl(''), user?.email, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({}),
          });
          if (res.ok) {
            const json = (await res.json()) as { data: DraftData };
            const id: string = json.data?.id;
            if (id) {
              localStorage.setItem(DRAFT_ID_STORAGE_KEY, id);
              setDraftId(id);
            }
          }
        } catch {
          setPhase('error');
          setErrorMessage('创建草稿失败，请刷新页面');
        }
      };
      void restore();
    }, 0);
  };

  const handleAnswerSubmit = () => {
    const answer = answerInput.trim();
    if (!answer || !draftId) return;
    setAnswerInput('');
    void submitAnswer(draftId, answer);
  };

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col h-full">
      <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">
        跟 AI 聊需求，说"生成吧"自动生成 skill 并提交评测（员工内部工具）
      </p>

      <div className="flex-1 min-h-[280px] max-h-[50vh] overflow-y-auto bg-white dark:bg-slate-800 rounded-2xl border border-gray-200 dark:border-slate-700 p-4 space-y-3 mb-4">
        {messages.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            描述你想要的 skill 需求，AI 会多轮追问细节
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap ${
                m.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-slate-700 text-gray-900 dark:text-white'
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {phase === 'sending' && (
          <div data-testid="skill-create-loading" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs">
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            AI 正在回复...
          </div>
        )}

        {phase === 'running' && (
          <div data-testid="skill-create-running" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs">
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            正在后台生成 skill，每 8 秒自动刷新状态...
          </div>
        )}

        {phase === 'needs_input' && pendingQuestion && (
          <div data-testid="skill-create-needs-input" className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl space-y-3">
            <p data-testid="skill-create-question" className="text-sm text-yellow-800 dark:text-yellow-200 font-medium">
              AI 需要你的决策：{pendingQuestion}
            </p>
            <textarea
              data-testid="skill-create-answer-input"
              value={answerInput}
              onChange={(e) => setAnswerInput(e.target.value)}
              placeholder="输入你的答案..."
              rows={2}
              className="w-full text-sm rounded-lg border border-yellow-300 dark:border-yellow-700 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 resize-none"
            />
            <button
              data-testid="skill-create-answer-submit"
              onClick={handleAnswerSubmit}
              disabled={!answerInput.trim()}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
            >
              提交答案
            </button>
          </div>
        )}

        {phase === 'error' && (
          <div data-testid="skill-create-error" className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg space-y-2">
            <p data-testid="skill-create-error-message" className="text-sm text-red-700 dark:text-red-400">
              {errorMessage ?? '生成失败，请重试'}
            </p>
            <button
              data-testid="skill-create-retry"
              onClick={handleRetry}
              className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              重新开始
            </button>
          </div>
        )}

        {phase === 'done' && zipPath && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg space-y-2">
            <p className="text-sm text-green-700 dark:text-green-400">
              Skill 生成完成！
            </p>
            <a
              data-testid="skill-create-download-link"
              href={zipPath}
              download
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs font-medium rounded-lg transition-colors"
            >
              下载 Skill zip
            </a>
          </div>
        )}

        {phase === 'done' && !zipPath && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
            Skill 生成完成！
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <textarea
          data-testid="skill-create-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="描述你想要的 skill 需求..."
          rows={2}
          disabled={phase === 'running' || phase === 'needs_input' || phase === 'done'}
          className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50 resize-none"
        />
        <button
          data-testid="skill-create-send"
          onClick={handleSend}
          disabled={!input.trim() || !draftId || phase === 'running' || phase === 'needs_input' || phase === 'done'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </div>
  );
}
