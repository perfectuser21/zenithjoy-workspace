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

    // Build timestamped transcript for Claude
    const transcriptText = segments.length > 0
      ? segments.map((s) => `[${s.start.toFixed(1)}s-${s.end.toFixed(1)}s] ${s.text}`).join('\n')
      : (transcript || '精彩视频内容');

    const sceneCount = Math.min(Math.max(Math.ceil(duration / 7), 3), 10);

    const scenePrompt = `你是短视频字幕导演。根据以下逐字稿（含时间戳）设计 ${sceneCount} 个信息卡场景。
每个场景配合口播节奏，在画面信息区展示视觉化卡片。

逐字稿：
${transcriptText}

视频总时长：${duration.toFixed(1)}秒

场景类型：
- burst: 震撼数字/事实（大数字配描述）
- tags: 关键词列表（4-6个标签）
- question: 反问句（大字体问句）
- stats: 多指标对比（2-3行）
- finale: 结尾CTA

只输出 JSON 数组，不要其他文字：
[
  {
    "start": <起始秒>,
    "duration": <持续秒，至少3秒>,
    "layout": "burst|tags|question|stats|finale",
    "eyebrow": "场景标签（8字以内）",
    "title": "主标题（10字以内）",
    "body": "补充说明（25字以内，可空）",
    "tags": ["关键词1", "关键词2"]
  }
]
规则：第一个start=0，最后一个用finale，不重叠，总覆盖${duration.toFixed(1)}秒`;

    type SceneItem = { start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] };
    let scenes: SceneItem[] = [];

    try {
      const sceneResult = await postJson(
        'https://openrouter.ai/api/v1/chat/completions',
        { Authorization: `Bearer ${OPENROUTER_KEY}` },
        {
          model: 'anthropic/claude-haiku-4-5',
          max_tokens: 2048,
          messages: [{ role: 'user', content: scenePrompt }],
        },
      ) as { choices?: { message?: { content?: string } }[] };
      const raw = sceneResult?.choices?.[0]?.message?.content ?? '[]';
      const m = raw.match(/\[[\s\S]*\]/);
      scenes = m ? JSON.parse(m[0]) : [];
    } catch (e) {
      console.warn('[composeTemplate] scene design error:', e instanceof Error ? e.message : e);
    }

    // Fallback: derive scenes from segments
    if (!scenes.length) {
      const segs = segments.length > 0
        ? segments
        : [{ start: 0, end: duration, text: transcript || '精彩内容' }];
      const chunkSize = Math.max(1, Math.ceil(segs.length / sceneCount));
      const layouts = ['question', 'burst', 'tags', 'stats'] as const;
      for (let i = 0; i < segs.length; i += chunkSize) {
        const sl = segs.slice(i, i + chunkSize);
        const isLast = i + chunkSize >= segs.length;
        const text = sl.map((s) => s.text).join(' ');
        scenes.push({
          start: sl[0].start,
          duration: Math.max(sl[sl.length - 1].end - sl[0].start, 3),
          layout: isLast ? 'finale' : layouts[scenes.length % layouts.length],
          eyebrow: `SCENE ${String(scenes.length + 1).padStart(2, '0')}`,
          title: text.slice(0, 10),
          body: text.slice(0, 25),
          tags: text.split(/[，,。！？\s]+/).filter((w) => w.length >= 2 && w.length <= 5).slice(0, 4),
        });
      }
      if (!scenes.length) {
        scenes = [{ start: 0, duration, layout: 'question', eyebrow: 'SCENE 01', title: '精彩内容', body: transcript.slice(0, 25) || '精彩视频内容', tags: [] }];
      }
    }

    const gsapJs = await gsapInline();
    const html = _buildCompositionHtml({ scenes, gsapJs, spec, duration });
    res.json({ html, aspect: spec.aspect, width: spec.width, height: spec.height, phoneRect: spec.phoneRect ?? null });
  } catch (err) { next(err); }
}

type SceneItem = { start: number; duration: number; layout: string; eyebrow: string; title: string; body: string; tags?: string[] };

