import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { rateLimit } from 'express-rate-limit';
import { fromNodeHeaders } from 'better-auth/node';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { auth } from '../auth';
import { parseFlatDirectory } from '../staff-directory';
import { AliVideoProvider, AliVideoProviderError, type AliVideoTask, type WanVideoInput } from '../services/ali-video-provider';
import { isCosConfigured, type MaterialStorage } from '../services/material-storage';

type Kind = 'wan' | 'upscale';
interface Job extends AliVideoTask {
  id: string; kind: Kind; createdAt: string; taskId?: string; clientRequestId?: string;
  prompt?: string; lastPolledAt?: number;
}
interface Asset { id: string; url: string; kind: 'image' | 'video'; name: string; width: number; height: number; duration: number; size: number; fps: number; createdAt: string }
interface UploadIntent { id: string; key: string; name: string; size: number; createdAt: string }
interface StaffRequest extends Request { videoStaffId?: string }
interface Options { provider?: AliVideoProvider; directory?: string; storage?: MaterialStorage }
const MAX_BYTES = 100 * 1024 * 1024;
const UPLOAD_INTENT_TTL_SECONDS = 7200;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(status: number, message: string): never { throw Object.assign(new Error(message), { status }); }

async function inspectAsset(file: string, kind: Asset['kind'], timeout = 15000) {
  try {
    const output = await promisify(execFile)('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,avg_frame_rate:format=duration,format_name', '-of', 'json', file], { timeout, maxBuffer: 16384 });
    const info = JSON.parse(output.stdout);
    const width = Number(info.streams?.[0]?.width), height = Number(info.streams?.[0]?.height), duration = Number(info.format?.duration ?? 0);
    const rate = String(info.streams?.[0]?.avg_frame_rate ?? '0/1').split('/').map(Number);
    const fps = rate[1] ? rate[0] / rate[1] : 0;
    if (kind === 'image' && !['png', 'mjpeg', 'webp'].includes(info.streams?.[0]?.codec_name)) return fail(400, '文件内容与图片类型不符');
    if (kind === 'video' && !/(mov|mp4|matroska|webm)/.test(info.format?.format_name ?? '')) return fail(400, '请上传有效的 MP4、MOV 或 WebM 视频');
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || (kind === 'video' && (!Number.isFinite(duration) || duration <= 0))) return fail(400, '无法读取素材尺寸或时长，请重新导出后上传');
    return { width, height, duration, fps };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fail(503, '视频检查服务尚未配置，请联系管理员');
    return fail(400, '无法读取素材，请上传有效的图片或视频');
  }
}

function publicUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 8192) return fail(400, '请提供有效的素材地址');
  try {
    const u = new URL(value);
    const host = u.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password ||
      !host.includes('.') || host.includes(':') || host.startsWith('[') ||
      /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
      host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost') ||
      (u.port && !['80', '443'].includes(u.port))) return fail(400, '素材地址必须是公网 HTTP 或 HTTPS 地址');
    return u.href;
  } catch { return fail(400, '请提供有效的公网素材地址'); }
}

function view(job: Job) {
  const visible = { ...job };
  delete visible.taskId;
  delete visible.clientRequestId;
  delete visible.lastPolledAt;
  return visible;
}
async function save(file: string, body: unknown) {
  await mkdir(resolve(file, '..'), { recursive: true, mode: 0o700 });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(body), { mode: 0o600 });
  await rename(temp, file);
}
async function load<T>(file: string, root: string): Promise<T | null> {
  const fullPath = resolve(file);
  if (!fullPath.startsWith(resolve(root) + sep)) return fail(400, '任务文件地址无效');
  try { return JSON.parse(await readFile(fullPath, 'utf8')) as T; }
  catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
}

