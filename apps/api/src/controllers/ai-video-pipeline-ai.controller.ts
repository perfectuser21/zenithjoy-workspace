import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import https from 'https';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';
import { getTemplate, TemplateSpec } from '../templates/registry';

const svc = new AiVideoPipelineService();
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const PIAPI_KEY = process.env.PIAPI_API_KEY || '';

// Fetch GSAP once from CDN and cache server-side — embedded inline so rendered HTML needs no CDN access
let _gsapCache: string | null = null;
async function gsapInline(): Promise<string> {
  if (_gsapCache) return _gsapCache;
  try {
    const r = await fetch('https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js');
    _gsapCache = await r.text();
  } catch {
    // Minimal stub so page doesn't crash if CDN is unreachable at server startup
    _gsapCache = 'window.gsap={timeline:function(){var o={from:function(){return o;},to:function(){return o;},seek:function(){}};return o;}};';
  }
  return _gsapCache;
}

// ── helpers ────────────────────────────────────────────────────────────────

function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const parsed = new URL(url);
    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(`JSON parse failed: ${data.slice(0, 200)}`)); }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(30_000, () => { req.destroy(new Error('postJson timeout')); });
    req.write(payload);
    req.end();
  });
}

function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
        });
      },
    );
    req.on('error', reject);
  });
}

// ── transcribeAudio ────────────────────────────────────────────────────────

export async function transcribeAudio(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const audioFile = req.file;
    if (!audioFile) return res.status(400).json({ error: 'audio file required' });

    const audioB64 = (audioFile.buffer ?? fs.readFileSync(audioFile.path)).toString('base64');
    const mime = audioFile.mimetype || 'audio/wav';

    const result = await postJson(
      'https://openrouter.ai/api/v1/chat/completions',
      { Authorization: `Bearer ${OPENROUTER_KEY}` },
      {
        model: 'google/gemini-2.0-flash-001',
        messages: [{
          role: 'user',
          content: [
            {
              type: 'text',
              text: `请完整转写这段普通话音频。要求：
1. 使用简体中文
2. 每句话一行，格式：[SS.S] 文字（秒数，一位小数）
3. 时间戳精确到0.1秒
4. 保留原话，不要意译
5. 静音/停顿超过2秒跳过不写
只输出转写结果，不要其他解释。`,
            },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${audioB64}` } },
          ],
        }],
      },
    ) as { choices?: { message?: { content?: string } }[] };

    const text = result?.choices?.[0]?.message?.content ?? '';

    const segments: { start: number; end: number; text: string }[] = [];
    const lines = text.split('\n').filter((l) => l.trim());
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\[(\d+\.?\d*)\]\s+(.+)/);
      if (!m) continue;
      const start = parseFloat(m[1]);
      const nextM = lines[i + 1]?.match(/^\[(\d+\.?\d*)\]/);
      const end = nextM ? parseFloat(nextM[1]) : start + 5;
      segments.push({ start, end, text: m[2].trim() });
    }

    const transcript = segments.map((s) => s.text).join('。');
    res.json({ transcript, segments });
  } catch (err) { next(err); }
}

// ── designScenes ───────────────────────────────────────────────────────────

export async function designScenes(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { transcript, segments, duration, topic } = req.body as {
      transcript: string;
      segments: { start: number; end: number; text: string }[];
      duration: number;
      topic?: string;
    };

    if (!transcript || !duration) return res.status(400).json({ error: 'transcript and duration required' });

    const prompt = `你是一个短视频分镜设计师。根据以下视频文案，设计 HyperFrame 分镜。

视频主题：${topic || '未指定'}
视频时长：${duration}秒
转写文案：
${segments.map((s) => `[${s.start}s] ${s.text}`).join('\n')}

请输出 JSON 格式的场景数组，格式如下：
{
  "scenes": [
    {
      "start": 0.0,
      "duration": 6.0,
      "layout": "burst",
      "eyebrow": "标签文字（6字以内）",
      "title": "主标题（10字以内，可换行用\\n）",
      "body": "副标题或正文（20字以内）",
      "tags": ["关键词1", "关键词2", "关键词3"]
    }
  ]
}

Layout 类型规则：
- burst：开场震撼，大数字/冲击感 → 第1帧
- stats：数据呈现，多个数字并列
- comparison：左右对比
- tags：关键词云，标签堆叠
- finale：结尾 CTA，行动号召 → 最后1帧

要求：
1. 场景数量 4-6 个
2. 所有场景的 start+duration 总和 ≤ ${duration}
3. 第一帧 layout=burst，最后帧 layout=finale
4. 相邻帧 layout 不重复
5. 只输出 JSON，不要其他内容`;

    let scenes: unknown[] = [];
    try {
      const result = await postJson(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${OPENROUTER_KEY}` },
        {
          model: 'anthropic/claude-sonnet-4-5',
          max_tokens: 2048,
          messages: [{ role: 'user', content: prompt }],
        },
      ) as { choices?: { message?: { content?: string } }[] };
      const raw = result?.choices?.[0]?.message?.content ?? '{}';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as { scenes?: unknown[] };
        if (parsed?.scenes?.length) scenes = parsed.scenes;
      }
    } catch { /* fall through to segment fallback */ }

    // Fallback: derive scenes from segments when model is unavailable
    if (!scenes.length && segments?.length) {
      const sceneCount = Math.min(Math.max(Math.ceil(duration / 7), 3), 6);
      const chunkSize = Math.max(1, Math.ceil(segments.length / sceneCount));
      const layouts = ['burst', 'tags', 'stats'] as const;
      for (let i = 0; i < segments.length; i += chunkSize) {
        const sl = segments.slice(i, i + chunkSize);
        const isLast = i + chunkSize >= segments.length;
        const text = sl.map((s) => s.text).join(' ');
        scenes.push({
          start: sl[0].start,
          duration: Math.max(sl[sl.length - 1].end - sl[0].start, 3),
          layout: isLast ? 'finale' : layouts[Math.min(scenes.length, layouts.length - 1)],
          eyebrow: `SCENE ${String(scenes.length + 1).padStart(2, '0')}`,
          title: text.slice(0, 10),
          body: text.slice(0, 20),
          tags: text.split(/[，,。！？\s]+/).filter((w) => w.length >= 2 && w.length <= 5).slice(0, 4),
        });
      }
    }
    if (!scenes.length) {
      scenes = [{ start: 0, duration, layout: 'burst', eyebrow: 'SCENE 01', title: transcript.slice(0, 10) || '精彩内容', body: transcript.slice(0, 20) || '', tags: [] }];
    }

    res.json({ scenes });
  } catch (err) { next(err); }
}

