// apps/api/src/services/mashup-preview-render.ts
//
// 批量混剪加厚（GP line05/batch_mashup step3）：候选真实轻量预览渲染叶子。
//
// 与终版 mashup-render.ts 的区别（决策 623a81d7 纠偏 d6bedf80）：
//   - 不跑内容安全/水印 Gemini 审核（预览不是可下载交付物，不需要 fail-closed 门禁）
//   - 不写 zenithjoy.contents（预览不是一条"作品"，只是给候选卡片播放用）
//   - ffmpeg 用更快/更小档位（480p + ultrafast + 高 crf），牺牲画质换秒开体验
//   - 产物落独立的 storage 前缀 mashup-previews/，与终版 mashup-exports/ 不混
//
// 复用 resolveOrderedMaterials（与终版共享候选→素材解析逻辑，避免两条渲染路径
// 对"槽位怎么排列成素材列表"这件事各自维护一份、随时间走样）。

import { randomUUID } from 'crypto';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { MaterialStorage } from './material-storage';
import { concatAndScale } from './mashup-render-ffmpeg';
import { resolveOrderedMaterials, type RenderCandidateInput } from './mashup-render';

export interface RenderPreviewDeps {
  storage: MaterialStorage;
}

export interface RenderPreviewResult {
  previewUrl?: string;
}

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const PREVIEW_FPS = 24;
const PREVIEW_PRESET = 'ultrafast';
const PREVIEW_CRF = 32;

export async function renderPreview(
  input: RenderCandidateInput,
  deps: RenderPreviewDeps,
): Promise<RenderPreviewResult> {
  const orderedMaterials = await resolveOrderedMaterials(input);

  const workDir = tmpdir();
  const tempFiles: string[] = [];
  const outputPath = join(workDir, `mashup-preview-${randomUUID()}.mp4`);
  tempFiles.push(outputPath);

  try {
    const inputPaths: string[] = [];
    for (const material of orderedMaterials) {
      try {
        const signedUrl = await deps.storage.getSignedUrl(material.storageKey);
        const resp = await fetch(signedUrl);
        if (!resp.ok) continue;
        const buffer = Buffer.from(await resp.arrayBuffer());
        const tempPath = join(workDir, `mashup-preview-in-${randomUUID()}.mp4`);
        writeFileSync(tempPath, buffer);
        tempFiles.push(tempPath);
        inputPaths.push(tempPath);
      } catch (err) {
        console.error('[mashup-preview-render] 素材下载失败 materialId=%s reason=%s', material.id, (err as Error).message);
      }
    }

    const rendered = inputPaths.length > 0 && concatAndScale(inputPaths, outputPath, {
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
      fps: PREVIEW_FPS,
      preset: PREVIEW_PRESET,
      crf: PREVIEW_CRF,
    });
    if (!rendered || !existsSync(outputPath)) {
      return {};
    }

    const storageKey = `mashup-previews/${input.tenantId}/${input.candidateId}.mp4`;
    await deps.storage.putObject({ key: storageKey, filePath: outputPath, contentType: 'video/mp4' });
    const previewUrl = await deps.storage.getSignedUrl(storageKey);
    return { previewUrl };
  } finally {
    for (const f of tempFiles) {
      try { unlinkSync(f); } catch { /* ignore */ }
    }
  }
}
