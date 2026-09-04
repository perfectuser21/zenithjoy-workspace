// apps/api/src/routes/materials.ts
//
// 素材上传：所有入口唯一认识的地址。
//
// iPhone 快捷指令 / 小程序 / 电脑 agent 都打这一个端点，存储实现藏在背后。
// 这样只维护一个入口；存储今天用 COS 明天换别的，客户端一行不用改；
// COS 密钥只在服务端，永远不下发到客户端。
//
// ── 一次上传做三件事 ──────────────────────────────────────────────────
//   ① 每个文件插一条 materials（进素材池）
//   ② 建一条 contents（成组，传完就是一个作品，可以直接发）
//   ③ 插 N 条 content_materials 关联
// 于是「传完直接能发」和「素材以后能被混剪复用」两件事一次做完，
// 使用者不用做任何选择。混剪时从池子跨作品挑素材只是多插一条关联，
// 原作品一根汗毛不动。

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import pool from '../db/connection';
import { simpleRateLimit, ipKeyFn } from '../middleware/simple-rate-limit';
import { validateLicense } from '../services/walking-skeleton.service';
import {
  createMaterialStorage,
  type MaterialStorage,
} from '../services/material-storage';
import {
  inferContentType,
  buildDedupeKey,
  buildStorageKey,
  sanitizeFileName,
  MAX_FILE_BYTES,
  type UploadedFileMeta,
} from '../services/material-upload';

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

/**
 * 大文件必须落磁盘临时文件，不能进内存 —— 单文件上限 2GB，
 * multer.memoryStorage() 会把整个文件读进内存，一个请求就能把进程打爆。
 */
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(null, `zj-upload-${crypto.randomUUID()}-${sanitizeFileName(file.originalname)}`),
  }),
  limits: { fileSize: MAX_FILE_BYTES },
});

export interface MaterialsRouterDeps {
  storage?: MaterialStorage;
}