// ── composeHtml ────────────────────────────────────────────────────────────

export async function composeHtml(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { scenes, duration, video_filename = 'video.mp4', logo_filename } = req.body as {
      scenes: Array<{
        start: number; duration: number; layout: string;
        eyebrow: string; title: string; body: string; tags?: string[];
      }>;
      duration: number;
      video_filename?: string;
      logo_filename?: string;
    };

    if (!scenes?.length || !duration) return res.status(400).json({ error: 'scenes and duration required' });

    const COLORS = `
:root{--bg:#08091a;--bg1:#0e1030;--tc:#818cf8;--g1:#6366f1;--g2:#8b5cf6;
--white:#fff;--w60:rgba(255,255,255,.60);--w30:rgba(255,255,255,.30);
--dim:rgba(129,140,248,.15);--mid:rgba(129,140,248,.45);
--orange:#f87171;--green:#34d399;--yellow:#fbbf24;}`;

    const sceneHtml = scenes.map((s, i) => {
      const id = `s${i + 1}`;
      const tagsHtml = (s.tags ?? []).map((t) => `<span class="tg">${t}</span>`).join('');
      return `
  <div id="${id}" class="clip" data-start="${s.start}" data-duration="${s.duration}" style="position:absolute;inset:0">
    <div class="cw" id="cam${i + 1}"><div class="pb"></div></div>
    <div class="inner" id="${id}i">
      <div class="cn">
        <div class="eb" id="${id}e">${s.eyebrow}</div>
        <div class="mt" id="${id}t" style="font-size:64px;font-weight:800;line-height:1.1;margin:12px 0">${s.title.replace(/\\n/g, '<br>')}</div>
        <div class="bd" id="${id}b" style="font-size:28px;color:var(--w60);margin:8px 0">${s.body}</div>
        ${tagsHtml ? `<div class="tag-row" id="${id}r" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">${tagsHtml}</div>` : ''}
      </div>
    </div>
  </div>`;
    }).join('');

    const tlEntries = scenes.map((s, i) => {
      const id = `s${i + 1}`;
      const S = s.start;
      const D = s.duration;
      const E = S + D;
      return `
(function(){
  const S=${S},E=${E},DUR=${D};
  tl.to('#${id}i',{opacity:1,duration:0.18,ease:'power2.out'},S);
  tl.fromTo('#cam${i + 1}',{scale:1.05,x:0},{scale:1.0,x:-8,duration:DUR,ease:'none'},S);
  tl.to('#cam${i + 1} .pb',{x:-15,y:-8,duration:DUR,ease:'none'},S);
  tl.from('#${id}e',{opacity:0,letterSpacing:'0.8em',duration:0.15,ease:'power4.out'},S+0.10);
  tl.from('#${id}t',{x:-18,opacity:0,duration:0.20,ease:'expo.out'},S+0.15);
  tl.from('#${id}b',{y:6,opacity:0,duration:0.22,ease:'power2.out'},S+0.26);
  tl.from('#${id}r .tg',{y:10,opacity:0,duration:0.15,stagger:0.04,ease:'power3.out'},S+0.35);
  tl.to('#${id}i',{opacity:0,duration:0.12,ease:'power2.in'},E-0.12);
})();`;
    }).join('');

    const videoEl = `<video id="main-video" data-start="0" data-duration="${duration}" src="${video_filename}" muted playsinline style="width:252px;height:448px;object-fit:cover;border-radius:32px"></video>`;
    const logoEl = logo_filename ? `<img src="${logo_filename}" style="width:80px;height:80px;object-fit:contain;margin-top:16px">` : '';
    const gsapJs = await gsapInline();

    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
${COLORS}
body{width:1920px;height:1080px;overflow:hidden;background:var(--bg);font-family:'Noto Sans SC',sans-serif;color:var(--white)}
#left-panel{position:absolute;left:0;top:0;width:320px;height:1080px;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg1);gap:16px}
#board{position:absolute;left:320px;top:0;right:0;height:1080px;overflow:hidden}
.clip{position:absolute;inset:0}
.cw{position:absolute;inset:0;background:linear-gradient(135deg,var(--bg) 0%,var(--bg1) 100%)}
.pb{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 40%,rgba(99,102,241,.15) 0%,transparent 60%)}
.inner{position:absolute;inset:0;display:flex;padding:60px 80px;flex-direction:column;justify-content:center;opacity:0}
.cn{max-width:900px}
.eb{display:inline-block;padding:6px 16px;border-radius:20px;background:var(--dim);border:1px solid var(--mid);color:var(--tc);font-size:20px;letter-spacing:.15em;text-transform:uppercase;margin-bottom:8px}
.tg{padding:8px 18px;border-radius:12px;background:var(--dim);border:1px solid var(--mid);color:var(--tc);font-size:20px}
</style>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700;800&family=Space+Grotesk:wght@700&display=swap" rel="stylesheet">
</head>
<body>
<div id="left-panel">
  ${videoEl}
  ${logoEl}
</div>
<div id="board" data-composition-id="pipeline-job" data-start="0" data-duration="${duration}" data-width="1600" data-height="1080">
  ${sceneHtml}
  <audio id="bgm" data-start="0" data-duration="${duration}" data-volume="0.3" src="bgm/bgm.mp3" loop></audio>
</div>
<script>${gsapJs}</script>
<script>
const tl = gsap.timeline({paused:true});
window.__timelines = window.__timelines || {};
window.__timelines['pipeline-job'] = tl;
${tlEntries}
window.__hf = { duration: ${duration}, seek: function(t){ tl.seek(t, false); } };
</script>
</body>
</html>`;

    res.json({ html });
  } catch (err) { next(err); }
}

// ── analyzeTranscript ──────────────────────────────────────────────────────

export async function analyzeTranscript(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { segments, duration, topic } = req.body as {
      segments: Array<{ start: number; end: number; text: string }>;
      duration: number;
      topic?: string;
    };

    if (!segments?.length) return res.status(400).json({ error: 'segments required' });

    const segmentList = segments.map((s, i) =>
      `[${i}] [${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] "${s.text}"`,
    ).join('\n');

    const prompt = `你是专业短视频剪辑师。分析以下口播视频逐字稿，判断每个片段是否保留。

视频主题：${topic || '未知'}
视频时长：${duration}秒

片段列表（格式：[序号] [开始-结束] "内容"）：
${segmentList}

判断标准：
- 保留（keep: true）：与主题相关的有效内容，观点陈述，数据，案例，结论
- 删除（keep: false）：
  * 废话/跑题：和主题无关，与他人闲聊，口头禅堆砌
  * 重复内容：同样意思已经说过
  * 口误+自我纠正中的错误部分（纠正后内容保留）
  * 纯呼吸声/嗯啊等无意义音节单独成段

只输出 JSON，不要其他内容：
{
  "segments": [
    {"index": 0, "keep": true, "reason": "核心观点"},
    {"index": 1, "keep": false, "reason": "废话"}
  ]
}

共 ${segments.length} 个片段，每个都必须判断。`;

    const result = await postJson(
      'https://openrouter.ai/api/v1/chat/completions',
      { Authorization: `Bearer ${OPENROUTER_KEY}` },
      {
        model: 'google/gemini-2.0-flash-001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      },
    ) as { choices?: { message?: { content?: string } }[]; error?: { message?: string } };

    if (result?.error) return res.status(502).json({ error: result.error.message || 'OpenRouter error' });
    const raw = result?.choices?.[0]?.message?.content ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'model returned invalid JSON' });

    const parsed = JSON.parse(jsonMatch[0]) as { segments: Array<{ index: number; keep: boolean; reason: string }> };

    const analyzedSegments = segments.map((s, i) => {
      const a = parsed.segments?.find((x) => x.index === i);
      return { ...s, keep: a?.keep ?? true, reason: a?.reason ?? '' };
    });

    res.json({ segments: analyzedSegments });
  } catch (err) { next(err); }
}

