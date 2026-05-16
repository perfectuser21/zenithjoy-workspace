import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import https from 'https';
import { AiVideoPipelineService } from '../services/ai-video-pipeline.service';

const svc = new AiVideoPipelineService();
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || '';
const PIAPI_KEY = process.env.PIAPI_API_KEY || '';

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

    const audioB64 = fs.readFileSync(audioFile.path).toString('base64');
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

    const result = await postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' },
      {
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      },
    ) as { content?: { text?: string }[] };

    const raw = result?.content?.[0]?.text ?? '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.status(500).json({ error: 'Claude returned invalid JSON' });

    const parsed = JSON.parse(jsonMatch[0]) as { scenes: unknown[] };
    res.json(parsed);
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
<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"></script>
<script>
const tl = gsap.timeline({paused:true});
window.__timelines = window.__timelines || {};
window.__timelines['pipeline-job'] = tl;
${tlEntries}
</script>
</body>
</html>`;

    res.json({ html });
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
