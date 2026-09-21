import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 回归测试（P0 issue 357861c4）：生产容器有 subtitles 滤镜但没有字体，真机实测：
 *   ffmpeg -vf "subtitles=sub.srt:force_style=FontSize=16"
 *   → Fontconfig error: Cannot load default config file
 *   → Failed to load fontconfig fonts!
 *   → 退出码 0、文件正常生成、但字节数与不烧字幕完全一致（5114 vs 5114）
 *   → fc-list | wc -l = 0
 * 这是静默失效：ffmpeg 报成功、文件存在、单测（mock spawnSync）会全绿，但字幕
 * 一个字都没画上。断言生产阶段镜像装了 fontconfig + 中文字体包，防止再次漏装。
 */
describe('Dockerfile 生产镜像必须装字体（批量混剪字幕烧录依赖）', () => {
  it('生产阶段（最后一个 FROM 之后）装了 fontconfig + 中文字体包', () => {
    const dockerfilePath = resolve(__dirname, '../../../Dockerfile');
    const content = readFileSync(dockerfilePath, 'utf-8');

    const fromLines = [...content.matchAll(/^FROM .+$/gm)];
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    const prodStageStart = fromLines[fromLines.length - 1].index ?? 0;
    const prodStage = content.slice(prodStageStart);

    expect(prodStage).toMatch(/apt-get install[^\n]*\bfontconfig\b/);
    // 中文字体包：不要求具体是哪一个，但必须是能被 fontconfig 注册的 fonts-* 包
    // （不能只装 fontconfig 库不装字体文件，那样 fc-list 依然是 0 条）。
    expect(prodStage).toMatch(/apt-get install[^\n]*\bfonts-[a-z0-9-]+/);

    // 装完必须刷新 fontconfig 缓存，否则同一层里紧接着的自检/smoke 可能读到旧缓存。
    expect(prodStage).toMatch(/fc-cache/);
  });
});
