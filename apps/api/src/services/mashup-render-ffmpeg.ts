// apps/api/src/services/mashup-render-ffmpeg.ts
//
// 批量混剪 S4（GP f6f96e17）：多段素材合成高清成片的 ffmpeg 编排层。
//
// 输入素材分辨率/帧率不统一（客户自有素材），先各自 scale+setsar+fps 对齐，
// 再用 filter_complex concat 拼接——比 concat demuxer 更稳，不要求输入编码
// 参数完全一致。输出定死 1920x1080（对齐 proposal-v2.md A2 断言）。
//
// 音轨（字幕/音乐叠加）本版不做——【挂片】已标注"字幕音乐叠加(缺失)"，
// 这层只交付"多段素材合成高清成片"的核心编排，输出用 -an 明确声明无音轨，
// 不是遗漏。

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';

const OUTPUT_WIDTH = 1920;
const OUTPUT_HEIGHT = 1080;
const OUTPUT_FPS = 30;

export interface ConcatAndScaleOptions {
  width?: number;
  height?: number;
  fps?: number;
  /** ffmpeg -preset（如 'ultrafast'）：轻量预览用更快档位换编码速度，牺牲压缩率，可接受——预览不是最终交付物。 */
  preset?: string;
  /** ffmpeg -crf：数值越大画质越低/文件越小，轻量预览用高 crf 换更快编码与更小体积。 */
  crf?: number;
}

/** 拼接多段素材并统一缩放（默认 1920x1080，终版成片档）。成功返回 true，任何失败返回 false，不抛异常。 */
export function concatAndScale(inputPaths: string[], outputPath: string, opts: ConcatAndScaleOptions = {}): boolean {
  if (inputPaths.length === 0) return false;
  if (inputPaths.some((p) => !existsSync(p))) return false;

  const width = opts.width ?? OUTPUT_WIDTH;
  const height = opts.height ?? OUTPUT_HEIGHT;
  const fps = opts.fps ?? OUTPUT_FPS;

  const args: string[] = [];
  for (const p of inputPaths) args.push('-i', p);

  const perInputFilters = inputPaths
    .map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps}[v${i}]`)
    .join(';');
  const concatInputs = inputPaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${perInputFilters};${concatInputs}concat=n=${inputPaths.length}:v=1:a=0[outv]`;

  const encodeArgs: string[] = [];
  if (opts.preset) encodeArgs.push('-preset', opts.preset);
  if (opts.crf !== undefined) encodeArgs.push('-crf', String(opts.crf));

  const r = spawnSync('ffmpeg', [
    ...args,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    ...encodeArgs,
    '-an',
    '-y',
    outputPath,
  ]);

  return r.status === 0 && existsSync(outputPath);
}

// ─────────────────────────────────────────────────────────────────────────
// 批量混剪配音刀（GP line05/batch_mashup#step4）：renderMashupWithAudio
//
// concatAndScale 只做"多段素材合成高清成片"，无声画对齐、无字幕——批量混剪
// 剪出来的是横屏哑片，客户实际打开发现没法发抖音。本函数在其之上扩展：
//   1. 横竖屏可选（width/height 由调用方传入，不再写死）
//   2. 每段按 durationSec 用 trim+setpts 裁剪，做声画对齐的基础
//   3. 挂配音音轨（-map 音频输入 + -c:a aac），不传则保持无音轨（向后兼容）
//   4. 烧字幕（subtitles 滤镜，抖音带货字幕标准：底部约 1/4 处、黑描边白字）
//
// 不改 concatAndScale 本身——它已被 mashup-render.ts / mashup-preview-render.ts
// 使用且有真跑 ffmpeg 的既有单测锁住行为，新增独立函数避免动它们的地盘。
// ─────────────────────────────────────────────────────────────────────────

export interface MashupSegment {
  path: string;
  /** 该片段保留的时长（秒）。不传则不裁剪，使用素材原始时长（向后兼容旧行为）。 */
  durationSec?: number;
}

export interface RenderMashupWithAudioOptions {
  width?: number;
  height?: number;
  fps?: number;
  preset?: string;
  crf?: number;
  /** 配音音频文件路径（如火山引擎 TTS 产出的 mp3）。不传则输出无音轨。 */
  audioPath?: string;
  /** 字幕 srt 文件路径。不传则不烧字幕。 */
  srtPath?: string;
}

/**
 * ffmpeg subtitles 滤镜的 filename 参数转义：该参数位于 filter_complex 里（用 ':' 分隔
 * filename 与 options、用 ',' 分隔链上多个滤镜、用 '\' 做转义符），必须转义反斜杠/单引号/
 * 冒号并整体用单引号包裹，否则路径里的冒号会被误判成 filename:options 的分隔符。
 */
function escapeSubtitlesPath(p: string): string {
  return p.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:');
}

