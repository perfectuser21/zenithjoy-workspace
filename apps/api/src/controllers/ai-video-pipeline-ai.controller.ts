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

// ── composeTemplate — dynamic GSAP HTML, per-segment scenes, Claude Sonnet ──

interface TemplateScene {
  start: number;
  duration: number;
  eyebrow: string;
  title: string;
  subtitle: string;
}

export async function composeTemplate(req: Request, res: Response, next: NextFunction) {
  try {
    const job = await svc.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: 'job not found' });

    const { transcript = '', segments = [], duration = 10 } = req.body as {
      transcript?: string;
      segments?: Array<{ start: number; end: number; text: string }>;
      duration?: number;
      video_filename?: string;
    };

    const templateId = job.template_id;
    if (!templateId) return res.status(400).json({ error: 'job has no template_id' });
    const spec = getTemplate(templateId);
    if (!spec) return res.status(400).json({ error: `unknown template: ${templateId}` });

    // ── Group rough-cut segments into 3-5 scenes ──
    const rawSegs = segments.length > 0
      ? segments
      : [{ start: 0, end: duration, text: transcript || '精彩内容' }];

    const targetCount = Math.min(Math.max(Math.ceil(duration / 6), 3), 5);
    const chunkSize = Math.max(1, Math.ceil(rawSegs.length / targetCount));
    const groups: Array<{ start: number; end: number; text: string }[]> = [];
    for (let i = 0; i < rawSegs.length; i += chunkSize) {
      groups.push(rawSegs.slice(i, i + chunkSize));
    }

    // ── Claude Sonnet: per-scene text ──
    const segList = groups.map((g, i) => {
      const s = g[0].start.toFixed(1);
      const e = g[g.length - 1].end.toFixed(1);
      const txt = g.map((x) => x.text).join(' ');
      return `[场景${i + 1}] [${s}s→${e}s] "${txt}"`;
    }).join('\n');

    const prompt = `你是短视频模板内容专家。根据以下已粗剪的口播片段，为每个场景提炼模板文案。

模板风格：${spec.aspect === '9:16' ? '竖版，大字冲击感' : '横版纪录片感，简洁有力'}
视频总时长：${duration.toFixed(1)}秒

粗剪后的场景片段（已去除废话）：
${segList}

严格输出JSON，不要其他内容：
{
  "scenes": [
    {
      "i": 0,
      "eyebrow": "INSIGHT 01 / 标签（英文序号+中文，20字以内）",
      "title": "该片段最有力的核心句（8字以内，直击要害，禁止超字）",
      "subtitle": "补充说明（25字以内，口语化）"
    }
  ]
}
共 ${groups.length} 个场景，每个都要有对应条目。title必须从该片段原文提炼，字数严格8字以内。`;

    interface SceneText { i: number; eyebrow: string; title: string; subtitle: string; }
    let sceneTexts: SceneText[] = [];
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
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const parsed = JSON.parse(m[0]) as { scenes?: SceneText[] };
        if (parsed?.scenes?.length) sceneTexts = parsed.scenes;
      }
    } catch (e) {
      console.warn('[composeTemplate] Sonnet scene gen error:', e instanceof Error ? e.message : e);
    }

    // Fallback: derive from segment text
    if (!sceneTexts.length) {
      sceneTexts = groups.map((g, idx) => ({
        i: idx,
        eyebrow: `INSIGHT ${String(idx + 1).padStart(2, '0')} / 精彩片段`,
        title: g.map((x) => x.text).join(' ').slice(0, 8),
        subtitle: g.map((x) => x.text).join(' ').slice(0, 25),
      }));
    }

    // ── Build scene list with timestamps ──
    const scenes: TemplateScene[] = groups.map((g, idx) => {
      const t = sceneTexts.find((x) => x.i === idx) ?? sceneTexts[idx];
      return {
        start: g[0].start,
        duration: g[g.length - 1].end - g[0].start,
        eyebrow: t?.eyebrow ?? `INSIGHT ${String(idx + 1).padStart(2, '0')}`,
        title: t?.title ?? g[0].text.slice(0, 8),
        subtitle: t?.subtitle ?? '',
      };
    });

    const gsapJs = await gsapInline();
    const html = _buildDynamicTemplateHtml(templateId, scenes, gsapJs, spec, duration);
    res.json({ html, aspect: spec.aspect, width: spec.width, height: spec.height, phoneRect: spec.phoneRect ?? null });
  } catch (err) { next(err); }
}

