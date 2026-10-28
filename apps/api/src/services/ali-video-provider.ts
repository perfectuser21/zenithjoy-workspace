import { createHmac, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ProxyAgent } from 'undici';

export interface WanVideoInput {
  prompt: string;
  media?: Array<{ type: string; url: string }>;
  resolution?: string;
  ratio?: string;
  duration?: number;
  audio?: boolean;
}

export interface AliVideoTask {
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled' | 'unknown';
  videoUrl?: string;
  error?: string;
}

export class AliVideoProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 502) {
    super(message);
    this.name = 'AliVideoProviderError';
  }
}

type JsonObject = Record<string, unknown>;
const asObject = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const rpcEncode = (value: string): string => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const REQUEST_TIMEOUT_MS = 30_000;

/** Do not forward upstream free-form messages: they may include keys, input URLs or signatures. */
function safeUpstreamMessage(code: unknown): string {
  const value = text(code);
  return /^[A-Za-z0-9_.-]{1,80}$/.test(value) ? `阿里服务返回错误（${value}），请检查服务权限或输入素材` : '阿里服务处理失败，请稍后重试';
}

function videoUrl(value: unknown): string {
  const valueText = text(value);
  try {
    const url = new URL(valueText);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    return valueText;
  } catch {
    throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '阿里服务未返回可用的视频结果');
  }
}

/**
 * Minimal server-side adapter for Wan 3.0 and the existing VIAPI super-resolution account.
 * Only the application server holds credentials; tasks are polled, never resubmitted automatically.
 */
export class AliVideoProvider {
  private readonly env: NodeJS.ProcessEnv;
  private readonly transport: typeof fetch;
  private apiProxy?: ProxyAgent;

  constructor(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
    this.env = options.env ?? process.env;
    this.transport = options.fetch ?? fetch;
  }

