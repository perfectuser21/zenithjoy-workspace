/**
 * 素材上传核心逻辑单测（纯逻辑层，不碰 COS 不碰 DB）。
 *
 * 这一层管三件事，每件都有明确的失败代价：
 *  1. 作品类型推断 —— 抖音的视频作品和图文作品是两种，混着传必须当场拒绝，
 *     否则错误会一路带到发布那一刻才炸。
 *  2. 去重键 —— 去重做在服务端而不是让客户端删相册：误删用户原片不可逆，
 *     而服务端去重后重复上传完全无害，iOS 定时任务可以放心全量跑。
 *  3. 存储 key —— 必须按租户分段且不可被文件名操纵，否则一个恶意文件名
 *     就能写到别的租户目录下。
 */
import { describe, it, expect } from 'vitest';
import {
  inferContentType,
  buildDedupeKey,
  buildStorageKey,
  sanitizeFileName,
  MAX_FILE_BYTES,
} from '../material-upload';

const IMG = { fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 100 };
const VID = { fileName: 'b.mp4', mimeType: 'video/mp4', sizeBytes: 200 };

describe('inferContentType — 作品类型从素材推断，不让客户端指定', () => {
  it('全是图 → image', () => {
    expect(inferContentType([IMG, IMG])).toBe('image');
  });

  it('单个视频 → video', () => {
    expect(inferContentType([VID])).toBe('video');
  });

  it('视频和图片混传 → 抛错（抖音的两种作品形态不能混）', () => {
    expect(() => inferContentType([VID, IMG])).toThrow(/混/);
  });

  it('空数组 → 抛错（没有素材就没有作品）', () => {
    expect(() => inferContentType([])).toThrow();
  });

  it('多个视频 → video（允许，混剪素材就是多段视频）', () => {
    expect(inferContentType([VID, VID])).toBe('video');
  });
});

describe('buildDedupeKey — 同一个文件传一百次，库里只有一条', () => {
  const base = {
    tenantId: 't1',
    fileName: 'IMG_0001.MOV',
    sizeBytes: 12345,
    takenAt: '2026-09-04T10:00:00Z',
    contentHash: undefined as string | undefined,
  };

  it('有内容 hash 时优先用 hash —— 改了文件名也认得出是同一个', () => {
    const a = buildDedupeKey({ ...base, contentHash: 'abc123' });
    const b = buildDedupeKey({ ...base, fileName: '完全不同的名字.mov', contentHash: 'abc123' });
    expect(a).toBe(b);
  });

  it('没有 hash 时退回 文件名+大小+拍摄时间 组合', () => {
    const a = buildDedupeKey(base);
    const b = buildDedupeKey({ ...base });
    expect(a).toBe(b);
  });

  it('大小不同 → 不同的键（同名但内容变了，是新素材）', () => {
    expect(buildDedupeKey(base)).not.toBe(buildDedupeKey({ ...base, sizeBytes: 999 }));
  });

  it('租户不同 → 一定不同的键（绝不能跨租户命中彼此的素材）', () => {
    expect(buildDedupeKey(base)).not.toBe(buildDedupeKey({ ...base, tenantId: 't2' }));
  });

  it('租户不同但 hash 相同 → 仍然是不同的键', () => {
    const a = buildDedupeKey({ ...base, contentHash: 'same' });
    const b = buildDedupeKey({ ...base, tenantId: 't2', contentHash: 'same' });
    expect(a).not.toBe(b);
  });
});

describe('sanitizeFileName — 文件名来自客户端，一律当敌意输入', () => {
  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32', 'system32'],
    ['/absolute/path.mp4', 'path.mp4'],
    ['normal.mp4', 'normal.mp4'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('空名或全是分隔符 → 给个兜底名，不返回空串', () => {
    expect(sanitizeFileName('')).not.toBe('');
    expect(sanitizeFileName('///')).not.toBe('');
  });

  it('保留中文名（客户的素材名经常是中文）', () => {
    expect(sanitizeFileName('我的视频.mp4')).toBe('我的视频.mp4');
  });
});

describe('buildStorageKey — 按租户分段，且不可被文件名操纵', () => {
  it('key 以租户 id 开头 —— 存储层天然按租户隔离', () => {
    const key = buildStorageKey({ tenantId: 'tenant-a', materialId: 'm1', fileName: 'x.mp4' });
    expect(key.startsWith('tenant-a/')).toBe(true);
  });

  it('路径穿越的文件名不能逃出租户目录', () => {
    const key = buildStorageKey({
      tenantId: 'tenant-a',
      materialId: 'm1',
      fileName: '../../tenant-b/steal.mp4',
    });
    expect(key.startsWith('tenant-a/')).toBe(true);
    expect(key).not.toContain('..');
    expect(key).not.toContain('tenant-b');
  });

  it('同名文件不会互相覆盖（key 里带 material id）', () => {
    const k1 = buildStorageKey({ tenantId: 't', materialId: 'm1', fileName: 'same.mp4' });
    const k2 = buildStorageKey({ tenantId: 't', materialId: 'm2', fileName: 'same.mp4' });
    expect(k1).not.toBe(k2);
  });
});

describe('MAX_FILE_BYTES', () => {
  it('单文件上限 2GB —— iPhone 4K 长片够用，又挡得住异常输入', () => {
    expect(MAX_FILE_BYTES).toBe(2 * 1024 * 1024 * 1024);
  });
});