// ── generateBgm ────────────────────────────────────────────────────────────

export async function generateBgm(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { style = 'professional tech corporate, upbeat, modern piano electronic, no vocals, instrumental, 110 BPM' } = req.body as { style?: string };

    const submitRes = await postJson(
      'https://api.piapi.ai/api/v1/task',
      { 'x-api-key': PIAPI_KEY },
      {
        model: 'Qubico/ace-step',
        task_type: 'txt2audio',
        input: {
          duration: 30,
          lyrics: '[instrumental]',
          style_prompt: style,
          negative_style_prompt: 'vocals, singing, speech, noise, drums, heavy beat',
        },
      },
    ) as { code: number; data?: { task_id?: string } };

    if (submitRes.code !== 200 || !submitRes.data?.task_id) {
      return res.status(502).json({ error: 'PiAPI submit failed', detail: submitRes });
    }

    const taskId = submitRes.data.task_id;

    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const pollRes = await getJson(
        `https://api.piapi.ai/api/v1/task/${taskId}`,
        { 'x-api-key': PIAPI_KEY },
      ) as { data?: { status?: string; output?: { audio_url?: string } } };

      if (pollRes?.data?.status === 'completed' && pollRes.data.output?.audio_url) {
        return res.json({ url: pollRes.data.output.audio_url });
      }
      if (pollRes?.data?.status === 'failed') {
        return res.status(502).json({ error: 'PiAPI generation failed' });
      }
    }

    res.status(504).json({ error: 'BGM generation timeout' });
  } catch (err) { next(err); }
}

