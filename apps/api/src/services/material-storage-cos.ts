// apps/api/src/services/material-storage-cos.ts
//
// MaterialStorage 的腾讯云 COS 实现。
//
// bucket 必须是**私有**的（zenithjoy-materials-1333590468，2026-09-04 建，已验证
// 不带签名访问返回 403）。绝不能换成 public-read 的 zenithjoy-static——那个 bucket
// 有链接就能拿，素材放进去等于公开客户的原片。
//
// 大文件走 sliceUploadFile（SDK 的分片上传）：2GB 单请求上传会超时、失败还得从头
// 再来；分片能续传，也不吃内存。

import COS from 'cos-nodejs-sdk-v5';
import type { MaterialStorage, PutObjectInput } from './material-storage';
import { DEFAULT_SIGNED_URL_TTL_SECONDS } from './material-storage';

/**
 * 超过这个大小走分片上传。
 * 2GB 单请求上传会超时，失败还得从头再来；分片能续传，也不吃内存。
 */
export const SLICE_THRESHOLD_BYTES = 20 * 1024 * 1024;

/** 纯函数：这个大小该不该走分片。抽出来是为了能在 CI 里真测到这个判断。 */
export function shouldSliceUpload(sizeBytes: number): boolean {
  return sizeBytes >= SLICE_THRESHOLD_BYTES;
}

export class CosMaterialStorage implements MaterialStorage {
  private readonly cos: COS;
  private readonly bucket: string;
  private readonly region: string;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.bucket = env.COS_BUCKET as string;
    this.region = env.COS_REGION as string;
    this.cos = new COS({
      SecretId: env.COS_SECRET_ID as string,
      SecretKey: env.COS_SECRET_KEY as string,
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    const fs = await import('node:fs');
    const { size } = await fs.promises.stat(input.filePath);
    const common = {
      Bucket: this.bucket,
      Region: this.region,
      Key: input.key,
      FilePath: input.filePath,
      ...(input.contentType ? { ContentType: input.contentType } : {}),
    };
    await new Promise<void>((resolve, reject) => {
      const cb = (err: unknown) => (err ? reject(err) : resolve());
      if (shouldSliceUpload(size)) {
        this.cos.sliceUploadFile(common as never, cb);
      } else {
        this.cos.putObject({ ...common, Body: fs.createReadStream(input.filePath) } as never, cb);
      }
    });
  }

  async getSignedUrl(key: string, expiresSeconds = DEFAULT_SIGNED_URL_TTL_SECONDS): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Sign: true,
          Expires: expiresSeconds,
        },
        (err, data) => (err ? reject(err) : resolve(data.Url)),
      );
    });
  }

  async deleteObject(key: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.cos.deleteObject(
        { Bucket: this.bucket, Region: this.region, Key: key },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  }
}
