import { Router, type Request, type Response } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth";
import { parseFlatDirectory } from "../staff-directory";
import { ipKeyFn, simpleRateLimit } from "../middleware/simple-rate-limit";
import {
  AidgeTranslationError,
  translateAidgeText,
  type TranslateInput,
  type TranslateResult,
} from "../services/aidge-translation";
import { aidgeOperationById, aidgeOperations } from "../services/aidge-catalog";
import { runAidgeOperation } from "../services/aidge-gateway";
import { createHash, randomUUID } from "node:crypto";
import { open, unlink } from "node:fs/promises";
import { extname } from "node:path";
import { tmpdir } from "node:os";
import multer from "multer";
import {
  isCosConfigured,
  type MaterialStorage,
} from "../services/material-storage";

interface Options {
  authenticate?: (req: Request) => Promise<string | null>;
  translate?: (input: TranslateInput) => Promise<TranslateResult>;
  execute?: (
    operation: string,
    params: Record<string, unknown>,
  ) => Promise<unknown>;
  storage?: MaterialStorage;
}

declare module "express-serve-static-core" {
  interface Request {
    aidgeStaffId?: string;
  }
}

async function authenticateStaff(req: Request): Promise<string | null> {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  if (!session?.user?.id) return null;
  const staff = parseFlatDirectory(process.env);
  if (
    !staff.has(session.user.id) &&
    !staff.has(session.user.email.toLowerCase())
  )
    return null;
  return session.user.id;
}

const languageCode = /^[a-z]{2,3}(?:-[a-z]{2})?$/;
const uploadTypes: Record<string, { mime: string; max: number }> = {
  ".png": { mime: "image/png", max: 10_000_000 },
  ".jpg": { mime: "image/jpeg", max: 10_000_000 },
  ".jpeg": { mime: "image/jpeg", max: 10_000_000 },
  ".webp": { mime: "image/webp", max: 10_000_000 },
  ".bmp": { mime: "image/bmp", max: 10_000_000 },
  ".pdf": { mime: "application/pdf", max: 200_000_000 },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    max: 200_000_000,
  },
  ".mp4": { mime: "video/mp4", max: 200_000_000 },
  ".mov": { mime: "video/quicktime", max: 200_000_000 },
};

function matchesSignature(ext: string, header: Buffer): boolean {
  if (ext === ".png")
    return header
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (ext === ".jpg" || ext === ".jpeg")
    return header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (ext === ".webp")
    return (
      header.toString("ascii", 0, 4) === "RIFF" &&
      header.toString("ascii", 8, 12) === "WEBP"
    );
  if (ext === ".bmp") return header.toString("ascii", 0, 2) === "BM";
  if (ext === ".pdf") return header.toString("ascii", 0, 5) === "%PDF-";
  if (ext === ".docx") return header.toString("ascii", 0, 2) === "PK";
  return header.toString("ascii", 4, 8) === "ftyp";
}