/**
 * force_style 是 'K1=V1,K2=V2,...' 形态，但这条字符串本身嵌在 filter_complex 的滤镜链
 * 里——filter_complex 顶层同样用逗号分隔"链上下一个滤镜"，两层语法的逗号语义冲突。
 * 生产实测已证实（P0 issue 357861c4 关联问题）：不转义时 ffmpeg 会把 force_style 内部
 * 逗号后的内容解析成下一个滤镜，轻则语法报错、重则静默丢弃部分样式。转义成 '\,' 后交给
 * ffmpeg 的 filtergraph 解析器，它会先按 '\,' 还原出字面逗号再交给 subtitles 滤镜自己的
 * force_style 解析器切分 K=V 对。
 */
export function escapeForceStyleCommas(style: string): string {
  // 顺序不能反：必须先转义反斜杠本身，再转义逗号。
  // 先转逗号的话，新插入的那个反斜杠会被后一步再转一次，解析出来对不上
  // （CodeQL js/incomplete-sanitization 在 PR#1931 抓到的就是漏了反斜杠这一步）。
  return style.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

/** 抖音带货字幕标准：画面下方约 1/4 处、黑色粗描边 + 白字、字号随分辨率按比例缩放。 */
function buildSubtitleForceStyle(height: number): string {
  const fontSize = Math.max(24, Math.round(height * 0.035));
  const outline = Math.max(2, Math.round(height / 240));
  const marginV = Math.round(height * 0.25);
  const raw = [
    'Fontname=Noto Sans CJK SC',
    `FontSize=${fontSize}`,
    'PrimaryColour=&H00FFFFFF', // ASS &HAABBGGRR：不透明白字
    'OutlineColour=&H00000000', // 不透明黑描边
    'BorderStyle=1',
    `Outline=${outline}`,
    'Shadow=0',
    'Alignment=2', // 底部居中
    `MarginV=${marginV}`,
  ].join(',');
  return escapeForceStyleCommas(raw);
}

/**
 * 多段素材合成成片：横竖屏可选 + 每段可裁剪时长 + 可挂配音音轨 + 可烧字幕。
 * 成功返回 true，任何失败返回 false，不抛异常（同 concatAndScale 口径）。
 */
export function renderMashupWithAudio(
  segments: MashupSegment[],
  outputPath: string,
  opts: RenderMashupWithAudioOptions = {},
): boolean {
  if (segments.length === 0) return false;
  if (segments.some((s) => !existsSync(s.path))) return false;
  if (opts.audioPath && !existsSync(opts.audioPath)) return false;
  if (opts.srtPath && !existsSync(opts.srtPath)) return false;

  const width = opts.width ?? OUTPUT_WIDTH;
  const height = opts.height ?? OUTPUT_HEIGHT;
  const fps = opts.fps ?? OUTPUT_FPS;

  const args: string[] = [];
  for (const seg of segments) args.push('-i', seg.path);
  const audioInputIndex = segments.length;
  if (opts.audioPath) args.push('-i', opts.audioPath);

  const perInputFilters = segments
    .map((seg, i) => {
      const chain: string[] = [];
      if (seg.durationSec !== undefined) chain.push(`trim=0:${seg.durationSec}`, 'setpts=PTS-STARTPTS');
      chain.push(
        `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        'setsar=1',
        `fps=${fps}`,
      );
      return `[${i}:v]${chain.join(',')}[v${i}]`;
    })
    .join(';');
  const concatInputs = segments.map((_, i) => `[v${i}]`).join('');
  const concatStage = `${concatInputs}concat=n=${segments.length}:v=1:a=0[cat]`;

  let finalLabel = 'cat';
  let subtitleStage = '';
  if (opts.srtPath) {
    const escapedPath = escapeSubtitlesPath(opts.srtPath);
    const forceStyle = buildSubtitleForceStyle(height);
    subtitleStage = `;[cat]subtitles=filename='${escapedPath}':force_style='${forceStyle}'[outv]`;
    finalLabel = 'outv';
  }

  const filterComplex = `${perInputFilters};${concatStage}${subtitleStage}`;

  const encodeArgs: string[] = [];
  if (opts.preset) encodeArgs.push('-preset', opts.preset);
  if (opts.crf !== undefined) encodeArgs.push('-crf', String(opts.crf));

  const audioArgs: string[] = opts.audioPath
    ? ['-map', `${audioInputIndex}:a`, '-c:a', 'aac', '-b:a', '128k', '-shortest']
    : ['-an'];

  const r = spawnSync('ffmpeg', [
    ...args,
    '-filter_complex', filterComplex,
    '-map', `[${finalLabel}]`,
    ...audioArgs,
    ...encodeArgs,
    '-y',
    outputPath,
  ]);

  return r.status === 0 && existsSync(outputPath);
}
