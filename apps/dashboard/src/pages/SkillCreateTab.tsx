import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { adminFetch } from '../lib/admin-fetch';

/**
 * 「创建 Skill」Tab —— 对话式创建 skill 草稿
 *
 * sprint_dir: sprints/07091721-conversational-skill-creation
 *
 * 后端 /chat 端点是 POST（转发 mmv 上 claude -p --resume 的 stream-json 输出），
 * 浏览器原生 EventSource 只支持 GET，所以这里用 fetch + ReadableStream 手动解析
 * text/event-stream 格式（数据帧仍是标准 `data: ...\n\n` / `event: xxx\n...\n\n`），
 * 效果与 EventSource 等价，只是能配合 POST body 传消息内容。
 */

const DRAFT_ID_STORAGE_KEY = 'skill_draft_id';
const GENERATE_TRIGGER = '生成吧';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

type ChatPhase = 'idle' | 'sending' | 'generating' | 'error' | 'done';

function draftUrl(id: string, suffix = ''): string {
  // 创建草稿（POST /api/staff/skill-drafts）不带 id，URL 不能有多余的尾部斜杠——
  // Playwright mock 用精确 glob '**/api/staff/skill-drafts' 匹配，带斜杠会导致 404。
  return id ? `/api/staff/skill-drafts/${id}${suffix}` : '/api/staff/skill-drafts';
}

/** 解析一个以 \n\n 分隔的 SSE 事件块，返回 { event, data }（event 缺省为 'message'）。 */
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
  const navigate = useNavigate();

  const [draftId, setDraftId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [phase, setPhase] = useState<ChatPhase>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const initRef = useRef(false);

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
            const json = await res.json();
            const data = json.data ?? json;
            setDraftId(savedId);
            setMessages(Array.isArray(data.messages_json) ? data.messages_json : []);
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
          const json = await res.json();
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
  }, [user?.email]);

  const triggerGenerate = useCallback(
    async (id: string) => {
      setPhase('generating');
      try {
        const res = await adminFetch(draftUrl(id, '/generate'), user?.email, { method: 'POST' });
        if (!res.ok) {
          setPhase('error');
          setErrorMessage('AI 暂时连不上，稍后重试');
          return;
        }
        const json = await res.json();
        const returnedJobId: string | undefined = json.data?.job_id;
        setPhase('done');
        if (returnedJobId) {
          setJobId(returnedJobId);
          navigate(`/staff/skill-eval?job_id=${returnedJobId}`, { replace: true });
        }
      } catch {
        setPhase('error');
        setErrorMessage('AI 暂时连不上，稍后重试');
      }
    },
    [navigate, user?.email]
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
      // 先占位一条空的 assistant 气泡，SSE 到达时逐步填充（流式渲染）
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
                // data 不是合法 JSON，用默认文案
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

        {phase === 'generating' && (
          <div data-testid="skill-create-generating" className="flex items-center gap-2 text-blue-600 dark:text-blue-400 text-xs">
            <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            正在生成 skill 并提交评测...
          </div>
        )}

        {phase === 'error' && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
            {errorMessage ?? 'AI 暂时连不上，稍后重试'}
          </div>
        )}

        {phase === 'done' && jobId && (
          <div className="p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-sm text-green-700 dark:text-green-400">
            已提交评测（job_id: {jobId}），可切换到「评测上传」Tab 查看报告进度
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
          disabled={phase === 'generating'}
          className="flex-1 text-sm rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-gray-900 dark:text-white px-3 py-2 disabled:opacity-50 resize-none"
        />
        <button
          data-testid="skill-create-send"
          onClick={handleSend}
          disabled={!input.trim() || !draftId || phase === 'generating'}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-slate-600 text-white text-sm font-medium rounded-xl transition-colors disabled:cursor-not-allowed"
        >
          发送
        </button>
      </div>
    </div>
  );
}