interface _BuildHtmlParams {
  scenes: SceneItem[];
  gsapJs: string;
  spec: TemplateSpec;
  duration: number;
}

export function _esc(s: string): string {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function _buildCompositionHtml(p: _BuildHtmlParams): string {
  const { scenes, gsapJs, spec, duration } = p;
  const { width, height, phoneRect } = spec;
  const ACCENT = '#818cf8';
  const BG = '#08091a';
  const BP = 18; // bezel padding

  // Content panel: space opposite the phone
  const panel = (() => {
    if (!phoneRect) return { x: 60, y: 60, w: width - 120, h: height - 120 };
    if (spec.aspect === '9:16') {
      // Below phone for portrait
      const yStart = phoneRect.y + phoneRect.h + BP + 24;
      return { x: 40, y: yStart, w: width - 80, h: height - yStart - 40 };
    }
    const phoneCenterX = phoneRect.x + phoneRect.w / 2;
    if (phoneCenterX < width / 2) {
      // Phone left → content right
      const xStart = phoneRect.x + phoneRect.w + 56;
      return { x: xStart, y: 40, w: width - xStart - 40, h: height - 80 };
    }
    // Phone right → content left
    return { x: 40, y: 40, w: phoneRect.x - 80, h: height - 80 };
  })();

  const port = spec.aspect === '9:16';
  const fs = (s: number, l: number) => port ? s : l;

  const sceneDivs = scenes.map((s, i) => {
    const tags = (s.tags || []).map((t) => `<span class="tag">${_esc(t)}</span>`).join('');
    let inner: string;
    if (s.layout === 'burst') {
      inner = `<div class="eyebrow">${_esc(s.eyebrow)}</div>
<div class="burst-num">${_esc(s.title)}</div>
${s.body ? `<div class="body">${_esc(s.body)}</div>` : ''}
${tags ? `<div class="tags">${tags}</div>` : ''}`;
    } else if (s.layout === 'question') {
      inner = `<div class="eyebrow">${_esc(s.eyebrow)}</div>
<div class="qtext">${_esc(s.title)}</div>
${s.body ? `<div class="body">${_esc(s.body)}</div>` : ''}`;
    } else {
      inner = `<div class="eyebrow">${_esc(s.eyebrow)}</div>
<div class="title">${_esc(s.title)}</div>
${s.body ? `<div class="body">${_esc(s.body)}</div>` : ''}
${tags ? `<div class="tags">${tags}</div>` : ''}`;
    }
    return `<div class="scene" id="scene-${i}">${inner}</div>`;
  }).join('\n');

  const sceneData = JSON.stringify(scenes.map((s) => ({
    t: s.start, d: s.duration, lay: s.layout,
    hasBody: !!s.body, hasTags: !!(s.tags && s.tags.length),
  })));

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.cn/css2?family=Noto+Sans+SC:wght@300;400;500;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${width}px;height:${height}px;overflow:hidden;background:${BG}}
#root{
  position:relative;width:${width}px;height:${height}px;overflow:hidden;
  background:radial-gradient(ellipse at 20% 50%,#0d0f2a 0%,${BG} 60%);
  font-family:'Noto Sans SC',system-ui,sans-serif;
}
#root::before{
  content:'';position:absolute;inset:0;z-index:0;
  background-image:linear-gradient(rgba(129,140,248,.04) 1px,transparent 1px),
    linear-gradient(90deg,rgba(129,140,248,.04) 1px,transparent 1px);
  background-size:80px 80px;
}
${phoneRect ? `.ph-bezel{
  position:absolute;z-index:1;
  left:${phoneRect.x - BP}px;top:${phoneRect.y - BP}px;
  width:${phoneRect.w + BP * 2}px;height:${phoneRect.h + BP * 2}px;
  border-radius:${30 + BP}px;
  background:linear-gradient(160deg,#1c1c28 0%,#0e0e18 100%);
  box-shadow:0 24px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.05) inset,0 2px 0 rgba(255,255,255,.08) inset;
}
.ph-island{
  position:absolute;z-index:3;
  left:${phoneRect.x + Math.round(phoneRect.w / 2) - 45}px;top:${phoneRect.y + 10}px;
  width:90px;height:26px;border-radius:14px;background:#000;
}
.ph-screen{
  position:absolute;z-index:2;
  left:${phoneRect.x}px;top:${phoneRect.y}px;
  width:${phoneRect.w}px;height:${phoneRect.h}px;
  background:#000;border-radius:8px;
}` : ''}
.content{
  position:absolute;z-index:4;
  left:${panel.x}px;top:${panel.y}px;
  width:${panel.w}px;height:${panel.h}px;
  overflow:hidden;
}
.scene{
  position:absolute;inset:0;opacity:0;pointer-events:none;
  display:flex;flex-direction:column;justify-content:center;
  padding:${port ? '20px 24px' : '44px 40px'};gap:${port ? '10px' : '18px'};
}
.eyebrow{
  font-family:'JetBrains Mono',monospace;
  font-size:${fs(13, 15)}px;font-weight:500;letter-spacing:.12em;
  color:${ACCENT};text-transform:uppercase;
}
.eyebrow::before{content:'— '}
.title{font-size:${fs(26, 40)}px;font-weight:700;line-height:1.28;color:#fff}
.burst-num{
  font-size:${fs(52, 80)}px;font-weight:900;line-height:1;
  background:linear-gradient(135deg,#fff 0%,${ACCENT} 100%);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;
}
.qtext{font-size:${fs(30, 50)}px;font-weight:700;line-height:1.32;color:#fff}
.body{font-size:${fs(13, 19)}px;line-height:1.65;color:rgba(255,255,255,.75)}
.tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:3px}
.tag{
  padding:${port ? '4px 10px' : '5px 13px'};border-radius:20px;
  background:rgba(129,140,248,.15);border:1px solid rgba(129,140,248,.35);
  color:${ACCENT};font-size:${fs(11, 14)}px;font-weight:500;
}
</style>
</head>
<body>
<div id="root"
  data-composition-id="template-comp"
  data-start="0"
  data-duration="${duration}"
  data-width="${width}"
  data-height="${height}">
  ${phoneRect ? `<div class="ph-bezel"></div>
  <div class="ph-island"></div>
  <div class="ph-screen"></div>` : ''}
  <div class="content">
    ${sceneDivs}
  </div>
</div>
<script>${gsapJs}</script>
<script>
(function(){
var S=${sceneData};
var D=${duration};
var tl=gsap.timeline({paused:true});
for(var i=0;i<S.length;i++) gsap.set('#scene-'+i,{opacity:0});
S.forEach(function(s,i){
  var sel='#scene-'+i;
  var t=s.t,d=s.d;
  tl.to(sel,{opacity:1,duration:0},t);
  tl.from(sel+' .eyebrow',{opacity:0,letterSpacing:'1.4em',duration:.18,ease:'power4.out'},t+.04);
  if(s.lay==='burst'){
    tl.from(sel+' .burst-num',{scale:.3,opacity:0,duration:.40,ease:'back.out(2.5)'},t+.12);
  } else if(s.lay==='question'){
    tl.from(sel+' .qtext',{y:24,opacity:0,duration:.32,ease:'expo.out'},t+.12);
  } else {
    tl.from(sel+' .title',{x:-20,opacity:0,duration:.22,ease:'expo.out'},t+.14);
  }
  if(s.hasBody) tl.from(sel+' .body',{y:8,opacity:0,duration:.24,ease:'power2.out'},t+.30);
  if(s.hasTags) tl.from(sel+' .tag',{opacity:0,scale:.75,duration:.16,stagger:.05,ease:'back.out(1.5)'},t+.38);
  if(i<S.length-1&&t+d-.25>t) tl.to(sel,{opacity:0,duration:.20,ease:'power2.in'},t+d-.25);
});
tl.to({},{duration:.001},D-.001);
window.__timelines=window.__timelines||{};
window.__timelines['template-comp']=tl;
window.__hf={duration:D,seek:function(t){tl.seek(t,false);}};
})();
</script>
</body>
</html>`;
}