export function createMaterialsRouter(deps: MaterialsRouterDeps = {}): Router {
  const router = Router();
  const storage = deps.storage ?? createMaterialStorage();

  // CodeQL js/missing-rate-limiting：这个端点既写 DB 又写文件系统，不限流就是
  // 一个现成的 DoS 面——不停传大文件能把磁盘和连接池都吃光。
  // 限流放在鉴权之前（鉴权 handler 本身也要被限流覆盖，同 workers-executor）。
  // 60 次/分钟：iPhone 一次选几十张分批传够用，又挡得住脚本刷。
  //
  // ⚠️ 限流器必须在这里建一次、复用同一个实例。建在请求处理函数里等于每个请求
  // 都新建一个计数器，限流完全不生效（express-rate-limit 会直接报
  // ERR_ERL_CREATED_IN_REQUEST_HANDLER）。
  const uploadRateLimit = simpleRateLimit({ windowMs: 60_000, max: 60, keyFn: ipKeyFn });
  router.use(uploadRateLimit);

  router.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    try {
      // ── 1. 鉴权：租户永远从凭据反查，绝不信客户端自报的 tenant_id ──
      // 否则任何人填别人的 ID 就能把素材写进别人的库、也能拿到别人的素材 id。
      const token = extractUploadToken(req);
      if (!token) {
        return fail(res, 401, 'UNAUTHORIZED', '缺少上传凭据。请在请求头加 X-Upload-Token: <token>');
      }

      let licenseResult;
      try {
        licenseResult = await validateLicense(token);
      } catch (err) {
        return fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
      }
      if (!licenseResult.ok) {
        // INVALID_LICENSE = 认不出这张证 → 401；其余（REVOKED/SUSPENDED/EXPIRED/
        // NO_TENANT）= 认得出但不给用 → 403。与 worker-agent-auth 口径一致。
        const status = licenseResult.code === 'INVALID_LICENSE' ? 401 : 403;
        return fail(res, status, licenseResult.code, licenseResult.message);
      }
      const tenantId = licenseResult.license.tenant_id as string;

      // ── 2. 校验素材 ──
      if (files.length === 0) {
        return fail(res, 400, 'NO_FILES', '没有素材：一次上传至少要带一个文件');
      }
      const metas: UploadedFileMeta[] = files.map((f) => ({
        fileName: sanitizeFileName(f.originalname),
        mimeType: f.mimetype,
        sizeBytes: f.size,
      }));

      let contentType: string;
      try {
        contentType = inferContentType(metas);
      } catch (err) {
        // 类型冲突在入口就拒，绝不让它带到发布那一刻才炸
        return fail(res, 400, 'INVALID_MATERIAL_MIX', err instanceof Error ? err.message : 'unknown');
      }

      // ── 3. 逐个入库 + 上存储 ──
      // CodeQL js/type-confusion-through-parameter-tampering：multipart 的同名字段
      // 可能是字符串也可能是数组（客户端传一个 vs 传多个），下游必须拿到确定类型，
      // 不能让"有时是 string 有时是 array"的值流进业务逻辑。
      const takenAtList = normalizeTakenAt(toStringArray(req.body?.taken_at), files.length);
      const results: Array<{ id: string; file_name: string; deduped: boolean }> = [];

      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const meta = metas[i];
        const contentHash = await hashFile(f.path);
        const dedupeKey = buildDedupeKey({
          tenantId,
          fileName: meta.fileName,
          sizeBytes: meta.sizeBytes,
          takenAt: takenAtList[i],
          contentHash,
        });

        const materialId = crypto.randomUUID();
        const storageKey = buildStorageKey({ tenantId, materialId, fileName: meta.fileName });

        // ON CONFLICT DO NOTHING：命中唯一索引说明这个素材已经传过了。
        // 去重做在服务端而不是让客户端删相册——误删原片不可逆，而服务端去重后
        // 重复上传完全无害，iOS 定时任务可以放心每小时全量跑一遍。
        const ins = await pool.query(
          `INSERT INTO zenithjoy.materials
             (id, tenant_id, storage_key, file_name, mime_type, size_bytes, content_hash, dedupe_key, taken_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (dedupe_key) DO NOTHING
           RETURNING id`,
          [materialId, tenantId, storageKey, meta.fileName, meta.mimeType, meta.sizeBytes, contentHash, dedupeKey, takenAtList[i] ?? null],
        );

        if (ins.rows.length === 0) {
          // 已存在：拿回已有的 id，**不重复往存储写第二份**
          const existing = await pool.query(
            `SELECT id FROM zenithjoy.materials WHERE dedupe_key = $1 AND tenant_id = $2`,
            [dedupeKey, tenantId],
          );
          results.push({
            id: existing.rows[0]?.id ?? materialId,
            file_name: meta.fileName,
            deduped: true,
          });
          continue;
        }

        await storage.putObject({ key: storageKey, filePath: f.path, contentType: meta.mimeType });
        results.push({ id: ins.rows[0].id, file_name: meta.fileName, deduped: false });
      }

      // ── 4. 建作品 + 挂关联 ──
      const platforms = parsePlatforms(req.body?.platforms);
      const contentIns = await pool.query(
        `INSERT INTO zenithjoy.contents (tenant_id, title, body, type, platforms, status)
         VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
        [tenantId, firstString(req.body?.title), firstString(req.body?.body), contentType, platforms],
      );
      const contentId = contentIns.rows[0].id;

      for (let i = 0; i < results.length; i++) {
        await pool.query(
          `INSERT INTO zenithjoy.content_materials (content_id, material_id, sort_order)
           VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [contentId, results[i].id, i],
        );
      }

      return res.status(200).json({
        success: true,
        data: { content_id: contentId, type: contentType, materials: results },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[materials/upload] error:', err);
      return fail(res, 500, 'UPLOAD_FAILED', err instanceof Error ? err.message : 'unknown');
    } finally {
      // 临时文件一律清掉，不管成功失败——否则 /tmp 会被大视频撑爆
      for (const f of files) {
        fs.promises.unlink(f.path).catch(() => {});
      }
    }
  });

  return router;
}

/** 取第一个字符串值，拿不到给 null——直接进 SQL 参数，必须是确定类型。 */
function firstString(raw: unknown): string | null {
  const [v] = toStringArray(raw);
  return v && v.trim() ? v.trim() : null;
}

function extractUploadToken(req: Request): string | null {
  const v = req.headers['x-upload-token'];
  if (typeof v === 'string' && v.trim()) return v.trim();
  // 电脑 agent 复用它已有的 license 头，不用再发一个 token
  const alt = req.headers['x-agent-license'];
  return typeof alt === 'string' && alt.trim() ? alt.trim() : null;
}

/**
 * 把「可能是 string、可能是 string[]、也可能是别的」的请求字段收窄成确定的 string[]。
 * multipart 同名字段传一个是 string、传多个是数组——所有 body 字段都先过这里，
 * 下游只面对一种类型（CodeQL js/type-confusion-through-parameter-tampering）。
 */
function toStringArray(raw: unknown): string[] {
  if (typeof raw === 'string') return [raw];
  if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
  return [];
}

/** taken_at 与 files 一一对应，统一成定长数组。 */
function normalizeTakenAt(list: string[], count: number): Array<string | undefined> {
  return Array.from({ length: count }, (_, i) => {
    const v = list[i];
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  });
}

/** platforms 同理先收窄；单值时按逗号分隔展开。 */
function parsePlatforms(raw: unknown): string[] {
  const list = toStringArray(raw);
  return list.flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
}

/** 内容 hash 是最可靠的去重键——改了文件名也认得出是同一个文件。 */
async function hashFile(filePath: string): Promise<string> {
  const hash = crypto.createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

export default createMaterialsRouter;