// ── Template slot types ────────────────────────────────────────────────────

interface TemplateMetric { label: string; value: string; unit: string; }
interface TemplateSlots {
  eyebrow: string;
  title: string[];       // array of lines
  titleAccent: string;   // word inside title to highlight with accent color
  subtitle: string;
  metrics: TemplateMetric[];
  hook: { handle: string; caption: string; hashtags: string[] };
  pageNum?: string;
}

// ── composeTemplate ────────────────────────────────────────────────────────
export async function composeTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const {
      transcript = '',
      segments = [],
      duration = 10,
    } = req.body as {
      transcript?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
      duration?: number;
      video_filename?: string;
    };

    const templateId = job.template_id;
    if (!templateId) return res.status(400).json({ error: 'job has no template_id' });

    const spec = getTemplate(templateId);
    if (!spec) return res.status(400).json({ error: `unknown template: ${templateId}` });

    const transcriptText = segments.length > 0
      ? segments.map((s) => `[${s.start.toFixed(1)}s] ${s.text}`).join('\n')
      : (transcript || '精彩视频内容');

    // ── AI: extract template-specific slot data ──
    const slotsPrompt = `你是短视频模板内容专家。根据以下口播逐字稿，提取模板卡片所需数据。

逐字稿：
${transcriptText}

视频时长：${duration.toFixed(1)}秒
主题：${(job as { topic?: string }).topic || '未指定'}

请提取并输出 JSON（只输出JSON，不要其他文字）：
{
  "eyebrow": "CASE STUDY / 简短行业标签（英文+中文，25字以内）",
  "title": ["核心主张第一行（8字以内）", "有力量的第二行（有反转或强化，8字以内）"],
  "titleAccent": "title中最有冲击力的2-4个字（用高亮色显示）",
  "subtitle": "一句总结（30字以内，口语化，直击痛点）",
  "metrics": [
    {"label": "指标名称（4字以内）", "value": "数字或比值", "unit": "×"},
    {"label": "指标名称（4字以内）", "value": "数字", "unit": "%"},
    {"label": "指标名称（4字以内）", "value": "数字", "unit": "倍"}
  ],
  "hook": {
    "handle": "@博主账号（风格匹配内容）",
    "caption": "开场钩子句（吸引眼球，带引号）",
    "hashtags": ["#标签1", "#标签2"]
  }
}
规则：metrics优先从逐字稿提取真实数字；无数字则用行业基准数据（如互动率3.2×、完播率+68%）。`;

    let slots: TemplateSlots = {
      eyebrow: 'CASE STUDY / 精准共鸣',
      title: ['前三秒，', '决定算法'],
      titleAccent: '决定',
      subtitle: transcript.slice(0, 30) || '短视频运营的核心逻辑',
      metrics: [
        { label: '互动率', value: '3.2', unit: '×' },
        { label: '完播率', value: '+68', unit: '%' },
        { label: '精准曝光', value: '91', unit: '%' },
      ],
      hook: { handle: '@精准案例', caption: '"给所有人说一句话……"', hashtags: ['#短视频运营', '#精准流量'] },
    };

    try {
      const slotsResult = await postJson(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${OPENROUTER_KEY}` },
        {
          model: 'anthropic/claude-haiku-4-5',
          max_tokens: 1024,
          messages: [{ role: 'user', content: slotsPrompt }],
        },
      ) as { choices?: { message?: { content?: string } }[] };
      const raw = slotsResult?.choices?.[0]?.message?.content ?? '{}';
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as Partial<TemplateSlots>;
        slots = {
          eyebrow: parsed.eyebrow || slots.eyebrow,
          title: Array.isArray(parsed.title) && parsed.title.length ? parsed.title : slots.title,
          titleAccent: parsed.titleAccent || slots.titleAccent,
          subtitle: parsed.subtitle || slots.subtitle,
          metrics: Array.isArray(parsed.metrics) && parsed.metrics.length ? parsed.metrics : slots.metrics,
          hook: parsed.hook || slots.hook,
        };
      }
    } catch (e) {
      console.warn('[composeTemplate] slot generation error (using defaults):', e instanceof Error ? e.message : e);
    }

    const gsapJs = await gsapInline();
    const html = _buildTemplateHtml(templateId, slots, gsapJs, spec, duration);
    res.json({ html, aspect: spec.aspect, width: spec.width, height: spec.height, phoneRect: spec.phoneRect ?? null });
  } catch (err) { next(err); }
}

export function _esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── _highlightAccent: wrap titleAccent in colored span ─────────────────────
function _highlightAccent(line: string, accent: string, color: string): string {
  if (!accent || !line.includes(accent)) return _esc(line);
  const parts = _esc(line).split(_esc(accent));
  return parts.join(`<span style="color:${color}">${_esc(accent)}</span>`);
}

// ── _buildTemplateHtml: route to template-specific builder ─────────────────
function _buildTemplateHtml(
  templateId: string,
  slots: TemplateSlots,
  gsapJs: string,
  spec: TemplateSpec,
  duration: number,
): string {
  if (templateId === 'C') return _buildHtmlC(slots, gsapJs, spec, duration);
  if (templateId === 'R') return _buildHtmlR(slots, gsapJs, spec, duration);
  if (templateId === 'W-G') return _buildHtmlWG(slots, gsapJs, spec, duration);
  return _buildHtmlGeneric(slots, gsapJs, spec, duration);
}

// ── Template C — 克制纪录片 · 黑底暖黄 · 16:9 (1920×1080) ─────────────────
function _buildHtmlC(slots: TemplateSlots, gsapJs: string, spec: TemplateSpec, duration: number): string {
  const t = { bg: '#0a0a0a', ink: '#f0ede5', dim: 'rgba(240,237,229,0.5)', rule: 'rgba(240,237,229,0.12)', amber: '#c9a23d' };
  const { phoneRect } = spec; // {x:206, y:173, w:328, h:724}
  const titleHtml = (slots.title || []).map((line) =>
    `<div>${_highlightAccent(line, slots.titleAccent, t.amber)}</div>`).join('');
  const metricsHtml = (slots.metrics || []).slice(0, 3).map((m, i) => `
<div style="padding-right:30px;${i > 0 ? 'padding-left:30px;' : ''}${i < 2 ? `border-right:1px solid ${t.rule};` : ''}">
  <div id="m-label-${i}" style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.3em;color:${t.dim};text-transform:uppercase;">0${i + 1} · ${_esc(m.label)}</div>
  <div id="m-value-${i}" style="margin-top:8px;font-family:'Noto Serif SC',serif;font-weight:500;font-size:60px;line-height:1;color:${t.ink};">${_esc(m.value)}<span style="color:${t.amber};font-size:28px;margin-left:4px;">${_esc(m.unit)}</span></div>
</div>`).join('');
  const progressHtml = Array.from({ length: 8 }).map((_, i) =>
    `<div style="width:${i === 2 ? 32 : 22}px;height:2px;background:${i === 2 ? t.ink : t.rule};"></div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Noto+Serif+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1920px;height:1080px;overflow:hidden;background:${t.bg}}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:${t.bg};color:${t.ink};font-family:'Noto Sans SC',system-ui,sans-serif;}
