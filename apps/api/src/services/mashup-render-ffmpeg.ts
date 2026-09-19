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

/** 拼接多段素材并统一缩放到 1920x1080。成功返回 true，任何失败返回 false，不抛异常。 */
export function concatAndScale(inputPaths: string[], outputPath: string): boolean {
  if (inputPaths.length === 0) return false;
  if (inputPaths.some((p) => !existsSync(p))) return false;

  const args: string[] = [];
  for (const p of inputPaths) args.push('-i', p);

  const perInputFilters = inputPaths
    .map((_, i) => `[${i}:v]scale=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:force_original_aspect_ratio=decrease,pad=${OUTPUT_WIDTH}:${OUTPUT_HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${OUTPUT_FPS}[v${i}]`)
    .join(';');
  const concatInputs = inputPaths.map((_, i) => `[v${i}]`).join('');
  const filterComplex = `${perInputFilters};${concatInputs}concat=n=${inputPaths.length}:v=1:a=0[outv]`;

  const r = spawnSync('ffmpeg', [
    ...args,
    '-filter_complex', filterComplex,
    '-map', '[outv]',
    '-an',
    '-y',
    outputPath,
  ]);

  return r.status === 0 && existsSync(outputPath);
}