  private proxyUrl(): string | null | undefined {
    const value = this.env.ALI_VIDEO_HTTPS_PROXY?.trim();
    if (!value) return undefined;
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return url.origin;
    } catch { return null; }
  }

  private proxyOptions(enabled = true): { dispatcher?: ProxyAgent } {
    const proxy = this.proxyUrl();
    if (proxy === null) throw new AliVideoProviderError('PROVIDER_NOT_CONFIGURED', '视频服务连接配置无效，请联系管理员', 503);
    if (!enabled || !proxy) return {};
    this.apiProxy ??= new ProxyAgent(proxy);
    return { dispatcher: this.apiProxy };
  }

  private mediaRequest(url: string, init: RequestInit): Promise<Response> {
    const target = new URL(url);
    const shanghaiOss = target.protocol === 'https:' && !target.username && !target.password && !target.port && /^[a-z0-9-]+\.oss-cn-shanghai\.aliyuncs\.com$/.test(target.hostname);
    return this.transport(url, { ...init, ...this.proxyOptions(shanghaiOss) });
  }

  /** The URL comes from a completed provider task and is validated by the route. */
  async downloadResult(url: string): Promise<Response> {
    return this.mediaRequest(url, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  }

  private wanBase(): string | null {
    const explicit = this.env.DASHSCOPE_BASE_URL?.trim();
    const workspace = this.env.DASHSCOPE_WORKSPACE_ID?.trim();
    const candidate = explicit || (workspace && /^[A-Za-z0-9_-]+$/.test(workspace) ? `https://${workspace}.cn-beijing.maas.aliyuncs.com/api/v1` : 'https://dashscope.aliyuncs.com/api/v1');
    if (!candidate) return null;
    try {
      const url = new URL(candidate);
      const validHost = /^(?:dashscope(?:-intl|-us)?\.aliyuncs\.com|[a-zA-Z0-9_-]+\.(?:cn-beijing|ap-southeast-1|ap-northeast-1|eu-central-1|us-east-1|cn-hongkong)\.maas\.aliyuncs\.com)$/.test(url.hostname);
      if (url.protocol !== 'https:' || !validHost || url.username || url.password || url.port || url.search || url.hash) return null;
      const path = url.pathname.replace(/\/$/, '');
      if (path !== '' && path !== '/api/v1') return null;
      return `${url.origin}/api/v1`;
    } catch { return null; }
  }

  getConfiguration(): {
    wan: { configured: boolean; missing: string[] };
    upscale: { configured: boolean; missing: string[] };
  } {
    const wan: string[] = [];
    if (!this.env.DASHSCOPE_API_KEY?.trim()) wan.push('DASHSCOPE_API_KEY');
    if (!this.wanBase()) wan.push(this.env.DASHSCOPE_BASE_URL ? 'DASHSCOPE_BASE_URL' : 'DASHSCOPE_WORKSPACE_ID');
    const upscale = ['ALIYUN_ACCESS_KEY_ID', 'ALIYUN_ACCESS_KEY_SECRET'].filter(name => !this.env[name]?.trim());
    if (this.proxyUrl() === null) { wan.push('ALI_VIDEO_HTTPS_PROXY'); upscale.push('ALI_VIDEO_HTTPS_PROXY'); }
    return { wan: { configured: wan.length === 0, missing: wan }, upscale: { configured: upscale.length === 0, missing: upscale } };
  }

  private ensureConfigured(kind: 'wan' | 'upscale'): void {
    if (!this.getConfiguration()[kind].configured) {
      throw new AliVideoProviderError('PROVIDER_NOT_CONFIGURED', `${kind === 'wan' ? 'Wan 视频生成' : '视频超分'}尚未配置，请联系管理员`, 503);
    }
  }

  private async request(url: string, init: RequestInit): Promise<JsonObject> {
    let response: Response;
    try {
      // Only fixed Alibaba API requests use CONNECT; never change the global dispatcher.
      const options = { ...init, ...this.proxyOptions(), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' as const };
      response = await this.transport(url, options);
    } catch {
      throw new AliVideoProviderError('PROVIDER_UNREACHABLE', '暂时无法连接阿里服务，请稍后重试');
    }
    let body: JsonObject;
    try { body = asObject(await response.json()); }
    catch { throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '阿里服务返回了无法识别的响应'); }
    if (!response.ok || body.code || body.Code) {
      throw new AliVideoProviderError('UPSTREAM_ERROR', safeUpstreamMessage(body.code ?? body.Code));
    }
    return body;
  }

  async submitWan(input: WanVideoInput): Promise<{ taskId: string }> {
    this.ensureConfigured('wan');
    const body = await this.request(`${this.wanBase()}/services/aigc/video-generation/video-synthesis`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.env.DASHSCOPE_API_KEY}`, 'Content-Type': 'application/json', 'X-DashScope-Async': 'enable' },
      body: JSON.stringify({
        model: 'wan3.0-video',
        input: { prompt: input.prompt, ...(input.media?.length ? { media: input.media } : {}) },
        parameters: { resolution: input.resolution ?? '720P', duration: input.duration ?? 5, ratio: input.ratio ?? 'adaptive', audio: input.audio ?? true, prompt_extend: true },
      }),
    });
    const taskId = text(asObject(body.output).task_id);
    if (!taskId) throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '阿里服务未返回视频生成任务编号');
    return { taskId };
  }

  private async viapi(action: 'SuperResolveVideo' | 'GetAsyncJobResult' | 'GetOssStsToken', params: Record<string, string>): Promise<JsonObject> {
    this.ensureConfigured('upscale');
    const values: Record<string, string> = {
      Action: action, Version: action === 'GetOssStsToken' ? '2020-04-01' : '2020-03-20', Format: 'JSON', RegionId: 'cn-shanghai',
      AccessKeyId: this.env.ALIYUN_ACCESS_KEY_ID!, SignatureMethod: 'HMAC-SHA1', SignatureVersion: '1.0',
      SignatureNonce: randomUUID(), Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), ...params,
    };
    const canonical = Object.keys(values).sort().map(key => `${rpcEncode(key)}=${rpcEncode(values[key])}`).join('&');
    values.Signature = createHmac('sha1', `${this.env.ALIYUN_ACCESS_KEY_SECRET}&`).update(`POST&%2F&${rpcEncode(canonical)}`).digest('base64');
    return this.request(action === 'GetOssStsToken' ? 'https://viapiutils.cn-shanghai.aliyuncs.com/' : 'https://videoenhan.cn-shanghai.aliyuncs.com/', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(values).toString(),
    });
  }

  /** VIAPI accepts Shanghai OSS objects; server-owned COS uploads must first be transferred.
   * The platform's temporary bucket expires objects after one day and is for trial use.
   * Set ALIYUN_VIAPI_OSS_BUCKET to an owned Shanghai bucket for sustained use (RAM needs PutObject).
   */
  private async shanghaiVideo(input: string): Promise<string> {
    let source: URL;
    try { source = new URL(input); } catch { throw new AliVideoProviderError('INVALID_INPUT', '请上传有效的视频素材', 400); }
    if (source.protocol !== 'https:' || source.username || source.password || (source.port && source.port !== '443')) {
      throw new AliVideoProviderError('INVALID_INPUT', '请使用已上传的视频素材或上海 OSS 地址', 400);
    }
    if (/^[a-z0-9-]+\.oss-cn-shanghai\.aliyuncs\.com$/.test(source.hostname)) return input;
    // Do not add arbitrary server-side URL fetching: only fixed object-storage hosts and the official sample CDN.
    if (!/^[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com$/.test(source.hostname) &&
        !/^[a-z0-9-]+\.oss-[a-z0-9-]+\.aliyuncs\.com$/.test(source.hostname) && source.hostname !== 'help-static-aliyun-doc.aliyuncs.com') {
      throw new AliVideoProviderError('INVALID_INPUT', '请先上传视频素材，或使用上海 OSS 地址', 400);
    }
    const directory = await mkdtemp(join(tmpdir(), 'viapi-transfer-'));
    try {
      const path = join(directory, 'source.mp4');
      let response: Response;
      try { response = await this.transport(source.href, { redirect: 'error', signal: AbortSignal.timeout(120000) }); }
      catch { throw new AliVideoProviderError('MEDIA_TRANSFER_FAILED', '无法读取原视频，请重新上传后重试'); }
      if (!response.ok || !response.body) throw new AliVideoProviderError('MEDIA_TRANSFER_FAILED', '原视频地址已失效，请重新上传');
      if (Number(response.headers.get('content-length')) > 100 * 1024 * 1024) {
        await response.body.cancel();
        throw new AliVideoProviderError('INVALID_INPUT', '上传视频不能超过 100 MB', 413);
      }
      let bytes = 0;
      const limit = new Transform({ transform(chunk: Buffer, _encoding, next) {
        bytes += chunk.length;
        next(bytes > 100 * 1024 * 1024 ? new AliVideoProviderError('INVALID_INPUT', '上传视频不能超过 100 MB', 413) : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(path, { mode: 0o600 }));
      if (!bytes) throw new AliVideoProviderError('INVALID_INPUT', '不能上传空视频', 400);
      const bucket = this.env.ALIYUN_VIAPI_OSS_BUCKET?.trim() || 'viapi-customer-temp';
      if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) throw new AliVideoProviderError('PROVIDER_NOT_CONFIGURED', '上海 OSS 存储配置无效', 503);
      const token = bucket === 'viapi-customer-temp' ? asObject((await this.viapi('GetOssStsToken', {})).Data) : {
        AccessKeyId: this.env.ALIYUN_ACCESS_KEY_ID, AccessKeySecret: this.env.ALIYUN_ACCESS_KEY_SECRET,
      };
      const accessId = text(token.AccessKeyId), secret = text(token.AccessKeySecret), securityToken = text(token.SecurityToken);
      if (!accessId || !secret || (bucket === 'viapi-customer-temp' && !securityToken)) throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '未获取到上海 OSS 上传授权，请联系管理员');
      const key = `${this.env.ALIYUN_ACCESS_KEY_ID}/${randomUUID()}/source.mp4`;
      const date = new Date().toUTCString();
      const canonicalHeaders = securityToken ? `x-oss-security-token:${securityToken}\n` : '';
      const signature = createHmac('sha1', secret).update(`PUT\n\nvideo/mp4\n${date}\n${canonicalHeaders}/${bucket}/${key}`).digest('base64');
      const url = `https://${bucket}.oss-cn-shanghai.aliyuncs.com/${key}`;
      const stream = createReadStream(path);
      try {
        const uploaded = await this.mediaRequest(url, {
          method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes), Date: date, Authorization: `OSS ${accessId}:${signature}`, ...(securityToken ? { 'x-oss-security-token': securityToken } : {}) },
          body: stream as unknown as RequestInit['body'], duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(120000),
        } as RequestInit);
        if (!uploaded.ok) throw new AliVideoProviderError('MEDIA_TRANSFER_FAILED', '视频转存到上海 OSS 失败，请稍后重试');
        await uploaded.body?.cancel();
      } catch (error) {
        if (error instanceof AliVideoProviderError) throw error;
        throw new AliVideoProviderError('MEDIA_TRANSFER_FAILED', '视频转存到上海 OSS 失败，请稍后重试');
      } finally { stream.destroy(); }
      return url;
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async submitUpscale(input: { videoUrl: string; bitRate?: number }): Promise<{ taskId: string }> {
    this.ensureConfigured('upscale');
    const source = await this.shanghaiVideo(input.videoUrl);
    const body = await this.viapi('SuperResolveVideo', { VideoUrl: source, BitRate: String(input.bitRate ?? 10) });
    const taskId = text(body.RequestId);
    if (!taskId) throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '阿里服务未返回超分任务编号');
    return { taskId };
  }

  async fetchTask(kind: 'wan' | 'upscale', taskId: string): Promise<AliVideoTask> {
    this.ensureConfigured(kind);
    if (kind === 'wan') {
      const body = await this.request(`${this.wanBase()}/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${this.env.DASHSCOPE_API_KEY}` } });
      const output = asObject(body.output);
      switch (output.task_status) {
        case 'PENDING': return { status: 'pending' };
        case 'RUNNING': return { status: 'running' };
        case 'SUCCEEDED': return { status: 'succeeded', videoUrl: videoUrl(output.video_url) };
        case 'FAILED': return { status: 'failed', error: safeUpstreamMessage(output.code) };
        case 'CANCELED': return { status: 'canceled', error: '任务已取消' };
        default: return { status: 'unknown', error: '任务不存在或已过期，请重新提交' };
      }
    }
    const body = await this.viapi('GetAsyncJobResult', { JobId: taskId });
    const data = asObject(body.Data);
    switch (data.Status) {
      case 'QUEUING': return { status: 'pending' };
      case 'PROCESSING': return { status: 'running' };
      case 'PROCESS_SUCCESS': {
        let result: JsonObject;
        try { result = asObject(typeof data.Result === 'string' ? JSON.parse(data.Result) : data.Result); }
        catch { throw new AliVideoProviderError('INVALID_PROVIDER_RESPONSE', '阿里超分任务未返回可用的视频结果'); }
        return { status: 'succeeded', videoUrl: videoUrl(result.VideoUrl) };
      }
      case 'PROCESS_FAILED':
      case 'TIMEOUT_FAILED':
      case 'LIMIT_RETRY_FAILED': return { status: 'failed', error: safeUpstreamMessage(data.ErrorCode) };
      default: return { status: 'unknown', error: '超分任务不存在或已过期，请重新提交' };
    }
  }
}