</style></head>
<body>
<div id="root" data-composition-id="template-c" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
  <!-- Top meta strip -->
  <div id="eyebrow-strip" style="position:absolute;top:0;left:0;right:0;height:60px;display:flex;align-items:center;justify-content:space-between;padding:0 60px;font-family:'JetBrains Mono',monospace;font-size:13px;letter-spacing:.32em;color:${t.amber};">
    <span>${_esc(slots.eyebrow)}</span>
    <span>${_esc(slots.pageNum || '01 / 01')}</span>
  </div>
  <!-- Horizontal rule under top strip -->
  <div style="position:absolute;top:60px;left:60px;right:60px;height:1px;background:${t.rule};"></div>
  <!-- Phone bezel area (video overlaid here by FFmpeg) -->
  ${phoneRect ? `
  <div id="phone-wrap" style="position:absolute;left:60px;top:100px;width:620px;bottom:110px;display:flex;align-items:center;justify-content:center;">
    <div style="width:352px;height:736px;border-radius:48px;padding:6px;background:linear-gradient(160deg,#222 0%,#000 100%);box-shadow:0 30px 80px rgba(0,0,0,.8),0 0 0 1px rgba(255,255,255,.04) inset;">
      <div style="width:100%;height:100%;border-radius:42px;background:#0a0a0a;overflow:hidden;position:relative;">
        <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:90px;height:26px;border-radius:14px;background:#000;z-index:2;"></div>
        <div style="position:absolute;left:12px;right:12px;bottom:16px;z-index:2;font-size:11px;color:rgba(255,255,255,.5);font-family:'JetBrains Mono',monospace;letter-spacing:.1em;text-align:center;">VIDEO PREVIEW</div>
      </div>
    </div>
  </div>` : ''}
  <!-- Right content panel -->
  <div id="content-panel" style="position:absolute;left:760px;top:240px;right:80px;">
    <div id="scene-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:16px;letter-spacing:.32em;color:${t.amber};text-transform:uppercase;margin-bottom:28px;">SCENE 01 / 精准共鸣点</div>
    <div id="scene-title" style="font-family:'Noto Serif SC',serif;font-weight:900;font-size:116px;line-height:1.1;letter-spacing:-.01em;">${titleHtml}</div>
    ${slots.subtitle ? `<div id="scene-subtitle" style="margin-top:30px;font-size:19px;line-height:1.65;color:rgba(240,237,229,0.65);max-width:880px;">${_esc(slots.subtitle)}</div>` : ''}
    <div id="scene-metrics" style="margin-top:70px;padding-top:26px;border-top:1px solid ${t.rule};display:grid;grid-template-columns:1fr 1fr 1fr;">
      ${metricsHtml}
    </div>
  </div>
  <!-- Progress bar -->
  <div id="progress" style="position:absolute;bottom:50px;right:60px;display:flex;gap:10px;align-items:center;">
    ${progressHtml}
  </div>
  <!-- Horizontal rule above progress -->
  <div style="position:absolute;bottom:80px;left:60px;right:60px;height:1px;background:${t.rule};"></div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var D=${duration};