export function _esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Dynamic template HTML builder (all templates) ─────────────────────────
export function _buildDynamicTemplateHtml(
  templateId: string,
  scenes: TemplateScene[],
  gsapJs: string,
  spec: TemplateSpec,
  duration: number,
): string {
  const { width, height, phoneRect, aspect } = spec;
  const isPortrait = aspect === '9:16';

  // ── Colour palette per template ──
  type Palette = { bg: string; ink: string; dim: string; accent: string; rule: string; font: string };
  const palettes: Record<string, Palette> = {
    'C':   { bg: '#0a0a0a', ink: '#f0ede5', dim: 'rgba(240,237,229,0.55)', accent: '#c9a23d', rule: 'rgba(240,237,229,0.12)', font: "'Noto Serif SC',serif" },
    'R':   { bg: '#1d1410', ink: '#f1e9d8', dim: 'rgba(241,233,216,0.55)', accent: '#c08e6a', rule: 'rgba(241,233,216,0.14)', font: "'Noto Serif SC',serif" },
    'W-G': { bg: '#ede4d2', ink: '#1a1410', dim: 'rgba(26,20,16,0.55)',    accent: '#d39c4a', rule: 'rgba(26,20,16,0.18)',     font: "'Noto Serif SC',serif" },
  };
  const p: Palette = palettes[templateId] ?? { bg: '#08091a', ink: '#fff', dim: 'rgba(255,255,255,0.6)', accent: '#818cf8', rule: 'rgba(255,255,255,0.15)', font: "'Noto Sans SC',sans-serif" };

  // ── Phone bezel (decorative chrome around phoneRect) ──
  const bezelHtml = phoneRect ? (() => {
    const pad = 22;
    const bx = phoneRect.x - pad, by = phoneRect.y - pad;
    const bw = phoneRect.w + pad * 2, bh = phoneRect.h + pad * 2;
    const br = Math.min(bw, bh) * 0.12 + pad;
    const bezelBg = templateId === 'W-G'
      ? 'linear-gradient(160deg,#2a2a2a 0%,#0e0e0e 100%)'
      : `linear-gradient(160deg,#222 0%,#000 100%)`;
    return `<div id="phone-bezel" style="position:absolute;left:${bx}px;top:${by}px;width:${bw}px;height:${bh}px;border-radius:${br}px;background:${bezelBg};box-shadow:0 28px 80px rgba(0,0,0,.85),0 0 0 1px rgba(255,255,255,.04) inset;z-index:1;">
  <div style="position:absolute;inset:${pad}px;border-radius:${br - pad}px;background:${p.bg};overflow:hidden;">
    <div style="position:absolute;top:10px;left:50%;transform:translateX(-50%);width:72px;height:22px;border-radius:11px;background:#000;z-index:2;"></div>
  </div>
</div>`;
  })() : '';

  // ── Content area position (right of phone for landscape, below for portrait) ──
  const contentLeft = phoneRect && !isPortrait ? phoneRect.x + phoneRect.w + 60 : (isPortrait ? 134 : 60);
  const contentTop  = phoneRect && isPortrait ? phoneRect.y + phoneRect.h + 48 : 140;
  const contentRight = 60;

  // ── Per-scene HTML ──
  const scenesHtml = scenes.map((sc, i) => `
  <div id="sc${i}" class="sc" style="position:absolute;left:${contentLeft}px;top:${contentTop}px;right:${contentRight}px;bottom:80px;opacity:0;pointer-events:none;display:flex;flex-direction:column;justify-content:center;gap:0;">
    <div id="sc${i}e" style="font-family:'JetBrains Mono',monospace;font-size:${isPortrait ? 13 : 15}px;letter-spacing:.32em;color:${p.accent};text-transform:uppercase;margin-bottom:28px;">${_esc(sc.eyebrow)}</div>
    <div id="sc${i}t" style="font-family:${p.font};font-weight:900;font-size:${isPortrait ? 72 : 108}px;line-height:1.08;letter-spacing:-.01em;color:${p.ink};">${_esc(sc.title)}</div>
    ${sc.subtitle ? `<div id="sc${i}s" style="margin-top:28px;font-size:${isPortrait ? 17 : 20}px;line-height:1.65;color:${p.dim};max-width:${isPortrait ? 800 : 900}px;">${_esc(sc.subtitle)}</div>` : ''}
    <div id="sc${i}n" style="margin-top:40px;font-family:'JetBrains Mono',monospace;font-size:11px;letter-spacing:.3em;color:${p.accent};opacity:0.6;">0${i + 1} / 0${scenes.length}</div>
  </div>`).join('');

  // ── GSAP timeline entries ──
  const tlEntries = scenes.map((sc, i) => {
    const S = sc.start;
    const E = Math.max(S + sc.duration - 0.15, S + 0.5);
    const hasSubtitle = !!sc.subtitle;
    return `
(function(){
  var S=${S.toFixed(3)},E=${E.toFixed(3)};
  tl.to('#sc${i}',{opacity:1,duration:.25,ease:'power2.out'},S);
  tl.from('#sc${i}e',{opacity:0,letterSpacing:'1.2em',duration:.28,ease:'power4.out'},S+.08);
  tl.from('#sc${i}t',{y:22,opacity:0,duration:.32,ease:'expo.out'},S+.16);
  ${hasSubtitle ? `tl.from('#sc${i}s',{y:10,opacity:0,duration:.28,ease:'power2.out'},S+.30);` : ''}
  tl.from('#sc${i}n',{opacity:0,duration:.2},S+.40);
  tl.to('#sc${i}',{opacity:0,duration:.18,ease:'power2.in'},E);
})();`;
  }).join('');

  // ── Progress dots ──
  const totalScenes = scenes.length;
  const dotsHtml = Array.from({ length: totalScenes }, (_, i) =>
    `<div id="dot${i}" style="width:${i === 0 ? 28 : 18}px;height:2px;border-radius:1px;background:${i === 0 ? p.accent : p.rule};transition:all .3s;"></div>`
  ).join('');

  // Dot update script: sync to current scene
  const dotUpdates = scenes.map((sc, i) => {
    const S = sc.start;
    const E = sc.start + sc.duration;
    const prev = i > 0 ? `tl.to('#dot${i - 1}',{width:18,background:'${p.rule}',duration:.2},${S.toFixed(3)});` : '';
    return `${prev}
  tl.to('#dot${i}',{width:28,background:'${p.accent}',duration:.2},${S.toFixed(3)});
  tl.to('#dot${i}',{width:18,background:'${p.rule}',duration:.2},${E.toFixed(3)});`;
  }).join('\n');

  const compId = `template-${templateId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=Noto+Serif+SC:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:${p.bg}}
#root{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:${p.bg};color:${p.ink};font-family:'Noto Sans SC',sans-serif;}
.sc{will-change:opacity,transform;}
</style>
</head>
<body>
<div id="root" data-composition-id="${compId}" data-start="0" data-duration="${duration}" data-width="${width}" data-height="${height}">
  <!-- Top strip -->
  <div id="top-strip" style="position:absolute;top:0;left:0;right:0;height:56px;display:flex;align-items:center;justify-content:space-between;padding:0 56px;font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.32em;color:${p.accent};border-bottom:1px solid ${p.rule};opacity:0;">
    <span>ZENITHJOY · ${templateId}</span>
    <span>${duration.toFixed(0)}S</span>
  </div>
  <!-- Phone bezel -->
  ${bezelHtml}
  <!-- Scene panels -->
  ${scenesHtml}
  <!-- Progress dots -->
  <div id="progress" style="position:absolute;bottom:28px;${phoneRect && !isPortrait ? `left:${phoneRect.x + phoneRect.w + 60}px` : 'left:134px'};right:60px;display:flex;gap:10px;align-items:center;opacity:0;">
    ${dotsHtml}
  </div>
  <!-- Bottom rule -->
  <div style="position:absolute;bottom:56px;left:56px;right:56px;height:1px;background:${p.rule};"></div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var D=${duration};
var tl=gsap.timeline({paused:true});
tl.to('#top-strip',{opacity:1,duration:.3,ease:'power2.out'},.05);
tl.to('#phone-bezel',{opacity:1,duration:.45,ease:'back.out(1.3)'},.1);
tl.from('#phone-bezel',{scale:.94,duration:.45,ease:'back.out(1.3)'},.1);
tl.to('#progress',{opacity:1,duration:.3},.3);
${tlEntries}
${dotUpdates}
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};
window.__timelines['${compId}']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script>
</body>
</html>`;
}
