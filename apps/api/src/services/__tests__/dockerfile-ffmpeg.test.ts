import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * 真机复现（2026-09-19）：用户真实账号点"选这个，渲染成片"，得到"内容安全审核
 * 处理中/暂时失败"。数据库里 safety_check_status/watermark_check_status 都是
 * failed_pending_review（不是具体的 flagged），说明根本没跑到 Gemini 审核那一步。
 *
 * 根因：apps/api/Dockerfile 自 PR #1872/#1874 换 node:20-bookworm-slim 基础镜像
 * （onnxruntime glibc 修复）起，运行时阶段只装了 tzdata，从未装过 ffmpeg。
 * mashup-render-ffmpeg.ts 的 concatAndScale() 用 spawnSync('ffmpeg', ...)——
 * 找不到可执行文件时 spawnSync 不抛异常（status=null），concatAndScale 按"合成
 * 失败"静默返回 false，上层 fail-closed 成 failed_pending_review，界面文案让人
 * 误以为是内容审核问题。批量混剪 S4 这条链路自合并以来在真实部署环境里从未跑通过。
 */
describe('Dockerfile 生产镜像必须装 ffmpeg', () => {
  it('生产阶段（第二个 FROM 之后）的 apt-get install 含 ffmpeg', () => {
    const dockerfilePath = resolve(__dirname, '../../../Dockerfile');
    const content = readFileSync(dockerfilePath, 'utf-8');

    const fromLines = [...content.matchAll(/^FROM .+$/gm)];
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    const prodStageStart = fromLines[fromLines.length - 1].index ?? 0;
    const prodStage = content.slice(prodStageStart);

    expect(prodStage).toMatch(/apt-get install[^\n]*\bffmpeg\b/);
  });
});
