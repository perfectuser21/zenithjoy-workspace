import { Request, Response } from 'express';
import { createReadStream, existsSync, statSync } from 'fs';
import { resolve, extname, sep } from 'path';
import pool from '../db/connection';
import { resolveTaskDirByPipelineId } from '../services/langgraph-adapter';

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

function isUnsafeFilename(name: string): boolean {
  if (!name) return true;
  if (name.includes('\0')) return true;
  if (name.includes('..')) return true;
  // 禁止子目录穿越：不允许 / 或 \，也不允许绝对路径
  if (name.includes('/') || name.includes('\\')) return true;
  return false;
}

function resolveSafe(baseDir: string, relPath: string): string | null {
  // 二次防护：resolve 后必须仍在 baseDir 内
  const normalizedBase = resolve(baseDir);
  const fullPath = resolve(normalizedBase, relPath);
  if (fullPath !== normalizedBase && !fullPath.startsWith(normalizedBase + sep)) {
    return null;
  }
  return fullPath;
}

export class ContentImagesController {
  // GET /api/content-images/:pipelineId/:filename
  serve = async (req: Request, res: Response): Promise<void> => {
    try {
      const { pipelineId, filename: rawFilename } = req.params;
      let decoded: string;
      try {
        decoded = decodeURIComponent(rawFilename);
      } catch {
        res.status(400).json({ error: 'invalid filename encoding' });
        return;
      }

      if (isUnsafeFilename(decoded)) {
        res.status(400).json({ error: 'invalid filename' });
        return;
      }

      const { rows } = await pool.query<{ output_dir: string | null }>(
        'SELECT output_dir FROM zenithjoy.pipeline_runs WHERE id = $1',
        [pipelineId]
      );
      const outputDir = rows[0]?.output_dir || null;

      // 收集候选 baseDir：先用 pipeline_runs.output_dir，再用 cecelia_events 里的实际任务目录兜底
      const baseDirs: string[] = [];
      if (outputDir) baseDirs.push(outputDir);
      const { taskDir: langGraphTaskDir } = await resolveTaskDirByPipelineId(pipelineId);
      if (langGraphTaskDir && !baseDirs.includes(langGraphTaskDir)) baseDirs.push(langGraphTaskDir);

      if (baseDirs.length === 0) {
        res.status(404).json({ error: 'pipeline not found' });
        return;
      }

      // 尝试多个候选路径（manifest 可能将图片放 cards/ 或 images/ 或根目录）
      let found: string | null = null;
      outer: for (const baseDir of baseDirs) {
        for (const rel of [`cards/${decoded}`, `images/${decoded}`, decoded]) {
          const full = resolveSafe(baseDir, rel);
          if (full && existsSync(full) && statSync(full).isFile()) {
            found = full;
            break outer;
          }
        }
      }

      if (!found) {
        // 不缓存 404 — 避免 Cloudflare 持有旧 404 影响后续正确响应
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        res.status(404).json({ error: 'image not found' });
        return;
      }

      const ext = extname(found).toLowerCase();
      const contentType = MIME_MAP[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      createReadStream(found).pipe(res);
    } catch (err) {
      console.error('[content-images] serve error:', err);
      res.status(500).json({ error: String(err) });
    }
  };
}
