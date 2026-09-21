// apps/api/src/services/tts-volcengine.ts
//
// 批量混剪配音刀（GP line05/batch_mashup#step4）：火山引擎 TTS 服务封装。
//
// 现有批量混剪链路（mashup-render-ffmpeg.ts）目前是哑片——本模块只负责把一段
// 文案变成一份落地的 mp3 + 逐字时间戳，供上层（渲染/字幕拼装）消费，不碰
// mashup-render*.ts 本身。
//
// 凭据来自 1Password CS vault「Volcengine Speech (豆包实时语音对话)」，字段
// app_id/access_key；实测无需另外开通，走 https://openspeech.bytedance.com/api/v1/tts。
// Authorization 头是火山的特殊写法："Bearer; <access_key>"（注意分号+空格）。
//
// 网关类错误退避重试的分寸对齐 content-judgment.ts 的 postToapisWithRetry
// （2026-09-21 issue f3b6ba7c 教训）：只重试网关自己崩了的瞬时错误
// （ECONNABORTED / 502/503/504/520-524），4xx 一律不重试——那是确定性故障，
// 重试没用还会掩盖真问题。

import axios from 'axios';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface TtsWord {
  word: string;
  startMs: number;
  endMs: number;
}

export interface TtsResult {
  /** 落地的 mp3 文件路径（调用方用完负责清理，参照 mashup-render.ts 的 tempFiles 惯例） */
  audioPath: string;
  durationMs: number;
  words: TtsWord[];
}

export interface SynthesizeOptions {
  /** 音色，缺省 BV001_streaming（实测通路） */
  voiceType?: string;
  /** 火山 user.uid，缺省任意固定标识，与业务身份无关 */
  uid?: string;
}

/** 火山 TTS 调用失败的统一错误类型——code 可能是火山返回的业务 code，也可能是本模块自定义的本地原因字符串。 */
export class VolcengineTtsError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'VolcengineTtsError';
    this.code = code;
  }
}

interface VolcengineFrontendWordRaw {
  word?: unknown;
  start_time?: unknown;
  end_time?: unknown;
}

interface VolcengineTtsResponseBody {
  code: number;
  message?: string;
  data?: string;
  addition?: {
    duration?: string | number;
    frontend?: string;
  };
}

const VOLCENGINE_TTS_URL = process.env.VOLCENGINE_TTS_BASE_URL || 'https://openspeech.bytedance.com/api/v1/tts';
const DEFAULT_VOICE_TYPE = 'BV001_streaming';
const DEFAULT_UID = 'zenithjoy-mashup';
const TTS_TIMEOUT_MS = 30_000;
// 带完整文案的合成比纯文本判定更慢，多给一次重试余量（同 content-judgment 的 JUDGMENT_ATTEMPTS 量级）。
const TTS_ATTEMPTS = 3;

/** 网关类瞬时错误——只有这些才值得重试，口径同 content-judgment.ts（issue f3b6ba7c）。 */
const RETRYABLE_GATEWAY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);

/** 退避基数，测试里调小；生产默认 1s，第二次等 1s、第三次等 2s。 */
function retryBaseMs(): number {
  const v = Number(process.env.VOLCENGINE_TTS_RETRY_BASE_MS);
  return Number.isFinite(v) && v > 0 ? v : 1000;
}

/**
 * 判定用 err.isAxiosError 属性而不是 axios.isAxiosError()：
 * 单测里 vi.mock('axios') 会把整个模块替换成 mock，用它判会恒 false，
 * 重试逻辑就永远测不到（同 content-judgment.ts 的教训）。
 */
function isRetryableError(err: unknown): boolean {
  const e = err as { isAxiosError?: boolean; code?: string; response?: { status?: number } };
  if (!e?.isAxiosError) return false;
  if (e.code === 'ECONNABORTED') return true; // 超时
  const status = e.response?.status;
  if (status === undefined) return true; // 连接层失败（无响应）
  return RETRYABLE_GATEWAY_STATUS.has(status);
}

