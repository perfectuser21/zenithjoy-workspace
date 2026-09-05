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
import { persistMaterials, type PersistItem } from '../services/material-persist';

/** 一页默认多少条。手机上九宫格，30 条够翻一屏多。 */
const DEFAULT_PAGE_SIZE = 30;

/**
 * 一页最多多少条 —— 硬上限，不可绕过。
 * 没有它的话 ?limit=999999 能一次拖垮 DB，还要逐条签 99 万个预览 URL。
 */
const MAX_PAGE_SIZE = 100;

/** 列表查询从库里取出的形状。storage_key 只在服务端用来签 URL，不外发。 */
interface MaterialRow {
  id: string;
  file_name: string;
  size_bytes: string | number;
  mime_type: string | null;
  storage_key: string;
  taken_at: string | null;
  created_at: string;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({
    success: false,
    data: null,
    error: { code, message },
    timestamp: new Date().toISOString(),
  });
}

/**
 * 鉴权：租户永远从凭据反查，绝不信客户端自报的 tenant_id——否则任何人填别人的
 * ID 就能把素材写进别人的库、也能拿到别人的素材 id。
 * 失败时已写好响应，调用方拿到 null 直接 return。
 */
async function authenticate(
  req: Request,
  res: Response,
): Promise<{ tenantId: string; licenseId: string } | null> {
  const token = extractUploadToken(req);
  if (!token) {
    fail(res, 401, 'UNAUTHORIZED', '缺少上传凭据。请在请求头加 X-Upload-Token: <token>');
    return null;
  }
  let r;
  try {
    r = await validateLicense(token);
  } catch (err) {
    fail(res, 500, 'LICENSE_LOOKUP_FAILED', err instanceof Error ? err.message : 'unknown');
    return null;
  }
  if (!r.ok) {
    // INVALID_LICENSE = 认不出这张证 → 401；其余（REVOKED/SUSPENDED/EXPIRED/
    // NO_TENANT）= 认得出但不给用 → 403。与 worker-agent-auth 口径一致。
    fail(res, r.code === 'INVALID_LICENSE' ? 401 : 403, r.code, r.message);
    return null;
  }
  return { tenantId: r.license.tenant_id as string, licenseId: r.license.id as string };
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

  // ── ⓪ GET /：列出本租户素材，每条带一个临时预览 URL ──────────────────
  //
  // 素材传上去看不见等于没传。这个端点是三端共用的地基——网页、小程序、
  // 桌面端都调它，做小程序时不用回头改。
  router.get('/', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId } = auth;

    // 客户端传什么都当敌意输入。就地收窄，不藏进 helper——CodeQL 不做跨函数
    // 收窄（js/type-confusion-through-parameter-tampering）。
    const rawLimit = req.query?.limit;
    const parsedLimit = Number(typeof rawLimit === 'string' ? rawLimit : NaN);
    // 非法（负数/0/非数字）一律回落默认值；再夹到硬上限。
    // 没有上限的话 limit=999999 能拖垮 DB，还要签 99 万个 URL。
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(Math.floor(parsedLimit), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

    const rawOffset = req.query?.offset;
    const parsedOffset = Number(typeof rawOffset === 'string' ? rawOffset : NaN);
    const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0;

    let rows: MaterialRow[];
    try {
      // 租户永远从凭据反查。绝不读 req.query.tenant_id——否则任何人填别人的
      // ID 就能列出别人的素材。
      const q = await pool.query<MaterialRow>(
        `SELECT id, file_name, size_bytes, mime_type, storage_key, taken_at, created_at
           FROM zenithjoy.materials
          WHERE tenant_id = $1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset],
      );
      rows = q.rows;
    } catch (err) {
      console.error('[materials/list] query error:', err);
      return fail(res, 500, 'LIST_FAILED', err instanceof Error ? err.message : 'unknown');
    }

    // 逐条签预览 URL。**一条签不出来只让这条为 null，绝不让整页挂掉**——
    // 一张图坏了不该让整个素材库看不见。
    // storage_key 不外发：前端不需要它，少暴露一个内部路径。
    const items = await Promise.all(rows.map(async (m) => {
      let previewUrl: string | null = null;
      try {
        previewUrl = await storage.getSignedUrl(m.storage_key);
      } catch (err) {
        console.warn('[materials/list] 预览签名失败，该条返回 null:', m.id, err);
      }
      return {
        id: m.id,
        file_name: m.file_name,
        size_bytes: Number(m.size_bytes),
        mime_type: m.mime_type,
        taken_at: m.taken_at,
        created_at: m.created_at,
        preview_url: previewUrl,
      };
    }));

    return res.status(200).json({
      success: true,
      data: { items, limit, offset, count: items.length },
      timestamp: new Date().toISOString(),
    });
  });

  // ── ① POST /upload-urls：客户端裸 PUT 之前，先换一批只对单个对象有效的签名 URL ──
  router.post('/upload-urls', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId, licenseId } = auth;

    // body.files 必须是数组——就地收窄，不藏进 helper（CodeQL 不做跨函数收窄）。
    const rawFiles: unknown = req.body?.files;
    const fileInputs: unknown[] = Array.isArray(rawFiles) ? rawFiles : [];
    if (fileInputs.length === 0) {
      return fail(res, 400, 'NO_FILES', '没有素材：一次上传至少要带一个文件');
    }

    const metas: UploadedFileMeta[] = [];
    for (const raw of fileInputs) {
      const item = raw as Record<string, unknown>;
      const fileName = typeof item?.file_name === 'string' ? sanitizeFileName(item.file_name) : 'material';
      const mimeType = typeof item?.mime_type === 'string' ? item.mime_type : '';
      const sizeBytes = typeof item?.size_bytes === 'number' && Number.isFinite(item.size_bytes) ? item.size_bytes : -1;

      if (sizeBytes <= 0 || sizeBytes > MAX_FILE_BYTES) {
        return fail(res, 400, 'FILE_TOO_LARGE', `文件 ${fileName} 大小非法或超过上限（${MAX_FILE_BYTES} 字节）`);
      }
      metas.push({ fileName, mimeType, sizeBytes });
    }

    try {
      inferContentType(metas);
    } catch (err) {
      // 类型冲突在签 URL 阶段就拒，别让客户端白传几百兆再报错
      return fail(res, 400, 'INVALID_MATERIAL_MIX', err instanceof Error ? err.message : 'unknown');
    }

    try {
      const files = [];
      for (const meta of metas) {
        const materialId = crypto.randomUUID();
        const storageKey = buildStorageKey({ tenantId, materialId, fileName: meta.fileName });
        const uploadUrl = await storage.presignPut(storageKey);
        files.push({
          material_id: materialId,
          storage_key: storageKey,
          file_name: meta.fileName,
          upload_url: uploadUrl,
        });
      }
      return res.status(200).json({
        success: true,
        data: { files, license_id: licenseId },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[materials/upload-urls] error:', err);
      return fail(res, 500, 'PRESIGN_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  // ── ② POST /complete：客户端裸 PUT 完之后，服务端 HEAD 每个对象核实再落库 ──
  router.post('/complete', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId, licenseId } = auth;

    const rawFiles: unknown = req.body?.files;
    const fileInputs: unknown[] = Array.isArray(rawFiles) ? rawFiles : [];
    if (fileInputs.length === 0) {
      return fail(res, 400, 'NO_FILES', '没有素材：一次上传至少要带一个文件');
    }

    const items: PersistItem[] = [];
    const metas: UploadedFileMeta[] = [];

    for (const raw of fileInputs) {
      const item = raw as Record<string, unknown>;
      const storageKey = typeof item?.storage_key === 'string' ? item.storage_key : '';
      const materialId = typeof item?.material_id === 'string' ? item.material_id : '';
      const fileName = typeof item?.file_name === 'string' ? sanitizeFileName(item.file_name) : '';
      const mimeType = typeof item?.mime_type === 'string' ? item.mime_type : '';
      const sizeBytes = typeof item?.size_bytes === 'number' && Number.isFinite(item.size_bytes) ? item.size_bytes : -1;
      const takenAt = typeof item?.taken_at === 'string' ? item.taken_at : undefined;

      if (!storageKey || !materialId || !fileName || sizeBytes <= 0) {
        return fail(res, 400, 'INVALID_ITEM', '素材条目缺少必要字段（storage_key/material_id/file_name/size_bytes）');
      }
      // storage_key 天然按租户分段——不在自己前缀下就是想认领别人的对象。
      if (!storageKey.startsWith(`${tenantId}/`)) {
        return fail(res, 403, 'TENANT_MISMATCH', '素材不属于当前租户，拒绝认领');
      }

      let head;
      try {
        head = await storage.headObject(storageKey);
      } catch (err) {
        // 网络故障不能当成"文件不存在"，那会把传成功的素材丢掉
        return fail(res, 502, 'STORAGE_UNAVAILABLE', err instanceof Error ? err.message : 'unknown');
      }
      if (!head) {
        return fail(res, 400, 'OBJECT_NOT_FOUND', `对象不存在：${storageKey}（客户端可能还没传完，或传到了别的 key）`);
      }
      if (head.sizeBytes !== sizeBytes) {
        return fail(
          res,
          400,
          'SIZE_MISMATCH',
          `对象大小对不上：申报 ${sizeBytes} 字节，实际 ${head.sizeBytes} 字节（${storageKey}）`,
        );
      }

      const meta: UploadedFileMeta = { fileName, mimeType, sizeBytes };
      metas.push(meta);
      items.push({
        materialId,
        storageKey,
        fileName,
        mimeType,
        sizeBytes,
        takenAt,
        dedupeKey: buildDedupeKey({ tenantId, fileName, sizeBytes, takenAt }),
      });
    }

    let contentType: string;
    try {
      contentType = inferContentType(metas);
    } catch (err) {
      return fail(res, 400, 'INVALID_MATERIAL_MIX', err instanceof Error ? err.message : 'unknown');
    }

    try {
      const platforms = parsePlatforms(req.body?.platforms);
      // 不传 onNewMaterial：文件已由客户端直传进 COS，这里不需要再上传一次。
      const out = await persistMaterials({
        tenantId,
        licenseId,
        contentType: contentType as 'video' | 'image',
        title: firstString(req.body?.title),
        body: firstString(req.body?.body),
        platforms,
        items,
      });

      return res.status(200).json({
        success: true,
        data: { content_id: out.contentId, type: contentType, materials: out.materials },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[materials/complete] error:', err);
      return fail(res, 500, 'COMPLETE_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  router.post('/upload', upload.array('files'), async (req: Request, res: Response) => {
    // multer 的 .array() 给数组、.fields() 给对象，所以 req.files 是「数组或对象」。
    // 必须用 Array.isArray 做**运行时**收窄——类型断言只骗过 TS，骗不过 CodeQL，
    // 也骗不过真实的畸形请求（js/type-confusion-through-parameter-tampering）。
    const files: Express.Multer.File[] = Array.isArray(req.files) ? req.files : [];

    try {
      // ── 1. 鉴权：租户永远从凭据反查，绝不信客户端自报的 tenant_id ──
      const auth = await authenticate(req, res);
      if (!auth) return;
      const { tenantId, licenseId } = auth;

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

      // ── 3. 组装落库条目 ──
      // multipart 同名字段传一个是 string、传多个是数组。收窄必须**就地写**，
      // 不能藏进 helper——CodeQL 不做跨函数收窄，而且就地写读代码的人也一眼看得见
      // 这里有两种形态（js/type-confusion-through-parameter-tampering）。
      const rawTakenAt: unknown = req.body?.taken_at;
      const takenAtRaw: string[] = Array.isArray(rawTakenAt)
        ? rawTakenAt.filter((v): v is string => typeof v === 'string')
        : typeof rawTakenAt === 'string'
          ? [rawTakenAt]
          : [];
      const takenAtList = normalizeTakenAt(takenAtRaw, files.length);

      const items: PersistItem[] = files.map((f, i) => {
        const meta = metas[i];
        const materialId = crypto.randomUUID();
        const storageKey = buildStorageKey({ tenantId, materialId, fileName: meta.fileName });
        return {
          materialId,
          storageKey,
          fileName: meta.fileName,
          mimeType: meta.mimeType,
          sizeBytes: meta.sizeBytes,
          takenAt: takenAtList[i],
          dedupeKey: buildDedupeKey({
            tenantId,
            fileName: meta.fileName,
            sizeBytes: meta.sizeBytes,
            takenAt: takenAtList[i],
          }),
        };
      });

      // ── 4. 落库 + 上存储 ──
      const platforms = parsePlatforms(req.body?.platforms);
      const out = await persistMaterials({
        tenantId,
        licenseId,
        contentType: contentType as 'video' | 'image',
        title: firstString(req.body?.title),
        body: firstString(req.body?.body),
        platforms,
        items,
        // 只有【新】素材才上传。命中去重的直接跳过，不重复往存储写第二份。
        onNewMaterial: async (item, index) => {
          await storage.putObject({
            key: item.storageKey,
            filePath: files[index].path,
            contentType: item.mimeType,
          });
        },
      });

      return res.status(200).json({
        success: true,
        data: { content_id: out.contentId, type: contentType, materials: out.materials },
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

export default createMaterialsRouter;