export function createAidgeRouter(options: Options = {}): Router {
  const router = Router();
  const authenticate = options.authenticate ?? authenticateStaff;
  const translate = options.translate ?? translateAidgeText;
  const execute = options.execute ?? runAidgeOperation;

  router.use(async (req, res, next) => {
    try {
      const origin = req.get("origin");
      if (origin) {
        let sameHost = false;
        try {
          const parsed = new URL(origin);
          sameHost =
            ["https:", "http:"].includes(parsed.protocol) &&
            parsed.host === req.get("host");
        } catch {
          /* Invalid origins are rejected. */
        }
        if (!sameHost)
          return void res
            .status(403)
            .json({ error: "请求来源无效，请从本站操作" });
      }
      const staffId = await authenticate(req);
      if (!staffId)
        return void res.status(401).json({ error: "请使用员工账号登录" });
      req.aidgeStaffId = staffId;
      next();
    } catch {
      res.status(503).json({ error: "暂时无法验证登录状态，请稍后重试" });
    }
  });
  router.use(
    simpleRateLimit({
      windowMs: 60_000,
      max: 20,
      keyFn: (req) => req.aidgeStaffId || ipKeyFn(req),
    }),
  );

  const upload = multer({
    storage: multer.diskStorage({
      destination: tmpdir(),
      filename: (_req, _file, callback) =>
        callback(null, `aidge-${randomUUID()}`),
    }),
    limits: { fileSize: 200_000_000, files: 1 },
  });
  router.post("/upload", upload.single("file"), async (req, res) => {
    const file = req.file;
    if (!file) return void res.status(400).json({ error: "请选择素材文件" });
    try {
      const ext = extname(file.originalname).toLowerCase();
      const spec = uploadTypes[ext];
      if (!spec || file.size < 8 || file.size > spec.max)
        return void res.status(400).json({
          error: "请选择有效的图片、PDF、Word 或视频文件，并检查大小限制",
        });
      const handle = await open(file.path, "r");
      const header = Buffer.alloc(16);
      try {
        await handle.read(header, 0, header.length, 0);
      } finally {
        await handle.close();
      }
      if (!matchesSignature(ext, header))
        return void res.status(400).json({ error: "文件内容与扩展名不一致" });
      if (!options.storage && !isCosConfigured())
        return void res
          .status(503)
          .json({ error: "素材存储尚未配置，请联系管理员" });
      const storage =
        options.storage ??
        new (
          await import("../services/material-storage-cos")
        ).CosMaterialStorage();
      const key = `aidge/${createHash("sha256").update(req.aidgeStaffId!).digest("hex")}/${randomUUID()}${ext}`;
      await storage.putObject({
        key,
        filePath: file.path,
        contentType: spec.mime,
      });
      const url = await storage.getSignedUrl(key, 86400);
      res
        .set("Cache-Control", "no-store")
        .json({ name: file.originalname, size: file.size, url });
    } catch {
      res.status(503).json({ error: "素材上传失败，请稍后重试" });
    } finally {
      await unlink(file.path).catch(() => {});
    }
  });

  router.get("/catalog", (_req, res) => {
    res
      .set("Cache-Control", "private, max-age=300")
      .json({ operations: aidgeOperations });
  });

  router.post("/execute", async (req: Request, res: Response) => {
    const { operation, params, confirmDestructive } = req.body ?? {};
    const spec =
      typeof operation === "string" ? aidgeOperationById.get(operation) : null;
    if (
      !spec ||
      !params ||
      typeof params !== "object" ||
      Array.isArray(params) ||
      JSON.stringify(params).length > 20_000 ||
      Object.keys(params).some(
        (key) => !spec.fields.some((field) => field.name === key),
      ) ||
      (spec.destructive && confirmDestructive !== true)
    ) {
      res
        .status(400)
        .json({ error: "请选择能力并填写有效参数；删除操作需要明确确认" });
      return;
    }
    try {
      const result = await execute(operation, params);
      res.set("Cache-Control", "no-store").json(result);
    } catch (error) {
      const status =
        error instanceof AidgeTranslationError ? error.status : 502;
      const message =
        error instanceof AidgeTranslationError
          ? error.publicMessage
          : "Aidge 暂时无法处理此请求，请稍后重试";
      res.status(status).json({ error: message });
    }
  });

  router.post("/text-translate", async (req: Request, res: Response) => {
    const { text, sourceLanguage = "auto", targetLanguage } = req.body ?? {};
    if (
      typeof text !== "string" ||
      !text.trim() ||
      text.length > 5000 ||
      typeof sourceLanguage !== "string" ||
      (sourceLanguage !== "auto" && !languageCode.test(sourceLanguage)) ||
      typeof targetLanguage !== "string" ||
      !languageCode.test(targetLanguage) ||
      sourceLanguage === targetLanguage
    ) {
      res.status(400).json({
        error: "请输入 1～5000 字的文本，并选择不同的源语言和目标语言",
      });
      return;
    }
    try {
      const result = await translate({ text, sourceLanguage, targetLanguage });
      res.set("Cache-Control", "no-store").json({
        translatedText: result.text,
        detectedLanguage: result.detectedLanguage,
        characters: result.characters,
        requestId: result.requestId,
      });
    } catch (error) {
      const status =
        error instanceof AidgeTranslationError ? error.status : 502;
      const message =
        error instanceof AidgeTranslationError
          ? error.publicMessage
          : "翻译服务暂时不可用，请稍后重试";
      res.status(status).json({ error: message });
    }
  });
  return router;
}