var tl=gsap.timeline({paused:true});
gsap.set(['#eyebrow-strip','#phone-wrap','#content-panel','#progress'],{opacity:0});
tl.to('#eyebrow-strip',{opacity:1,duration:.3,ease:'power2.out'},.1);
tl.from('#eyebrow-strip',{y:-20,duration:.3,ease:'expo.out'},.1);
tl.to('#phone-wrap',{opacity:1,duration:.5,ease:'power2.out'},.2);
tl.from('#phone-wrap',{scale:.92,duration:.5,ease:'back.out(1.4)'},.2);
tl.to('#scene-eyebrow',{opacity:1,duration:.2,ease:'power2.out'},.4);
tl.from('#scene-eyebrow',{letterSpacing:'1.4em',duration:.3,ease:'power4.out'},.4);
tl.to('#scene-title',{opacity:1,duration:.4,ease:'power2.out'},.55);
tl.from('#scene-title',{y:30,duration:.4,ease:'expo.out'},.55);
if(document.getElementById('scene-subtitle')){
  tl.to('#scene-subtitle',{opacity:1,duration:.35,ease:'power2.out'},.75);
  tl.from('#scene-subtitle',{y:12,duration:.35,ease:'expo.out'},.75);
}
tl.to('#scene-metrics',{opacity:1,duration:.4,ease:'power2.out'},.9);
tl.from('#scene-metrics',{y:16,duration:.4,ease:'expo.out'},.9);
tl.to('#progress',{opacity:1,duration:.3,ease:'power2.out'},1.1);
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};
window.__timelines['template-c']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script>
</body></html>`;
}

// ── Template R — 深酒红棕 · 玫瑰金 · 16:9 (1920×1080) ────────────────────
function _buildHtmlR(slots: TemplateSlots, gsapJs: string, spec: TemplateSpec, duration: number): string {
  const t = { bg: '#1d1410', ink: '#f1e9d8', dim: 'rgba(241,233,216,0.55)', rule: 'rgba(241,233,216,0.14)', accent: '#c08e6a' };
  const { phoneRect } = spec;
  const titleHtml = (slots.title || []).map((line) =>
    `<div>${_highlightAccent(line, slots.titleAccent, t.accent)}</div>`).join('');
  const metricsHtml = (slots.metrics || []).slice(0, 3).map((m, i) => `
<div style="text-align:center;padding:0 24px;${i > 0 ? `border-left:1px solid ${t.rule};` : ''}">
  <div style="font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.28em;color:${t.dim};text-transform:uppercase;margin-bottom:10px;">0${i + 1} · ${_esc(m.label)}</div>
  <div style="font-family:'Noto Serif SC',serif;font-size:52px;font-weight:500;line-height:1;color:${t.ink};">${_esc(m.value)}<span style="color:${t.accent};font-size:24px;margin-left:3px;">${_esc(m.unit)}</span></div>
</div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Noto+Serif+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1920px;height:1080px;overflow:hidden;background:${t.bg}}
#root{position:relative;width:1920px;height:1080px;overflow:hidden;background:radial-gradient(ellipse at 50% 40%,${t.bg.replace('#', '#')} 0%,#0e0907 100%);color:${t.ink};}</style></head>
<body>
<div id="root" data-composition-id="template-r" data-start="0" data-duration="${duration}" data-width="1920" data-height="1080">
  <!-- Top strip -->
  <div id="eyebrow-strip" style="position:absolute;top:0;left:0;right:0;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 60px;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.3em;color:${t.accent};border-bottom:1px solid ${t.rule};">
    <span>${_esc(slots.eyebrow)}</span><span>${_esc(slots.pageNum || '01 / 01')}</span>
  </div>
  <!-- Left: phone bezel -->
  ${phoneRect ? `
  <div id="phone-wrap" style="position:absolute;left:${phoneRect.x - 28}px;top:${phoneRect.y - 28}px;width:${phoneRect.w + 56}px;height:${phoneRect.h + 56}px;display:flex;align-items:center;justify-content:center;">
    <div style="width:${phoneRect.w + 12}px;height:${phoneRect.h + 12}px;border-radius:42px;padding:6px;background:linear-gradient(160deg,#3a2a1e 0%,#1a1008 100%);box-shadow:0 24px 80px rgba(0,0,0,.9),0 0 0 1px rgba(192,142,106,.15) inset;">
      <div style="width:100%;height:100%;border-radius:36px;background:#0d0905;overflow:hidden;position:relative;">
        <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:80px;height:24px;border-radius:12px;background:#000;z-index:2;"></div>
      </div>
    </div>
  </div>` : ''}
  <!-- Center: title block -->
  <div id="content-panel" style="position:absolute;left:760px;top:180px;right:60px;text-align:left;">
    <div id="scene-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:.3em;color:${t.accent};text-transform:uppercase;margin-bottom:36px;">${_esc(slots.eyebrow.split('/')[1]?.trim() || 'KEY INSIGHT')}</div>
    <div id="scene-title" style="font-family:'Noto Serif SC',serif;font-weight:900;font-size:96px;line-height:1.12;letter-spacing:-.01em;">${titleHtml}</div>
    ${slots.subtitle ? `<div id="scene-subtitle" style="margin-top:28px;font-size:18px;line-height:1.7;color:${t.dim};max-width:840px;">${_esc(slots.subtitle)}</div>` : ''}
  </div>
  <!-- Metrics bar -->
  <div id="scene-metrics" style="position:absolute;bottom:120px;left:760px;right:60px;padding-top:24px;border-top:1px solid ${t.rule};display:grid;grid-template-columns:1fr 1fr 1fr;">
    ${metricsHtml}
  </div>
  <!-- Progress -->
  <div id="progress" style="position:absolute;bottom:60px;right:60px;display:flex;gap:8px;align-items:center;">
    ${Array.from({ length: 8 }).map((_, i) => `<div style="width:${i === 2 ? 28 : 18}px;height:2px;background:${i === 2 ? t.ink : t.rule};"></div>`).join('')}
  </div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var D=${duration};var tl=gsap.timeline({paused:true});
