#!/usr/bin/env node
/**
 * 批量混剪加厚 · Step1 第三方真调一次（规则B — GP line05/batch_mashup）。
 *
 * 用真 TOAPIS/Gemini key 真请求真响应，校验文案解析真能返回结构化分段（不是只看 200）。
 * 复用生产同一条路子：TOAPIS 代理 + OpenAI 兼容 /chat/completions（与 material-tagging.ts /
 * mashup-render.ts 一致）。凭据来自 ~/.credentials/toapis.env（TOAPIS_API_KEY / TOAPIS_BASE_URL）。
 *
 * 凭据不可得时**不静默假绿**：直接非 0 退出并打印原因（见合同「未覆盖真实链路清单」）。
 */
const apiKey = process.env.TOAPIS_API_KEY;
const base = process.env.TOAPIS_BASE_URL || 'https://toapis.com/v1';
if (!apiKey) {
  console.error('FAIL: TOAPIS_API_KEY 未注入（凭据不可得，见未覆盖真实链路清单，不当 PASS 兜过）');
  process.exit(1);
}

const script = '开场先抛一个悬念钩子，然后展示产品特写细节，最后给出行动号召让用户下单。';
const prompt =
  '把下面这段带货文案切成有序分段，每段返回 JSON 数组元素 {roleLabel, suggestedCount}。' +
  '只返回 JSON 数组，不要多余文字。文案：' + script;

const ctrl = new AbortController();
const timer = setTimeout(() => ctrl.abort(), 60000);
try {
  const resp = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gemini-2.5-flash-official',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
    }),
    signal: ctrl.signal,
  });
  if (!resp.ok) {
    console.error(`FAIL: TOAPIS HTTP ${resp.status}`);
    process.exit(1);
  }
  const data = await resp.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    console.error('FAIL: 响应中解析不出 JSON 分段数组，前80字：' + String(text).slice(0, 80));
    process.exit(1);
  }
  const segs = JSON.parse(match[0]);
  if (!Array.isArray(segs) || segs.length < 1 || typeof segs[0].roleLabel !== 'string') {
    console.error('FAIL: 分段结构不符（缺 roleLabel）');
    process.exit(1);
  }
  console.log(`OK: 真 TOAPIS 返回 ${segs.length} 个结构化分段，首段 roleLabel=${segs[0].roleLabel}`);
  process.exit(0);
} catch (err) {
  console.error('FAIL: 真调 TOAPIS 异常 ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
} finally {
  clearTimeout(timer);
}