async function postWithRetry(
  body: unknown,
  headers: Record<string, string>,
): Promise<{ data: VolcengineTtsResponseBody }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return (await axios.post(VOLCENGINE_TTS_URL, body, { headers, timeout: TTS_TIMEOUT_MS })) as {
        data: VolcengineTtsResponseBody;
      };
    } catch (err) {
      if (attempt >= TTS_ATTEMPTS || !isRetryableError(err)) throw err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      const waitMs = retryBaseMs() * 2 ** (attempt - 1);
      console.warn(
        '[tts-volcengine] 第 %d 次调用失败（status=%s code=%s），%dms 后重试',
        attempt,
        status ?? '-',
        (err as { code?: string })?.code ?? '-',
        waitMs,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

/**
 * 把火山 addition.frontend（JSON 字符串）解析成稳定契约的逐字时间戳数组。
 * 字段缺失/非法 JSON/结构不对都不抛异常——降级为空数组，不阻断整段配音落地
 * （字幕这一层没有逐字时间戳仍可退化成整句字幕，好过因为解析失败整条链路裸崩）。
 */
function parseWords(frontendRaw: string | undefined): TtsWord[] {
  if (!frontendRaw) return [];
  let parsed: { words?: VolcengineFrontendWordRaw[] };
  try {
    parsed = JSON.parse(frontendRaw) as { words?: VolcengineFrontendWordRaw[] };
  } catch (err) {
    console.error('[tts-volcengine] addition.frontend 解析失败（非法 JSON）：', (err as Error).message);
    return [];
  }
  if (!Array.isArray(parsed.words)) return [];
  const words: TtsWord[] = [];
  for (const w of parsed.words) {
    if (typeof w.word === 'string' && typeof w.start_time === 'number' && typeof w.end_time === 'number') {
      words.push({ word: w.word, startMs: w.start_time, endMs: w.end_time });
    }
  }
  return words;
}

/**
 * 文案 → 配音 mp3（落地文件）+ 归一化逐字时间戳。
 *
 * 缺凭据（VOLCENGINE_TTS_APP_ID/VOLCENGINE_TTS_ACCESS_KEY 任一未配置）：
 * 直接抛 VolcengineTtsError('missing_credentials', ...)，不静默降级——本服务
 * 没有自己的 DB 状态位可以落"pending/failed"，调用方（渲染层）自行决定怎么兜底。
 */
export async function synthesize(text: string, opts: SynthesizeOptions = {}): Promise<TtsResult> {
  const appId = process.env.VOLCENGINE_TTS_APP_ID;
  const accessKey = process.env.VOLCENGINE_TTS_ACCESS_KEY;
  if (!appId || !accessKey) {
    throw new VolcengineTtsError(
      'missing_credentials',
      'VOLCENGINE_TTS_APP_ID/VOLCENGINE_TTS_ACCESS_KEY 未配置，无法调用火山 TTS',
    );
  }

  const body = {
    app: { appid: appId, token: accessKey, cluster: 'volcano_tts' },
    user: { uid: opts.uid ?? DEFAULT_UID },
    audio: { voice_type: opts.voiceType ?? DEFAULT_VOICE_TYPE, encoding: 'mp3' },
    request: {
      reqid: randomUUID(),
      text,
      operation: 'query',
      with_frontend: 1,
      frontend_type: 'unitTson',
      with_timestamp: 1,
    },
  };

  let resp: { data: VolcengineTtsResponseBody };
  try {
    resp = await postWithRetry(body, {
      // 注意："Bearer;" 后有分号和空格——这是火山的特殊写法，不是笔误。
      Authorization: `Bearer; ${accessKey}`,
      'Content-Type': 'application/json',
    });
  } catch (err) {
    const isTimeout = axios.isAxiosError(err) && err.code === 'ECONNABORTED';
    const reason = isTimeout ? 'timeout' : 'network_error';
    console.error(`[tts-volcengine] 请求失败 reason=${reason}:`, (err as Error).message);
    throw new VolcengineTtsError(reason, `火山 TTS 请求失败（${reason}）：${(err as Error).message}`);
  }

  const payload = resp.data;
  if (!payload || payload.code !== 3000) {
    const code = String(payload?.code ?? 'unknown');
    const message = payload?.message || '火山 TTS 返回非成功 code';
    console.error(`[tts-volcengine] 合成失败 code=${code}:`, message);
    throw new VolcengineTtsError(code, message);
  }

  if (!payload.data) {
    throw new VolcengineTtsError('empty_audio', '火山 TTS 返回 code=3000 但 data（音频内容）为空');
  }

  const audioBuffer = Buffer.from(payload.data, 'base64');
  const audioPath = join(tmpdir(), `tts-volcengine-${randomUUID()}.mp3`);
  writeFileSync(audioPath, audioBuffer);

  const durationMs = Number(payload.addition?.duration ?? 0) || 0;
  const words = parseWords(payload.addition?.frontend);

  return { audioPath, durationMs, words };
}
