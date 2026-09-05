// apps/api/src/services/material-storage.ts
//
// 素材对象存储抽象层。
//
// ── 为什么要这层抽象 ──────────────────────────────────────────────────
// 上传端点是所有入口（iPhone 快捷指令 / 小程序 / 电脑 agent）唯一认识的地址，
// 存储实现藏在它背后。今天是 COS，明天换别的，**客户端一行都不用改**——这正是
// 「只维护一个入口」的价值所在。
// 同时这层让上传逻辑在 CI 里可测：测试注入内存实现，不需要真的碰 COS。
//
// ── 私有 bucket ──────────────────────────────────────────────────────
// 素材 bucket 必须是私有的（zenithjoy-materials-1333590468，已验证不带签名访问
// 返回 403）。绝不能用 public-read 的 zenithjoy-static——那个 bucket 里的东西
// 有链接就能拿，素材放进去等于公开客户的原片。
// 所以对外给的一律是**服务端签发的临时 URL**，不是长期地址。

import fs from 'node:fs';

export interface PutObjectInput {
  key: string;
  /** 本地临时文件路径。大文件走磁盘不走内存——2GB 进内存会直接把进程打爆。 */
  filePath: string;
  contentType?: string;
}

/** HEAD 结果。对象不存在时返回 null，绝不用 0 或 undefined 蒙混。 */
export interface HeadObjectResult {
  sizeBytes: number;
}

export interface MaterialStorage {
  putObject(input: PutObjectInput): Promise<void>;
  /** 签发临时访问 URL。默认 1 小时——够小程序显示缩略图、够安卓端下完素材。 */
  getSignedUrl(key: string, expiresSeconds?: number): Promise<string>;
  deleteObject(key: string): Promise<void>;

  /**
   * 签发一个【只对这一个 key 有效】的 PUT 地址。
   *
   * 为什么是预签名 URL 而不是下发临时密钥：临时密钥要求客户端自己算 HMAC 签名，
   * 而 iOS 快捷指令没有这个动作——三个入口会立刻分裂成两套。预签名 URL 让客户端
   * 只需发一个普通 PUT，能力更弱因而更安全：作用域是单个对象而非租户前缀，
   * 客户端从不持有密钥，跨租户越权物理上不可能。（decision 03660929）
   */
  presignPut(key: string, expiresSeconds?: number): Promise<string>;

  /** 对象存不存在、多大。不存在返回 null。 */
  headObject(key: string): Promise<HeadObjectResult | null>;
}

export const DEFAULT_SIGNED_URL_TTL_SECONDS = 3600;

/** 预签名 URL 默认有效期 2 小时——几百兆视频在移动网络上传得慢，给足余量。 */
export const DEFAULT_PRESIGN_TTL_SECONDS = 7200;

/**
 * 内存实现：单测和本地开发用。不落盘、不联网。
 * 签发的「URL」只是个可辨认的占位串，测试断言用。
 */
export class InMemoryMaterialStorage implements MaterialStorage {
  private readonly objects = new Map<string, { bytes: Buffer; contentType?: string }>();

  async putObject(input: PutObjectInput): Promise<void> {
    const bytes = await fs.promises.readFile(input.filePath);
    this.objects.set(input.key, { bytes, contentType: input.contentType });
  }

  async getSignedUrl(key: string, expiresSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS): Promise<string> {
    return `memory://${key}?expires=${expiresSeconds}`;
  }

  async deleteObject(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async presignPut(key: string, expiresSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    return `memory://put/${key}?expires=${expiresSeconds}`;
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.bytes.length } : null;
  }

  // ── 测试辅助 ──
  has(key: string): boolean {
    return this.objects.has(key);
  }

  size(): number {
    return this.objects.size;
  }

  read(key: string): Buffer | undefined {
    return this.objects.get(key)?.bytes;
  }
}

/**
 * 读环境变量决定用哪个实现。
 *
 * 未配置 COS 时回落到内存实现并**打一条明确的警告**——绝不静默假装成功，
 * 否则生产上配漏了会表现为「上传都成功了但素材全丢」，这类静默失败最难查
 * （见 memory: failure-without-reason-pattern）。
 */
let warnedNoCos = false;

export function isCosConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.COS_SECRET_ID && env.COS_SECRET_KEY && env.COS_BUCKET && env.COS_REGION);
}

export function createMaterialStorage(env: NodeJS.ProcessEnv = process.env): MaterialStorage {
  if (!isCosConfigured(env)) {
    if (!warnedNoCos) {
      warnedNoCos = true;
      console.warn(
        '[material-storage] COS 未配置（需 COS_SECRET_ID/COS_SECRET_KEY/COS_BUCKET/COS_REGION），' +
          '回落到内存实现——素材不会真正持久化。生产环境必须配置。',
      );
    }
    return new InMemoryMaterialStorage();
  }
  // 真实 COS 实现在 material-storage-cos.ts。这里用同步 require 的等价写法保持
  // 工厂是同步的（调用方在路由构造期用，不方便 await），同时避免测试环境加载 SDK。
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CosMaterialStorage } = require('./material-storage-cos') as typeof import('./material-storage-cos');
  return new CosMaterialStorage(env);
}

/** 测试辅助：重置 warn flag。 */
export function __resetStorageWarnFlag(): void {
  warnedNoCos = false;
}