gsap.set(['#eyebrow-strip','#phone-wrap','#content-panel','#scene-metrics','#progress'],{opacity:0});
tl.to('#eyebrow-strip',{opacity:1,duration:.3},.1);
tl.to('#phone-wrap',{opacity:1,duration:.5,ease:'power2.out'},.15);
tl.from('#phone-wrap',{x:-30,duration:.5,ease:'expo.out'},.15);
tl.to('#scene-eyebrow',{opacity:1,duration:.2},.4);
tl.to('#content-panel',{opacity:1,duration:.0},.38);
tl.from('#scene-title',{y:40,opacity:0,duration:.45,ease:'expo.out'},.5);
if(document.getElementById('scene-subtitle'))tl.from('#scene-subtitle',{y:16,opacity:0,duration:.35,ease:'power2.out'},.72);
tl.to('#scene-metrics',{opacity:1,duration:.4,ease:'power2.out'},.88);
tl.from('#scene-metrics',{y:20,duration:.4,ease:'expo.out'},.88);
tl.to('#progress',{opacity:1,duration:.3},1.05);
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};window.__timelines['template-r']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script></body></html>`;
}

// ── Template W-G — Bauhaus 撞色 · 9:16 (1080×1920) ───────────────────────
function _buildHtmlWG(slots: TemplateSlots, gsapJs: string, spec: TemplateSpec, duration: number): string {
  const t = { bg: '#ede4d2', stripe: '#1f3a3d', ink: '#1a1410', light: '#ede4d2', mustard: '#d39c4a', dim: 'rgba(26,20,16,0.55)', rule: 'rgba(26,20,16,0.18)' };
  const { phoneRect } = spec;
  const titleHtml = (slots.title || []).map((line) =>
    `<div>${_highlightAccent(line, slots.titleAccent, t.mustard)}</div>`).join('');
  const metricsHtml = (slots.metrics || []).slice(0, 3).map((m, i) => `
<div style="${i > 0 ? `border-left:1px solid ${t.rule};padding-left:20px;` : ''}padding-right:20px;">
  <div style="font-family:'JetBrains Mono',monospace;font-size:10px;letter-spacing:.28em;color:${t.dim};text-transform:uppercase;margin-bottom:6px;">${_esc(m.label)}</div>
  <div style="font-family:'Noto Serif SC',serif;font-size:40px;font-weight:700;line-height:1;color:${t.ink};">${_esc(m.value)}<span style="color:${t.mustard};font-size:20px;margin-left:3px;">${_esc(m.unit)}</span></div>
