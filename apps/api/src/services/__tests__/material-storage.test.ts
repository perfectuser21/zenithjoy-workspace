/**
 * 存储抽象层单测。
 *
 * 这层的价值是「上传端点不认识具体存储」——今天 COS 明天换别的，客户端一行不改。
 * 所以这里要守的是抽象本身的行为，以及**未配置时绝不静默假装成功**：
 * 生产上 COS 配漏了会表现为「上传都返回 200 但素材全丢」，这类静默失败最难查。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  InMemoryMaterialStorage,
  isCosConfigured,
  createMaterialStorage,
  __resetStorageWarnFlag,
  DEFAULT_SIGNED_URL_TTL_SECONDS,
} from '../material-storage';

const FULL_ENV = {
  COS_SECRET_ID: 'id',
  COS_SECRET_KEY: 'key',
  COS_BUCKET: 'bucket',
  COS_REGION: 'ap-guangzhou',
} as NodeJS.ProcessEnv;

describe('isCosConfigured — 四个变量缺一不可', () => {
  it('四个都在 → true', () => {
    expect(isCosConfigured(FULL_ENV)).toBe(true);
  });

  it.each(['COS_SECRET_ID', 'COS_SECRET_KEY', 'COS_BUCKET', 'COS_REGION'])(
    '缺 %s → false',
    (missing) => {
      const env = { ...FULL_ENV };
      delete env[missing as keyof NodeJS.ProcessEnv];
      expect(isCosConfigured(env)).toBe(false);
    },
  );

  it('空字符串等同于没配（防 .env 里写了个空值就当配好了）', () => {
    expect(isCosConfigured({ ...FULL_ENV, COS_BUCKET: '' })).toBe(false);
  });
});

describe('createMaterialStorage — 未配置时必须吵，不能静默', () => {
  beforeEach(() => __resetStorageWarnFlag());
  afterEach(() => vi.restoreAllMocks());

  it('COS 未配置 → 回落内存实现，并打警告', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createMaterialStorage({} as NodeJS.ProcessEnv);

    expect(storage).toBeInstanceOf(InMemoryMaterialStorage);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('COS 未配置');
  });

  it('警告只打一次，不刷屏', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    createMaterialStorage({} as NodeJS.ProcessEnv);
    createMaterialStorage({} as NodeJS.ProcessEnv);
    createMaterialStorage({} as NodeJS.ProcessEnv);

    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('InMemoryMaterialStorage', () => {
  let tmpFile: string;

  beforeEach(async () => {
    tmpFile = path.join(os.tmpdir(), `zjtest-${Date.now()}-${Math.random()}`);
    await fs.promises.writeFile(tmpFile, 'hello-material');
  });

  afterEach(async () => {
    await fs.promises.unlink(tmpFile).catch(() => {});
  });

  it('putObject 真的把文件内容读进来了（不是只记了个路径）', async () => {
    const s = new InMemoryMaterialStorage();
    await s.putObject({ key: 't/1/a.txt', filePath: tmpFile });

    expect(s.has('t/1/a.txt')).toBe(true);
    expect(s.read('t/1/a.txt')?.toString()).toBe('hello-material');
  });

  it('同 key 覆盖不会变成两条', async () => {
    const s = new InMemoryMaterialStorage();
    await s.putObject({ key: 'same', filePath: tmpFile });
    await s.putObject({ key: 'same', filePath: tmpFile });

    expect(s.size()).toBe(1);
  });

  it('deleteObject 删得掉', async () => {
    const s = new InMemoryMaterialStorage();
    await s.putObject({ key: 'k', filePath: tmpFile });
    await s.deleteObject('k');

    expect(s.has('k')).toBe(false);
  });

  it('签发的 URL 带上有效期（默认 1 小时）', async () => {
    const s = new InMemoryMaterialStorage();
    const url = await s.getSignedUrl('k');

    expect(url).toContain(String(DEFAULT_SIGNED_URL_TTL_SECONDS));
  });

  it('默认有效期是 1 小时 —— 够小程序显示缩略图、够安卓端下完素材', () => {
    expect(DEFAULT_SIGNED_URL_TTL_SECONDS).toBe(3600);
  });
});

describe('InMemoryMaterialStorage — 直传两个新能力', () => {
  it('presignPut 返回可辨认的 URL，且带上 key 与过期秒数', async () => {
    const s = new InMemoryMaterialStorage();
    const url = await s.presignPut('t1/m1/a.jpg', 7200);
    expect(url).toContain('t1/m1/a.jpg');
    expect(url).toContain('7200');
  });

  it('headObject 对不存在的对象返回 null——绝不假装它在', async () => {
    const s = new InMemoryMaterialStorage();
    expect(await s.headObject('t1/m1/missing.jpg')).toBeNull();
  });

  it('headObject 对已存在的对象返回真实大小', async () => {
    const s = new InMemoryMaterialStorage();
    const tmp = path.join(os.tmpdir(), `zj-head-${Date.now()}.bin`);
    fs.writeFileSync(tmp, Buffer.alloc(1234));
    await s.putObject({ key: 't1/m1/a.bin', filePath: tmp });
    expect(await s.headObject('t1/m1/a.bin')).toEqual({ sizeBytes: 1234 });
    fs.unlinkSync(tmp);
  });
});
