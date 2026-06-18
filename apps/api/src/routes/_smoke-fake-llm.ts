/**
 * Path 2 Step4 — DEV-only fake-LLM（fake OpenRouter / DeepSeek）替身
 *
 * 让 expand 扩词链路在 CI/evaluator 无真 LLM key 时可确定性验证：
 *   - POST /__test/llm-mode        切换 mode（ok | fail），控制扩词成功 / 降级
 *   - POST /chat/completions       OpenAI 兼容补全（mode=ok 返 3 关键词 / mode=fail 返 401）
 *   - POST /v1/chat/completions    同上（兼容带 /v1 前缀的 base）
 *
 * 门禁：NODE_ENV=production 一律 404（生产走真 OpenRouter，OPENROUTER_BASE_URL 不指向此处）。
 * evaluator/CI 把 OPENROUTER_BASE_URL = FAKE_LLM_BASE 指向本服务，expand 即走这里。
 */
import { Router, Request, Response } from 'express';

const router = Router();

// 进程内 mode（默认 ok）
let llmMode: 'ok' | 'fail' = 'ok';

// 默认 3 个扩词（mode=ok 时返回）
const FAKE_KEYWORDS = ['全屋定制', '环保板材', '免费量房'];

// 注意：本 router 挂在根路径，仅在 NODE_ENV!=production 时由 app.ts 条件挂载
// （生产不挂载 → 真 OpenRouter 链路不受影响；不能在此用 router.use 全量 404，会拦截所有透传请求）

// POST /__test/llm-mode  { mode: 'ok' | 'fail' }
router.post('/__test/llm-mode', (req: Request, res: Response) => {
  const mode = req.body?.mode;
  if (mode === 'ok' || mode === 'fail') {
    llmMode = mode;
    return res.json({ ok: true, mode: llmMode });
  }
  return res.status(400).json({ ok: false, error: 'mode must be ok|fail' });
});

function chatCompletions(_req: Request, res: Response) {
  if (llmMode === 'fail') {
    // 模拟 401（限流/鉴权失败）→ 上游 axios 抛错 → expand 走种子兜底 degraded=true
    return res.status(401).json({ error: { message: 'fake LLM 401 (mode=fail)', code: 401 } });
  }
  return res.json({
    id: 'fake-cmpl',
    object: 'chat.completion',
    model: 'deepseek/deepseek-chat',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: FAKE_KEYWORDS.join('\n') },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 9, total_tokens: 19 },
  });
}

router.post('/chat/completions', chatCompletions);
router.post('/v1/chat/completions', chatCompletions);

export default router;
export { router as fakeLlmRouter };