</div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Noto+Serif+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:1080px;height:1920px;overflow:hidden;background:${t.bg}}
#root{position:relative;width:1080px;height:1920px;overflow:hidden;background:${t.bg};color:${t.ink};}</style></head>
<body>
<div id="root" data-composition-id="template-wg" data-start="0" data-duration="${duration}" data-width="1080" data-height="1920">
  <!-- Dark stripe left panel -->
  <div style="position:absolute;left:0;top:0;width:108px;height:100%;background:${t.stripe};"></div>
  <!-- Vertical eyebrow on stripe -->
  <div id="stripe-eyebrow" style="position:absolute;left:0;top:192px;width:108px;display:flex;align-items:center;justify-content:center;">
    <div style="transform:rotate(-90deg);white-space:nowrap;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.3em;color:${t.mustard};text-transform:uppercase;">${_esc(slots.eyebrow)}</div>
  </div>
  <!-- Phone preview area -->
  ${phoneRect ? `
  <div id="phone-wrap" style="position:absolute;left:${phoneRect.x - 20}px;top:${phoneRect.y - 20}px;width:${phoneRect.w + 40}px;height:${phoneRect.h + 40}px;display:flex;align-items:center;justify-content:center;">
    <div style="width:${phoneRect.w + 12}px;height:${phoneRect.h + 12}px;border-radius:42px;padding:6px;background:linear-gradient(160deg,#2a2a2a 0%,#0e0e0e 100%);box-shadow:0 20px 60px rgba(0,0,0,.4);">
      <div style="width:100%;height:100%;border-radius:36px;background:#0a0a0a;overflow:hidden;position:relative;">
        <div style="position:absolute;top:8px;left:50%;transform:translateX(-50%);width:70px;height:22px;border-radius:11px;background:#000;z-index:2;"></div>
      </div>
    </div>
  </div>` : ''}
  <!-- Title block -->
  <div id="content-panel" style="position:absolute;left:134px;top:${(phoneRect ? phoneRect.y + phoneRect.h + 40 : 1200)}px;right:40px;">
    <div id="scene-title" style="font-family:'Noto Serif SC',serif;font-weight:900;font-size:80px;line-height:1.12;color:${t.ink};">${titleHtml}</div>
    ${slots.subtitle ? `<div id="scene-subtitle" style="margin-top:20px;font-size:17px;line-height:1.7;color:${t.dim};max-width:800px;">${_esc(slots.subtitle)}</div>` : ''}
    <div id="scene-metrics" style="margin-top:36px;padding-top:20px;border-top:1px solid ${t.rule};display:flex;gap:0;">
      ${metricsHtml}
    </div>
  </div>
  <!-- Bottom progress -->
  <div id="progress" style="position:absolute;bottom:64px;left:134px;right:40px;display:flex;gap:8px;align-items:center;">
    ${Array.from({ length: 8 }).map((_, i) => `<div style="height:3px;flex:${i === 0 ? 2 : 1};background:${i === 0 ? t.mustard : t.rule};border-radius:2px;"></div>`).join('')}
  </div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var D=${duration};var tl=gsap.timeline({paused:true});
gsap.set(['#stripe-eyebrow','#phone-wrap','#content-panel','#progress'],{opacity:0});
tl.to('#stripe-eyebrow',{opacity:1,duration:.3},.1);
tl.to('#phone-wrap',{opacity:1,duration:.5,ease:'power2.out'},.2);
tl.from('#phone-wrap',{y:-20,scale:.95,duration:.5,ease:'back.out(1.3)'},.2);
tl.to('#content-panel',{opacity:1,duration:.0},.5);
tl.from('#scene-title',{y:30,opacity:0,duration:.4,ease:'expo.out'},.5);
if(document.getElementById('scene-subtitle'))tl.from('#scene-subtitle',{y:12,opacity:0,duration:.3,ease:'power2.out'},.7);
tl.from('#scene-metrics',{y:14,opacity:0,duration:.35,ease:'power2.out'},.85);
tl.to('#progress',{opacity:1,duration:.3},1.0);
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};window.__timelines['template-wg']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script></body></html>`;
}

// ── Generic fallback builder (unknown template) ────────────────────────────
function _buildHtmlGeneric(slots: TemplateSlots, gsapJs: string, spec: TemplateSpec, duration: number): string {
  const { width, height, phoneRect } = spec;
  const titleHtml = (slots.title || []).map((line) => `<div>${_esc(line)}</div>`).join('');
  const BP = 18;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@400;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:${width}px;height:${height}px;overflow:hidden;background:#08091a}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#08091a;color:#fff;font-family:'Noto Sans SC',sans-serif;}
${phoneRect ? `.ph-screen{position:absolute;left:${phoneRect.x}px;top:${phoneRect.y}px;width:${phoneRect.w}px;height:${phoneRect.h}px;background:#000;border-radius:8px;}
.ph-bezel{position:absolute;left:${phoneRect.x - BP}px;top:${phoneRect.y - BP}px;width:${phoneRect.w + BP * 2}px;height:${phoneRect.h + BP * 2}px;border-radius:${30 + BP}px;background:linear-gradient(160deg,#1c1c28,#0e0e18);box-shadow:0 24px 80px rgba(0,0,0,.7);}` : ''}
</style></head>
<body>
<div id="root" data-composition-id="template-generic" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
  ${phoneRect ? '<div class="ph-bezel"></div><div class="ph-screen"></div>' : ''}
  <div id="content" style="position:absolute;left:${phoneRect ? phoneRect.x + phoneRect.w + 40 : 60}px;top:60px;right:60px;bottom:60px;display:flex;flex-direction:column;justify-content:center;gap:20px;">
    <div id="scene-eyebrow" style="font-family:'JetBrains Mono',monospace;font-size:14px;letter-spacing:.3em;color:#818cf8;text-transform:uppercase;">${_esc(slots.eyebrow)}</div>
    <div id="scene-title" style="font-size:${width > 1080 ? 60 : 40}px;font-weight:900;line-height:1.2;">${titleHtml}</div>
    ${slots.subtitle ? `<div id="scene-subtitle" style="font-size:18px;line-height:1.6;color:rgba(255,255,255,.7);">${_esc(slots.subtitle)}</div>` : ''}
  </div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var D=${duration};var tl=gsap.timeline({paused:true});
gsap.set('#content',{opacity:0});
tl.to('#content',{opacity:1,duration:.3},.1);
tl.from('#scene-title',{y:20,opacity:0,duration:.4,ease:'expo.out'},.2);
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};window.__timelines['template-generic']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script></body></html>`;
}