/** Staff-only API. Each staff account has its own durable task/asset directory. */
export function createVideoToolsRouter(options: Options = {}): Router {
  const router = Router();
  const provider = options.provider ?? new AliVideoProvider();
  const directory = options.directory ?? process.env.VIDEO_TOOLS_DATA_DIR ?? resolve(process.cwd(), 'data/video-tools');
  const locks = new Map<string, Promise<unknown>>();
  async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(done => { release = done; });
    const queued = previous.then(() => gate);
    locks.set(key, queued);
    await previous;
    try { return await operation(); }
    finally { release(); if (locks.get(key) === queued) locks.delete(key); }
  }
  const ownerDir = (req: StaffRequest) => join(directory, hash(req.videoStaffId!));
  const jobPath = (req: StaffRequest, id: string) => join(ownerDir(req), `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
  let storage = options.storage;
  const uploadsConfigured = () => Boolean(storage) || isCosConfigured();
  async function getStorage() {
    if (!uploadsConfigured()) return fail(503, '素材上传服务尚未配置，请联系管理员');
    if (!storage) { const { CosMaterialStorage } = await import('../services/material-storage-cos'); storage = new CosMaterialStorage(); }
    return storage;
  }
  const wrap = (handler: (req: StaffRequest, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void handler(req, res, next).catch(next); };
  router.use(wrap(async (req, res, next) => {
    const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session?.user?.id) return void res.status(401).json({ error: '登录已失效，请重新登录' });
    const staff = parseFlatDirectory(process.env);
    if (!staff.has(session.user.id) && !staff.has(session.user.email.toLowerCase())) return void res.status(403).json({ error: '需要员工账号权限' });
    req.videoStaffId = session.user.id;
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      const allowed = new Set([`${req.protocol}://${req.get('host')}`, process.env.BETTER_AUTH_URL, ...(process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? '').split(',')].filter(Boolean));
      let sameHost = false;
      try { const origin = new URL(req.headers.origin); sameHost = ['https:', 'http:'].includes(origin.protocol) && origin.host === req.get('host'); } catch { /* invalid origin is rejected */ }
      if (!sameHost && !allowed.has(req.headers.origin)) return void res.status(403).json({ error: '请求来源无效，请从本站操作' });
    }
    next();
  }));
  router.get('/config', (_req, res) => res.json({ ...provider.getConfiguration(), uploads: { configured: uploadsConfigured() } }));

  router.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false, message: { error: '请求过于频繁，请稍后重试' } }));
  const assetPath = (req: StaffRequest, id: string) => join(ownerDir(req), 'assets', `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
  const intentPath = (req: StaffRequest, id: string) => join(ownerDir(req), 'uploads', `${id.replace(/[^a-zA-Z0-9-]/g, '')}.json`);
  router.post('/uploads/presign', wrap(async (req, res) => {
    const { name, size } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim() || name.length > 255 || /[\\/\0]/.test(name) || !/\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(name)) return fail(400, '请选择 PNG、JPG、WebP 图片或 MP4、MOV、WebM 视频');
    if (!Number.isSafeInteger(size) || size <= 0) return fail(400, '请选择非空的有效文件');
    if (size > MAX_BYTES) return fail(413, '上传文件不能超过 100 MB');
    const objectStorage = await getStorage();
    const id = randomUUID();
    const intent: UploadIntent = { id, key: `video-tools/${hash(req.videoStaffId!)}/${id}${extname(name).toLowerCase()}`, name, size, createdAt: new Date().toISOString() };
    const uploadUrl = await objectStorage.presignPut(intent.key, UPLOAD_INTENT_TTL_SECONDS);
    await save(intentPath(req, id), intent);
    res.json({ id, uploadUrl });
  }));
  router.post('/uploads/:id/complete', wrap(async (req, res) => {
    if (!uuid.test(req.params.id)) return fail(404, '上传记录不存在或无权访问');
    await serialized(`upload:${req.videoStaffId}:${req.params.id}`, async () => {
      const intent = await load<UploadIntent>(intentPath(req, req.params.id), directory);
      if (!intent) return fail(404, '上传记录不存在或无权访问');
      const completed = await load<Asset>(assetPath(req, intent.id), directory);
      if (completed) { res.json(completed); return; }
      if (Date.now() - Date.parse(intent.createdAt) > UPLOAD_INTENT_TTL_SECONDS * 1000) return fail(410, '本次上传已过期，请重新选择文件上传');
      const objectStorage = await getStorage();
      let actual;
      try { actual = await objectStorage.headObject(intent.key); }
      catch { return fail(503, '暂时无法确认文件上传状态，请稍后重试'); }
      if (!actual || !Number.isSafeInteger(actual.sizeBytes) || actual.sizeBytes !== intent.size || actual.sizeBytes > MAX_BYTES) return fail(409, '文件尚未完整上传，请重试上传或稍后确认');
      // This URL is issued by server-side storage for the persisted intent key; no client URL is accepted.
      const source = new URL(await objectStorage.getSignedUrl(intent.key));
      if (source.protocol !== 'https:' || source.username || source.password || source.port || !/^[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(source.hostname)) return fail(503, '素材存储地址配置无效，请联系管理员');
      const temporaryFile = join(tmpdir(), `video-tools-complete-${randomUUID()}`);
      const deadline = Date.now() + 60000;
      const signal = AbortSignal.timeout(60000);
      try {
        const response = await fetch(source.href, { redirect: 'error', signal });
        if (!response.ok || !response.body) return fail(409, '暂时无法读取上传文件，请稍后重新确认');
        const advertised = response.headers.get('content-length');
        if (advertised && Number(advertised) !== intent.size) {
          await response.body.cancel();
          return fail(409, '文件大小与上传记录不符，请重新上传');
        }
        let bytes = 0;
        const limit = new Transform({ transform(chunk: Buffer, _encoding, next) {
          bytes += chunk.length;
          next(bytes > MAX_BYTES || bytes > intent.size ? Object.assign(new Error('文件大小与上传记录不符，请重新上传'), { status: 409 }) : null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(temporaryFile, { mode: 0o600, flags: 'wx' }), { signal });
        if (bytes !== intent.size) return fail(409, '文件尚未完整上传，请重新上传');
        const kind = /\.(png|jpe?g|webp)$/i.test(intent.name) ? 'image' : 'video';
        const remaining = deadline - Date.now();
        if (remaining <= 0) return fail(504, '文件检查超时，请稍后重新确认，无需重复上传');
        const metadata = await inspectAsset(temporaryFile, kind, Math.min(15000, remaining));
        if (signal.aborted) return fail(504, '文件检查超时，请稍后重新确认，无需重复上传');
        const asset: Asset = { id: intent.id, url: await objectStorage.getSignedUrl(intent.key, 86400), kind, name: intent.name, ...metadata, size: intent.size, createdAt: new Date().toISOString() };
        await save(assetPath(req, intent.id), asset);
        res.json(asset);
      } catch (err) {
        if (signal.aborted || (err as Error).name === 'TimeoutError') return fail(504, '文件检查超时，请稍后重新确认，无需重复上传');
        if ((err as { status?: number }).status) throw err;
        return fail(503, '暂时无法读取上传文件，请稍后重新确认');
      } finally { await unlink(temporaryFile).catch(() => {}); }
    });
  }));
  const temporaryFiles = new WeakMap<Request, string>();
  const upload = multer({ storage: multer.diskStorage({ destination: tmpdir(), filename: (req, _file, cb) => {
    const filename = `video-tools-${randomUUID()}`;
    temporaryFiles.set(req, join(tmpdir(), filename));
    cb(null, filename);
  } }), limits: { fileSize: MAX_BYTES, files: 1 }, fileFilter: (_req, file, cb) => {
    const valid = /\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(file.originalname);
    if (valid) cb(null, true);
    else cb(Object.assign(new Error('请选择 PNG、JPG、WebP 图片或 MP4、MOV、WebM 视频'), { status: 400 }));
  } });
  router.post('/uploads', upload.single('file'), wrap(async (req, res) => {
    const file = req.file;
    if (!file) return fail(400, '请选择需要上传的文件');
    const temporaryFile = temporaryFiles.get(req);
    if (!temporaryFile) return fail(500, '上传状态无效，请重试');
    try {
      if (!file.size) return fail(400, '不能上传空文件');
      const suffix = extname(file.originalname).toLowerCase();
      const kind = /\.(png|jpe?g|webp)$/.test(suffix) ? 'image' : 'video';
      const metadata = await inspectAsset(temporaryFile, kind);
      const objectId = randomUUID();
      const key = `video-tools/${hash(req.videoStaffId!)}/${objectId}${suffix}`;
      const objectStorage = await getStorage();
      await objectStorage.putObject({ key, filePath: temporaryFile, contentType: kind === 'video' ? (suffix === '.webm' ? 'video/webm' : suffix === '.mov' ? 'video/quicktime' : 'video/mp4') : suffix === '.png' ? 'image/png' : suffix === '.webp' ? 'image/webp' : 'image/jpeg' });
      const asset: Asset = { id: objectId, url: await objectStorage.getSignedUrl(key, 86400), kind, name: file.originalname, ...metadata, size: file.size, createdAt: new Date().toISOString() };
      await save(join(ownerDir(req), 'assets', `${objectId}.json`), asset);
      res.json(asset);
    } finally { await unlink(temporaryFile).catch(() => {}); temporaryFiles.delete(req); }
  }));

  async function jobs(req: StaffRequest): Promise<Job[]> {
    await mkdir(ownerDir(req), { recursive: true, mode: 0o700 });
    const names = (await readdir(ownerDir(req))).filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json'));
    const values = await Promise.all(names.map(name => load<Job>(join(ownerDir(req), name), directory)));
    return values.filter((j): j is Job => j !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function ownedAsset(req: StaffRequest, url: string): Promise<Asset | null> {
    const assetDir = join(ownerDir(req), 'assets');
    let names: string[];
    try { names = await readdir(assetDir); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null; throw err; }
    for (const name of names) { const a = await load<Asset>(join(assetDir, name), directory); if (a?.url === url) return a; }
    return null;
  }
  function validate(body: Record<string, unknown>): Kind {
    if (body.kind !== 'wan' && body.kind !== 'upscale') return fail(400, '请选择视频生成或视频超分');
    if (body.clientRequestId !== undefined && (typeof body.clientRequestId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(body.clientRequestId))) return fail(400, '提交标识无效，请刷新后重试');
    if (body.kind === 'wan') {
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 10000) return fail(400, '请填写不超过 10000 字的提示词');
      if (body.duration !== undefined && (!Number.isInteger(body.duration) || Number(body.duration) < 2 || Number(body.duration) > 30)) return fail(400, '视频时长应为 2 至 30 秒');
      if (body.resolution !== undefined && !['480P', '720P', '1080P'].includes(String(body.resolution))) return fail(400, '请选择有效的分辨率');
      if (body.ratio !== undefined && !['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].includes(String(body.ratio))) return fail(400, '请选择有效的画面比例');
      if (body.audio !== undefined && typeof body.audio !== 'boolean') return fail(400, '声音选项无效');
      const media = body.media ?? [];
      if (!Array.isArray(media) || media.length > 15) return fail(400, '参考素材过多');
      let images = 0, videos = 0;
      for (const m of media) {
        if (m?.type === 'reference_image') images++; else if (m?.type === 'reference_video') videos++; else return fail(400, '参考素材类型无效');
        publicUrl(m.url);
      }
      if (images > 10 || videos > 5) return fail(400, '最多支持 10 张图片和 5 段视频');
    } else {
      publicUrl(body.videoUrl);
      if (body.bitRate !== undefined && (!Number.isInteger(body.bitRate) || Number(body.bitRate) < 1 || Number(body.bitRate) > 20)) return fail(400, '输出码率应为 1 至 20 Mbps');
    }
    return body.kind;
  }
  router.post('/jobs', wrap(async (req, res) => {
    const body = req.body ?? {};
    const kind = validate(body);
    // Serialize per staff account: concurrent duplicate clicks share one provider submission.
    const owner = req.videoStaffId!;
    await serialized(`submit:${owner}`, async () => {
      const history = await jobs(req);
      const duplicate = body.clientRequestId && history.find(j => j.clientRequestId === body.clientRequestId);
      if (duplicate) { res.status(202).json(view(duplicate)); return; }
      if (!provider.getConfiguration()[kind].configured) return fail(503, '服务尚未配置，请联系管理员');
      const active = history.filter(j => ['pending', 'running'].includes(j.status));
      const refreshed = await Promise.all(active.map(job => refreshJob(req, job.id)));
      if (refreshed.filter(j => ['pending', 'running'].includes(j.status)).length >= 2) return fail(429, '已有两个任务处理中，请等待完成后再提交');
      if (kind === 'wan') {
        let totalDuration = 0;
        for (const media of body.media ?? []) {
          const asset = await ownedAsset(req, media.url);
          if (!asset || (media.type === 'reference_image' ? asset.kind !== 'image' : asset.kind !== 'video')) return fail(400, '请重新上传属于当前账号的参考素材');
          if (Date.now() - Date.parse(asset.createdAt) > 23 * 3600_000) return fail(400, '参考素材已过期，请重新上传');
          if (asset.kind === 'image' && (asset.size > 20 * 1024 * 1024 || Math.min(asset.width,asset.height) < 240 || Math.max(asset.width,asset.height) > 8000 || Math.max(asset.width,asset.height) / Math.min(asset.width,asset.height) > 4)) return fail(400, '参考图片须小于 20 MB，边长为 240 至 8000 像素，长宽比不超过 4:1');
          if (asset.kind === 'video') {
            if (!/\.(mp4|mov)$/i.test(asset.name) || asset.fps < 16 || Math.min(asset.width,asset.height) < 240 || Math.max(asset.width,asset.height) > 4096 || Math.max(asset.width,asset.height) / Math.min(asset.width,asset.height) > 8) return fail(400, 'Wan 参考视频须为 MP4 或 MOV，至少 16 fps，边长为 240 至 4096 像素');
            if (asset.duration < 1 || asset.duration > 15) return fail(400, '单段参考视频须为 1 至 15 秒');
            totalDuration += asset.duration;
          }
        }
        if (totalDuration > 15 || (totalDuration && totalDuration + (body.duration ?? 5) > 30)) return fail(400, '参考视频合计不超过 15 秒，参考与生成时长合计不超过 30 秒');
      } else {
        const asset = await ownedAsset(req, body.videoUrl);
        // Public URLs are also accepted for existing company media; uploaded files get metadata validation.
        if (asset && (asset.kind !== 'video' || asset.width <= 360 || asset.height <= 360 || Math.max(asset.width,asset.height) >= 1920 || Math.min(asset.width,asset.height) >= 1080)) return fail(400, '超分视频尺寸须大于 360×360，且小于 1920×1080');
      }
      const job: Job = { id: randomUUID(), kind, status: 'pending', createdAt: new Date().toISOString(), clientRequestId: body.clientRequestId, ...(kind === 'wan' ? { prompt: body.prompt.trim() } : {}) };
      await save(jobPath(req, job.id), job);
      try {
        const submitted = kind === 'wan'
          ? await provider.submitWan({ prompt: body.prompt.trim(), media: body.media, duration: body.duration, resolution: body.resolution, ratio: body.ratio, audio: body.audio } as WanVideoInput)
          : await provider.submitUpscale({ videoUrl: body.videoUrl, bitRate: body.bitRate });
        job.taskId = submitted.taskId;
      } catch (err) {
        job.status = 'failed';
        job.error = err instanceof AliVideoProviderError ? err.message : '提交未能确认，请先检查任务记录，避免重复提交';
      }
      await save(jobPath(req, job.id), job);
      res.status(202).json(view(job));
    });
  }));
  router.get('/jobs', wrap(async (req, res) => {
    await locks.get(`submit:${req.videoStaffId}`);
    const history = (await jobs(req)).slice(0, 100);
    const current = await Promise.all(history.map(j => ['pending', 'running'].includes(j.status) ? refreshJob(req,j.id) : j));
    res.json({ jobs: current.map(view) });
  }));
  async function refreshJob(req: StaffRequest, id: string): Promise<Job> {
    return serialized(`job:${req.videoStaffId}:${id}`, async () => {
    const job = await load<Job>(jobPath(req, id), directory);
    if (!job) return fail(404, '任务不存在或无权访问');
    if (['pending', 'running'].includes(job.status)) {
      if (!job.taskId) {
        if (Date.now() - Date.parse(job.createdAt) > 120000) {
          job.status = 'unknown'; job.error = '提交状态无法确认，请联系管理员核对，避免重复计费';
          await save(jobPath(req, job.id), job);
        }
      } else if (Date.now() - (job.lastPolledAt ?? 0) >= 14000) {
        const snapshot = await provider.fetchTask(job.kind, job.taskId);
        Object.assign(job, snapshot, { lastPolledAt: Date.now() });
        if (job.status !== 'succeeded') delete job.videoUrl;
        if (job.status === 'succeeded' && !job.videoUrl) { job.status = 'failed'; job.error = '服务未返回视频结果，请联系管理员'; }
        await save(jobPath(req, job.id), job);
      }
    }
    return job;
    });
  }
  async function getJob(req: StaffRequest) {
    if (!uuid.test(req.params.id)) return fail(404, '任务不存在或无权访问');
    await locks.get(`submit:${req.videoStaffId}`);
    return refreshJob(req,req.params.id);
  }
  router.get('/jobs/:id', wrap(async (req, res) => res.json(view(await getJob(req)))));
  router.get('/jobs/:id/download', wrap(async (req, res) => {
    const job = await getJob(req);
    if (job.status !== 'succeeded' || !job.videoUrl) return fail(409, '视频尚未生成成功，暂时无法下载');
    const upstream = await provider.downloadResult(publicUrl(job.videoUrl));
    if (!upstream.ok || !upstream.body) return fail(410, '结果链接已失效，请联系管理员核对原任务');
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${job.kind}-${job.id}.mp4"`);
    res.setHeader('Cache-Control', 'private, no-store');
    await pipeline(Readable.fromWeb(upstream.body as never), res);
  }));
  router.use((err: Error & { status?: number; code?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(err);
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status ?? 500;
    const message = err.code === 'LIMIT_FILE_SIZE' ? '上传文件不能超过 100 MB' : status < 500 || err instanceof AliVideoProviderError ? err.message : '视频服务暂时不可用，请稍后重试';
    res.status(status).json({ error: message });
  });
  return router;
}
