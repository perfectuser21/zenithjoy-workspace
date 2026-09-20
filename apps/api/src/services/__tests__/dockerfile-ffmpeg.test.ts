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
 * 根因（一）：apps/api/Dockerfile 自 PR #1872/#1874 换 node:20-bookworm-slim
 * 基础镜像（onnxruntime glibc 修复）起，运行时阶段只装了 tzdata，从未装过 ffmpeg。
 * mashup-render-ffmpeg.ts 的 concatAndScale() 用 spawnSync('ffmpeg', ...)——
 * 找不到可执行文件时 spawnSync 不抛异常（status=null），concatAndScale 按"合成
 * 失败"静默返回 false，上层 fail-closed 成 failed_pending_review，界面文案让人
 * 误以为是内容审核问题。批量混剪 S4 这条链路自合并以来在真实部署环境里从未跑通过。
 *
 * 根因（二，PR #1878 首次修复方式的后续问题）：补 `apt-get install ffmpeg` 后
 * 真机部署，Debian 把 ffmpeg 完整依赖树（libaom/libx264/libx265/pango/cairo/
 * librsvg/X11 等约 70+ 个包，含大量我们用不到的桌面/GUI 编解码器）一起拉下来，
 * hk-vps 到 deb.debian.org 官方源速度奇慢，部署 15+ 分钟仍未装完，buildkit RPC
 * 超时中断，部署失败。改用社区维护的静态编译 ffmpeg 镜像（mwader/static-ffmpeg）
 * 多阶段 COPY 两个二进制，不再依赖 apt 源。
 */
describe('Dockerfile 生产镜像必须有可用的 ffmpeg/ffprobe', () => {
  it('生产阶段（最后一个 FROM 之后）从静态 ffmpeg 镜像 COPY 出 ffmpeg + ffprobe 二进制', () => {
    const dockerfilePath = resolve(__dirname, '../../../Dockerfile');
    const content = readFileSync(dockerfilePath, 'utf-8');

    const fromLines = [...content.matchAll(/^FROM .+$/gm)];
    expect(fromLines.length).toBeGreaterThanOrEqual(2);
    const prodStageStart = fromLines[fromLines.length - 1].index ?? 0;
    const prodStage = content.slice(prodStageStart);

    // 不再要求 apt-get install ffmpeg（那条路径在真机部署时因 apt 源过慢超时失败）——
    // 断言用多阶段 COPY 静态二进制的方式装 ffmpeg + ffprobe，落到 PATH 能找到的目录。
    expect(prodStage).toMatch(/COPY\s+--from=\S+\s+\/ffmpeg\s+\/usr\/local\/bin\/ffmpeg/);
    expect(prodStage).toMatch(/COPY\s+--from=\S+\s+\/ffprobe\s+\/usr\/local\/bin\/ffprobe/);

    // 且该 --from 引用的阶段必须真的存在（不能引用一个拼错名字的不存在阶段）
    const stageNameMatch = prodStage.match(/COPY\s+--from=(\S+)\s+\/ffmpeg/);
    expect(stageNameMatch).not.toBeNull();
    const stageName = stageNameMatch![1];
    expect(content).toMatch(new RegExp(`^FROM\\s+\\S+\\s+AS\\s+${stageName}\\s*$`, 'm'));
  });
});
