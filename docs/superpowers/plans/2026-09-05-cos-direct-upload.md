# 素材 COS 直传（预签名 URL）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让三个入口（iOS 快捷指令 / 微信小程序 / Windows agent）用同一套协议，把素材直传广州 COS，不再绕香港中台。

**Architecture:** 服务端签发**只对单个对象路径有效**的预签名 PUT URL，客户端裸 PUT（零签名代码），再回调 `/complete`；服务端 HEAD 校验对象真存在且大小匹配后才落库。落库逻辑抽成 `material-persist.ts`，直传与老端点共用，杜绝两套行为漂移。

**Tech Stack:** TypeScript / Express / vitest / PostgreSQL(pg) / `cos-nodejs-sdk-v5`（已有依赖，**不新增**）

**Spec:** `docs/superpowers/specs/2026-09-05-cos-direct-upload-design.md`

**工作目录:** `/Users/administrator/worktrees/zenithjoy-workspace/cos-direct-upload`（分支 `cp-0905093007-cos-direct-upload`）

**每个 Task 的 commit 纪律（CI 硬闸 `lint-tdd-commit-order.sh`）：**
commit-1 只含红测试 → commit-2 含实现。**禁止把测试和实现放同一个 commit。**

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `apps/api/src/services/material-upload.ts` | 纯函数：类型推断 / 去重键 / 存储 key | 改：删 `contentHash` 分支 |
| `apps/api/src/services/material-storage.ts` | 存储抽象 + 内存实现 | 改：加 `presignPut` / `headObject` |
| `apps/api/src/services/material-storage-cos.ts` | COS 实现 | 改：实现上述两方法 |
| `apps/api/src/services/material-persist.ts` | **落库**（materials+contents+content_materials） | **新建** |
| `apps/api/src/routes/materials.ts` | 三端点 | 改 |
| `apps/api/db/migrations/20260905_103000_materials_uploader.sql` | 加 `uploaded_by_license_id` 列 | **新建** |
| `services/agent/src/core-upgrader.ts` 等 4 个文件 | 下载域名 | 改：`cos.accelerate` → `cos.ap-guangzhou` |
| `services/agent/src/__tests__/cos-endpoint.test.ts` | 守卫：源码里不许再出现 `cos.accelerate` | **新建** |
| `.github/workflows/scripts/smoke/material-direct-upload-smoke.sh` | 真链路 smoke | **新建** |
| `test-registry.yaml` | 新测试登记 | 改 |

---

## Task 1: 去重键去掉内容哈希

**背景（不要跳过）：** 直传拿不到文件内容，算不了哈希。若只让直传用元数据、老端点继续用哈希，**同一张照片走两个入口会得到两个不同的去重键，在库里存两份**——这正是本次要消灭的不一致。所以纯函数层先统一。

**Files:**
- Modify: `apps/api/src/services/material-upload.ts`
- Test: `apps/api/src/services/__tests__/material-upload.test.ts`

- [ ] **Step 1: 写失败测试**

在 `material-upload.test.ts` 末尾追加：

```ts
describe('buildDedupeKey — 统一元数据口径（不含内容哈希）', () => {
  it('同一文件经两个入口（一个曾能算哈希、一个不能）得到同一个键', () => {
    const meta = {
      tenantId: 't1',
      fileName: 'IMG_0001.MOV',
      sizeBytes: 12345,
      takenAt: '2026-09-05T00:00:00Z',
    };
    expect(buildDedupeKey(meta)).toBe(buildDedupeKey({ ...meta }));
  });

  it('DedupeKeyInput 不再接受 contentHash（多塞该字段不改变结果）', () => {
    const base = { tenantId: 't1', fileName: 'a.jpg', sizeBytes: 1, takenAt: 'x' };
    const withExtra = { ...base, contentHash: 'deadbeef' } as never;
    expect(buildDedupeKey(withExtra)).toBe(buildDedupeKey(base));
  });

  it('租户仍然进键：不同租户同名同大小不撞', () => {
    const a = { tenantId: 'A', fileName: 'x.jpg', sizeBytes: 9 };
    const b = { tenantId: 'B', fileName: 'x.jpg', sizeBytes: 9 };
    expect(buildDedupeKey(a)).not.toBe(buildDedupeKey(b));
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-upload.test.ts -t "不再接受 contentHash"`

Expected: FAIL —— 现在带 `contentHash` 会走 `['h', tenantId, contentHash]` 分支，结果与不带时不同。

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add apps/api/src/services/__tests__/material-upload.test.ts
git commit -m "test(materials): 去重键必须统一元数据口径——两入口同文件应得同一个键"
```

- [ ] **Step 4: 改实现**

`material-upload.ts` 里把 `DedupeKeyInput` 与 `buildDedupeKey` 整体替换为：

```ts
export interface DedupeKeyInput {
  tenantId: string;
  fileName: string;
  sizeBytes: number;
  takenAt?: string;
}

/**
 * 去重键 = 租户 + 文件名 + 大小 + 拍摄时间。
 *
 * ── 为什么不用内容哈希（三条路都堵死了，见 decision 10a0b732 / 03660929）──
 *  1. 客户端算 → iOS 快捷指令没有哈希动作，一旦让小程序算、快捷指令不算，
 *     三个入口就分裂成两套，「一套方案」当场破产
 *  2. 服务端靠 COS ETag → 实测否决：分片上传的 ETag 既不是内容哈希，
 *     同一份内容传两次还得到不同值（35bfaef0…-2 vs 366f7f65…-2），
 *     而视频走的正是分片
 *  3. 服务端下载回来算 → 几百兆下行要付流量费，且慢
 *
 * 代价（明确接受）：用户手动改文件名后重传会存两份。不是数据错误，只是多占
 * 空间；存储 0.118 元/GB/月，不值得为它牺牲入口统一性。
 *
 * 租户永远进键：绝不能出现 A 租户传的文件命中 B 租户已有素材——那会让 A
 * 拿到 B 的素材 id。
 */
export function buildDedupeKey(input: DedupeKeyInput): string {
  const parts = ['m', input.tenantId, input.fileName, String(input.sizeBytes), input.takenAt ?? ''];
  return crypto.createHash('sha256').update(parts.join(' ')).digest('hex');
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-upload.test.ts`

Expected: PASS

- [ ] **Step 6: 提交实现（commit-2）**

```bash
git add apps/api/src/services/material-upload.ts
git commit -m "feat(materials): 去重键统一为元数据口径，移除内容哈希分支"
```

---

## Task 2: 存储抽象加 presignPut / headObject

**Files:**
- Modify: `apps/api/src/services/material-storage.ts`
- Test: `apps/api/src/services/__tests__/material-storage.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `material-storage.test.ts`（该文件已 import `fs`/`os`/`path`）：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-storage.test.ts -t "直传两个新能力"`

Expected: FAIL with "s.presignPut is not a function"

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add apps/api/src/services/__tests__/material-storage.test.ts
git commit -m "test(materials): 存储抽象需要 presignPut/headObject"
```

- [ ] **Step 4: 改实现**

`material-storage.ts` 在 `PutObjectInput` 之后加：

```ts
/** HEAD 结果。对象不存在时返回 null，绝不用 0 或 undefined 蒙混。 */
export interface HeadObjectResult {
  sizeBytes: number;
}

/** 预签名 URL 默认有效期 2 小时——几百兆视频在移动网络上传得慢，给足余量。 */
export const DEFAULT_PRESIGN_TTL_SECONDS = 7200;
```

`MaterialStorage` 接口加两个方法：

```ts
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
```

`InMemoryMaterialStorage` 类里加：

```ts
  async presignPut(key: string, expiresSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    return `memory://put/${key}?expires=${expiresSeconds}`;
  }

  async headObject(key: string): Promise<HeadObjectResult | null> {
    const o = this.objects.get(key);
    return o ? { sizeBytes: o.bytes.length } : null;
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-storage.test.ts`

Expected: PASS

- [ ] **Step 6: 提交实现（commit-2）**

```bash
git add apps/api/src/services/material-storage.ts
git commit -m "feat(materials): 存储抽象加 presignPut/headObject 及内存实现"
```

---

## Task 3: COS 侧实现 presignPut / headObject

**Files:**
- Modify: `apps/api/src/services/material-storage-cos.ts`
- Test: `apps/api/src/services/__tests__/material-storage-cos.test.ts`

**注意：** 这里不连真 COS——真链路由 Task 8 的 smoke 验。单测只验参数拼装，用 `vi.mock` 打桩 SDK。

- [ ] **Step 1: 写失败测试**

追加到 `material-storage-cos.test.ts`：

```ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

const getObjectUrl = vi.fn();
const headObjectFn = vi.fn();
vi.mock('cos-nodejs-sdk-v5', () => ({
  default: class {
    getObjectUrl = getObjectUrl;
    headObject = headObjectFn;
  },
}));

const ENV = {
  COS_SECRET_ID: 'id', COS_SECRET_KEY: 'key',
  COS_BUCKET: 'b', COS_REGION: 'ap-guangzhou',
} as NodeJS.ProcessEnv;

describe('CosMaterialStorage.presignPut', () => {
  beforeEach(() => { getObjectUrl.mockReset(); });

  it('用 Method=PUT 且 Sign=true 签发，过期秒数透传', async () => {
    getObjectUrl.mockImplementation((_p: unknown, cb: (e: unknown, d: { Url: string }) => void) =>
      cb(null, { Url: 'https://cos/x?sig=1' }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    const url = await new CosMaterialStorage(ENV).presignPut('t1/m1/a.jpg', 7200);
    expect(url).toBe('https://cos/x?sig=1');
    const params = getObjectUrl.mock.calls[0][0];
    expect(params.Method).toBe('PUT');
    expect(params.Sign).toBe(true);
    expect(params.Key).toBe('t1/m1/a.jpg');
    expect(params.Expires).toBe(7200);
  });
});

describe('CosMaterialStorage.headObject', () => {
  beforeEach(() => { headObjectFn.mockReset(); });

  it('对象存在 → 返回真实大小', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown, d: unknown) => void) =>
      cb(null, { headers: { 'content-length': '4096' } }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    expect(await new CosMaterialStorage(ENV).headObject('t1/m1/a.jpg')).toEqual({ sizeBytes: 4096 });
  });

  it('404 → 返回 null，不抛异常', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown) => void) => cb({ statusCode: 404 }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    expect(await new CosMaterialStorage(ENV).headObject('t1/m1/missing.jpg')).toBeNull();
  });

  it('非 404 的错误必须抛出——不能把网络故障当成「文件不存在」', async () => {
    headObjectFn.mockImplementation((_p: unknown, cb: (e: unknown) => void) =>
      cb({ statusCode: 503, message: 'service unavailable' }));
    const { CosMaterialStorage } = await import('../material-storage-cos');
    await expect(new CosMaterialStorage(ENV).headObject('t1/m1/a.jpg')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-storage-cos.test.ts -t "presignPut"`

Expected: FAIL with "presignPut is not a function"

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add apps/api/src/services/__tests__/material-storage-cos.test.ts
git commit -m "test(materials): COS 侧 presignPut/headObject

第三条最要紧：非 404 的错误必须抛出。把 503 当成「文件不存在」会让
complete 阶段误判成上传失败，把本来传成功的素材丢掉。"
```

- [ ] **Step 4: 改实现**

`material-storage-cos.ts` 的 import 补 `DEFAULT_PRESIGN_TTL_SECONDS` 与 `HeadObjectResult`，类里加：

```ts
  /**
   * 签一个只对这一个 key 有效的 PUT 地址。客户端拿到后裸 PUT 即可，
   * 不需要任何签名能力——iOS 快捷指令用「获取 URL 内容」就能传。
   */
  async presignPut(key: string, expiresSeconds = DEFAULT_PRESIGN_TTL_SECONDS): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      this.cos.getObjectUrl(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
          Method: 'PUT',
          Sign: true,
          Expires: expiresSeconds,
        } as never,
        (err: unknown, data: { Url: string }) => (err ? reject(err) : resolve(data.Url)),
      );
    });
  }

  /**
   * 对象存不存在、多大。
   *
   * 404 → null（正常的「没传上来」）。其余错误一律抛出——把 503 之类的网络
   * 故障当成「文件不存在」，会让 complete 误判成上传失败，把本来传成功的
   * 素材丢掉。
   */
  async headObject(key: string): Promise<HeadObjectResult | null> {
    return new Promise<HeadObjectResult | null>((resolve, reject) => {
      this.cos.headObject(
        { Bucket: this.bucket, Region: this.region, Key: key } as never,
        (err: unknown, data: { headers?: Record<string, string> }) => {
          if (err) {
            const status = (err as { statusCode?: number }).statusCode;
            if (status === 404) return resolve(null);
            return reject(err);
          }
          const len = Number(data?.headers?.['content-length'] ?? NaN);
          if (!Number.isFinite(len)) {
            return reject(new Error(`COS headObject 未返回 content-length：${key}`));
          }
          resolve({ sizeBytes: len });
        },
      );
    });
  }
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-storage-cos.test.ts`

Expected: PASS

- [ ] **Step 6: 提交实现（commit-2）**

```bash
git add apps/api/src/services/material-storage-cos.ts
git commit -m "feat(materials): COS 实现 presignPut/headObject"
```

---

## Task 4: 迁移——materials 加 uploaded_by_license_id

**Files:**
- Create: `apps/api/db/migrations/20260905_103000_materials_uploader.sql`

**为什么：** 现在只记 `tenant_id`。同一客户下多名员工各配了快捷指令时，后端分不清素材来自谁。现在加列远比以后回填便宜。

- [ ] **Step 1: 写迁移**

```sql
-- materials 加上传者：现在只记 tenant_id，同一客户下多名员工各配快捷指令时
-- 分不清素材来自谁。可空——老数据没有这个信息，不编造。
ALTER TABLE zenithjoy.materials
  ADD COLUMN IF NOT EXISTS uploaded_by_license_id UUID;

CREATE INDEX IF NOT EXISTS materials_uploader_idx
  ON zenithjoy.materials (tenant_id, uploaded_by_license_id, created_at DESC);

COMMENT ON COLUMN zenithjoy.materials.uploaded_by_license_id IS
  '哪张 license 传的。可空：老数据无此信息。租户隔离仍以 tenant_id 为准，本列只用于区分同租户内的来源。';
```

- [ ] **Step 2: 本地验证迁移能跑**

Run:
```bash
psql -d zenithjoy_test -f apps/api/db/migrations/20260905_103000_materials_uploader.sql
psql -d zenithjoy_test -c "\d zenithjoy.materials" | grep uploaded_by
```

Expected: 输出含 `uploaded_by_license_id | uuid`

- [ ] **Step 3: 提交**

```bash
git add apps/api/db/migrations/20260905_103000_materials_uploader.sql
git commit -m "feat(db): materials 加 uploaded_by_license_id"
```

---

## Task 5: material-persist.ts —— 直传与老端点共用的落库

**Files:**
- Create: `apps/api/src/services/material-persist.ts`
- Test: `apps/api/src/services/__tests__/material-persist.test.ts`

**为什么单独一个文件：** 落库逻辑现在有两个调用方（`/complete` 和 `/upload`）。留在路由里必然被复制一份，复制就会漂移——那正是本次要消灭的问题。

- [ ] **Step 1: 写失败测试**

新建 `apps/api/src/services/__tests__/material-persist.test.ts`：

```ts
/**
 * 落库层单测。用假 pool 打桩，只验「写了什么」，不连真库——真链路由 smoke 验。
 * 这层的价值是：直传和老端点共用它，两个入口的落库行为不可能漂移。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../db/connection', () => ({ default: { query } }));

const BASE = {
  tenantId: 'tenant-a',
  licenseId: 'lic-1',
  contentType: 'image' as const,
  title: '标题',
  body: null,
  platforms: ['douyin'],
};

function itemsOf(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    materialId: `m${i}`,
    storageKey: `tenant-a/m${i}/f${i}.jpg`,
    fileName: `f${i}.jpg`,
    mimeType: 'image/jpeg',
    sizeBytes: 100 + i,
    takenAt: undefined,
    dedupeKey: `dk${i}`,
  }));
}

describe('persistMaterials', () => {
  beforeEach(() => { query.mockReset(); });

  it('每个素材插一条 materials，并写入 uploaded_by_license_id', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [{ id: 'new-id' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    const out = await persistMaterials({ ...BASE, items: itemsOf(2) });

    const matInserts = query.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO zenithjoy.materials'));
    expect(matInserts).toHaveLength(2);
    // 参数顺序：id, tenant_id, storage_key, file_name, mime_type, size_bytes,
    //           dedupe_key, taken_at, uploaded_by_license_id
    expect(matInserts[0][1][8]).toBe('lic-1');
    expect(out.contentId).toBe('content-1');
    expect(out.materials.every((m) => m.deduped === false)).toBe(true);
  });

  it('命中去重时拿回已有 id 并标 deduped，不再插第二条', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [] };
      if (sql.includes('SELECT id FROM zenithjoy.materials')) return { rows: [{ id: 'existing' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'content-1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    const out = await persistMaterials({ ...BASE, items: itemsOf(1) });
    expect(out.materials[0]).toMatchObject({ id: 'existing', deduped: true });
  });

  it('建一条 contents 并按顺序挂满关联', async () => {
    query.mockImplementation((sql: string) => {
      if (sql.includes('INSERT INTO zenithjoy.materials')) return { rows: [{ id: 'x' }] };
      if (sql.includes('INSERT INTO zenithjoy.contents')) return { rows: [{ id: 'c1' }] };
      return { rows: [] };
    });
    const { persistMaterials } = await import('../material-persist');
    await persistMaterials({ ...BASE, items: itemsOf(3) });
    const links = query.mock.calls.filter((c) => String(c[0]).includes('content_materials'));
    expect(links).toHaveLength(3);
    expect(links.map((l) => l[1][2])).toEqual([0, 1, 2]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-persist.test.ts`

Expected: FAIL —— 模块不存在

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add apps/api/src/services/__tests__/material-persist.test.ts
git commit -m "test(materials): 共用落库层

落库逻辑现在有两个调用方（/complete 和 /upload）。留在路由里必然被复制，
复制就会漂移——那正是本次要消灭的问题。"
```

- [ ] **Step 4: 写实现**

新建 `apps/api/src/services/material-persist.ts`：

```ts
// apps/api/src/services/material-persist.ts
//
// 素材落库：一次上传做三件事
//   ① 每个文件插一条 materials（进素材池）
//   ② 建一条 contents（成组，传完就是一个作品，可以直接发）
//   ③ 插 N 条 content_materials 关联
//
// ── 为什么单独一个文件 ────────────────────────────────────────────────
// 直传（/complete）和老端点（/upload）都要落库。留在路由里必然被复制一份，
// 复制就会漂移——同一张照片走两个入口得到不一致的结果，正是本次要消灭的问题。

import pool from '../db/connection';

export interface PersistItem {
  materialId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  takenAt?: string;
  dedupeKey: string;
}

export interface PersistInput {
  tenantId: string;
  /** 哪张 license 传的。用于区分同租户内的来源；租户隔离仍以 tenantId 为准。 */
  licenseId: string;
  contentType: 'video' | 'image';
  title: string | null;
  body: string | null;
  platforms: string[];
  items: PersistItem[];
}

export interface PersistedMaterial {
  id: string;
  file_name: string;
  deduped: boolean;
}

export interface PersistResult {
  contentId: string;
  materials: PersistedMaterial[];
}

export async function persistMaterials(input: PersistInput): Promise<PersistResult> {
  const materials: PersistedMaterial[] = [];

  for (const it of input.items) {
    // ON CONFLICT DO NOTHING：命中唯一索引说明这个素材已经传过了。
    // 去重做在服务端而不是让客户端删相册——误删原片不可逆，而服务端去重后
    // 重复上传完全无害，iOS 定时任务可以放心每小时全量跑一遍。
    const ins = await pool.query(
      `INSERT INTO zenithjoy.materials
         (id, tenant_id, storage_key, file_name, mime_type, size_bytes,
          dedupe_key, taken_at, uploaded_by_license_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [
        it.materialId, input.tenantId, it.storageKey, it.fileName, it.mimeType,
        it.sizeBytes, it.dedupeKey, it.takenAt ?? null, input.licenseId,
      ],
    );

    if (ins.rows.length === 0) {
      const existing = await pool.query(
        `SELECT id FROM zenithjoy.materials WHERE dedupe_key = $1 AND tenant_id = $2`,
        [it.dedupeKey, input.tenantId],
      );
      materials.push({
        id: existing.rows[0]?.id ?? it.materialId,
        file_name: it.fileName,
        deduped: true,
      });
      continue;
    }
    materials.push({ id: ins.rows[0].id, file_name: it.fileName, deduped: false });
  }

  const contentIns = await pool.query(
    `INSERT INTO zenithjoy.contents (tenant_id, title, body, type, platforms, status)
     VALUES ($1,$2,$3,$4,$5,'draft') RETURNING id`,
    [input.tenantId, input.title, input.body, input.contentType, input.platforms],
  );
  const contentId = contentIns.rows[0].id;

  for (let i = 0; i < materials.length; i++) {
    await pool.query(
      `INSERT INTO zenithjoy.content_materials (content_id, material_id, sort_order)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [contentId, materials[i].id, i],
    );
  }

  return { contentId, materials };
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/services/__tests__/material-persist.test.ts`

Expected: PASS（3 条）

- [ ] **Step 6: 提交实现（commit-2）**

```bash
git add apps/api/src/services/material-persist.ts
git commit -m "feat(materials): 抽出共用落库层 material-persist"
```

---

## Task 6: 三端点

**Files:**
- Modify: `apps/api/src/routes/materials.ts`
- Test: `apps/api/src/routes/__tests__/materials.test.ts`

- [ ] **Step 1: 写失败测试**

追加到 `materials.test.ts`（复用该文件已有的 app 搭建、`VALID_TOKEN`、`TENANT_ID` 等夹具；若命名不同则沿用文件里既有的）：

```ts
describe('POST /upload-urls', () => {
  it('无凭据 → 401', async () => {
    const res = await request(app).post('/api/materials/upload-urls')
      .send({ files: [{ file_name: 'a.jpg', size_bytes: 10, mime_type: 'image/jpeg' }] });
    expect(res.status).toBe(401);
  });

  it('有效凭据 → 每个文件返回一个 URL，且 storage_key 以租户 ID 开头', async () => {
    const res = await request(app).post('/api/materials/upload-urls')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [{ file_name: 'a.jpg', size_bytes: 10, mime_type: 'image/jpeg' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.files).toHaveLength(1);
    expect(res.body.data.files[0].storage_key.startsWith(`${TENANT_ID}/`)).toBe(true);
    expect(res.body.data.files[0].upload_url).toBeTruthy();
  });

  it('客户端自报 tenant_id 被忽略——storage_key 仍在凭据推出的租户下', async () => {
    const res = await request(app).post('/api/materials/upload-urls')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ tenant_id: 'attacker-tenant',
              files: [{ file_name: 'a.jpg', size_bytes: 10, mime_type: 'image/jpeg' }] });
    expect(res.status).toBe(200);
    expect(res.body.data.files[0].storage_key.startsWith('attacker-tenant/')).toBe(false);
    expect(res.body.data.files[0].storage_key.startsWith(`${TENANT_ID}/`)).toBe(true);
  });

  it('视频与图片混传 → 400，在签 URL 阶段就拒，不等传完', async () => {
    const res = await request(app).post('/api/materials/upload-urls')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [
        { file_name: 'a.jpg', size_bytes: 10, mime_type: 'image/jpeg' },
        { file_name: 'b.mp4', size_bytes: 10, mime_type: 'video/mp4' },
      ] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_MATERIAL_MIX');
  });

  it('申报大小超上限 → 400，不签 URL', async () => {
    const res = await request(app).post('/api/materials/upload-urls')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [{ file_name: 'a.mp4', size_bytes: 3 * 1024 * 1024 * 1024,
                        mime_type: 'video/mp4' }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });
});

describe('POST /complete', () => {
  it('对象不存在 → 400 OBJECT_NOT_FOUND，绝不落库', async () => {
    const res = await request(app).post('/api/materials/complete')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [{ storage_key: `${TENANT_ID}/m1/a.jpg`, material_id: 'm1',
                        file_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('OBJECT_NOT_FOUND');
  });

  it('storage_key 不在自己租户下 → 403，防止认领别人的对象', async () => {
    const res = await request(app).post('/api/materials/complete')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [{ storage_key: 'other-tenant/m1/a.jpg', material_id: 'm1',
                        file_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 10 }] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('对象在但大小对不上 → 400 SIZE_MISMATCH，绝不落库', async () => {
    // 直接往注入的内存存储里塞一个 999 字节的对象，再申报 10 字节
    const tmp = path.join(os.tmpdir(), `zj-size-${Date.now()}.bin`);
    fs.writeFileSync(tmp, Buffer.alloc(999));
    await storage.putObject({ key: `${TENANT_ID}/m2/a.jpg`, filePath: tmp });
    fs.unlinkSync(tmp);

    const res = await request(app).post('/api/materials/complete')
      .set('X-Upload-Token', VALID_TOKEN)
      .send({ files: [{ storage_key: `${TENANT_ID}/m2/a.jpg`, material_id: 'm2',
                        file_name: 'a.jpg', mime_type: 'image/jpeg', size_bytes: 10 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SIZE_MISMATCH');
  });
});
```

> 上面这条用到 `storage`（构造 router 时注入的 `InMemoryMaterialStorage` 实例）以及
> `fs`/`os`/`path`。若 `materials.test.ts` 里还没有这几个 import 或没保留 storage 实例
> 的引用，在文件顶部补上——注入实例本来就是这层抽象存在的意义（见
> `material-storage.ts` 的头注释）。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd apps/api && npx vitest run src/routes/__tests__/materials.test.ts -t "upload-urls"`

Expected: FAIL with 404（路由不存在）

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add apps/api/src/routes/__tests__/materials.test.ts
git commit -m "test(materials): 直传两端点

最要紧三条：客户端自报 tenant_id 必须被忽略；complete 必须 HEAD 校验对象
真存在（否则就是让客户端自己宣布传好了，会在库里留下指向空气的记录）；
storage_key 不在自己租户下必须 403，防止认领别人的对象。"
```

- [ ] **Step 4: 写实现**

`routes/materials.ts` 的 import 补：

```ts
import { persistMaterials, type PersistItem } from '../services/material-persist';
```

在 `router.post('/upload', ...)` **之前**插入两个新端点：

```ts
  /**
   * ① 换预签名 URL。
   *
   * 客户端只报元数据，服务端预分配 material_id 与 storage_key，并为每个文件签一个
   * **只对这一个对象路径有效**的 PUT 地址。客户端拿到后裸 PUT 即可——不需要任何
   * 签名能力，iOS 快捷指令用「获取 URL 内容」就能传。（decision 03660929）
   */
  router.post('/upload-urls', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId, licenseId } = auth;

    // 客户端字段一律当敌意输入。就地收窄，不藏进 helper——CodeQL 不做跨函数收窄
    // （js/type-confusion-through-parameter-tampering）。
    const rawFiles: unknown = req.body?.files;
    const list = Array.isArray(rawFiles) ? rawFiles : [];
    if (list.length === 0) {
      return fail(res, 400, 'NO_FILES', '没有素材：一次上传至少要带一个文件');
    }

    const metas: UploadedFileMeta[] = [];
    for (const raw of list) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const fileName = sanitizeFileName(typeof o.file_name === 'string' ? o.file_name : '');
      const sizeBytes = Number(o.size_bytes);
      const mimeType = typeof o.mime_type === 'string' ? o.mime_type : 'application/octet-stream';
      if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return fail(res, 400, 'INVALID_SIZE', `文件 ${fileName} 的 size_bytes 不合法`);
      }
      if (sizeBytes > MAX_FILE_BYTES) {
        return fail(res, 400, 'FILE_TOO_LARGE',
          `文件 ${fileName} 超过单文件上限 ${MAX_FILE_BYTES} 字节`);
      }
      metas.push({ fileName, mimeType, sizeBytes });
    }

    // 类型冲突在签 URL 阶段就拒，绝不让客户端白传几百兆再报错
    try {
      inferContentType(metas);
    } catch (err) {
      return fail(res, 400, 'INVALID_MATERIAL_MIX', err instanceof Error ? err.message : 'unknown');
    }

    try {
      const files = await Promise.all(metas.map(async (m) => {
        const materialId = crypto.randomUUID();
        const storageKey = buildStorageKey({ tenantId, materialId, fileName: m.fileName });
        return {
          material_id: materialId,
          storage_key: storageKey,
          file_name: m.fileName,
          upload_url: await storage.presignPut(storageKey),
        };
      }));
      return res.status(200).json({
        success: true,
        data: { files, license_id: licenseId },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      // 签发失败必须带真实原因往外报，绝不吞成一句「上传失败」
      console.error('[materials/upload-urls] presign error:', err);
      return fail(res, 500, 'PRESIGN_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });

  /**
   * ② 客户端传完后回调。
   *
   * **必须 HEAD 校验**：不校验就等于让客户端自己宣布「我传好了」。客户端断网、
   * 传了 0 字节、或干脆没传却调了这里，都会在库里留下一条指向空气的素材记录。
   * 这类静默失败最难查（memory: failure-without-reason-pattern）。
   */
  router.post('/complete', async (req: Request, res: Response) => {
    const auth = await authenticate(req, res);
    if (!auth) return;
    const { tenantId, licenseId } = auth;

    const rawFiles: unknown = req.body?.files;
    const list = Array.isArray(rawFiles) ? rawFiles : [];
    if (list.length === 0) {
      return fail(res, 400, 'NO_FILES', '没有素材：complete 至少要带一个文件');
    }

    const rawTakenAt: unknown = req.body?.taken_at;
    const takenAtRaw: string[] = Array.isArray(rawTakenAt)
      ? rawTakenAt.filter((v): v is string => typeof v === 'string')
      : typeof rawTakenAt === 'string' ? [rawTakenAt] : [];
    const takenAtList = normalizeTakenAt(takenAtRaw, list.length);

    const items: PersistItem[] = [];
    const metas: UploadedFileMeta[] = [];

    for (let i = 0; i < list.length; i++) {
      const o = (list[i] ?? {}) as Record<string, unknown>;
      const storageKey = typeof o.storage_key === 'string' ? o.storage_key : '';
      const materialId = typeof o.material_id === 'string' ? o.material_id : '';
      const fileName = sanitizeFileName(typeof o.file_name === 'string' ? o.file_name : '');
      const mimeType = typeof o.mime_type === 'string' ? o.mime_type : 'application/octet-stream';
      const sizeBytes = Number(o.size_bytes);

      if (!storageKey || !materialId || !Number.isFinite(sizeBytes)) {
        return fail(res, 400, 'INVALID_ITEM',
          '每个文件必须带 storage_key / material_id / size_bytes');
      }
      // 不能让客户端认领别人租户下的对象
      if (!storageKey.startsWith(`${tenantId}/`)) {
        return fail(res, 403, 'TENANT_MISMATCH', 'storage_key 不在本租户目录下');
      }

      let head;
      try {
        head = await storage.headObject(storageKey);
      } catch (err) {
        // 网络故障不能当成「文件不存在」——那会把传成功的素材丢掉
        console.error('[materials/complete] head error:', err);
        return fail(res, 502, 'STORAGE_UNAVAILABLE', err instanceof Error ? err.message : 'unknown');
      }
      if (!head) {
        return fail(res, 400, 'OBJECT_NOT_FOUND', `对象不存在：${storageKey}`);
      }
      if (head.sizeBytes !== sizeBytes) {
        return fail(res, 400, 'SIZE_MISMATCH',
          `对象大小不符：申报 ${sizeBytes}，实际 ${head.sizeBytes}`);
      }

      metas.push({ fileName, mimeType, sizeBytes });
      items.push({
        materialId, storageKey, fileName, mimeType, sizeBytes,
        takenAt: takenAtList[i],
        dedupeKey: buildDedupeKey({ tenantId, fileName, sizeBytes, takenAt: takenAtList[i] }),
      });
    }

    let contentType: 'video' | 'image';
    try {
      contentType = inferContentType(metas);
    } catch (err) {
      return fail(res, 400, 'INVALID_MATERIAL_MIX', err instanceof Error ? err.message : 'unknown');
    }

    try {
      const out = await persistMaterials({
        tenantId, licenseId, contentType,
        title: firstString(req.body?.title),
        body: firstString(req.body?.body),
        platforms: parsePlatforms(req.body?.platforms),
        items,
      });
      return res.status(200).json({
        success: true,
        data: { content_id: out.contentId, type: contentType, materials: out.materials },
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.error('[materials/complete] persist error:', err);
      return fail(res, 500, 'PERSIST_FAILED', err instanceof Error ? err.message : 'unknown');
    }
  });
```

在文件底部（`createMaterialsRouter` 函数外）加共用鉴权 helper：

```ts
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
  return {
    tenantId: r.license.tenant_id as string,
    licenseId: r.license.id as string,
  };
}
```

老 `/upload` 端点改为复用同一套，四处改动：

1. 删掉它内部的鉴权段（`extractUploadToken` → `validateLicense` → 取 `tenantId` 那一整块），改成开头调 `authenticate(req, res)`
2. 删掉 `const contentHash = await hashFile(f.path);` 及 `buildDedupeKey` 里的 `contentHash` 参数
3. 删掉文件底部的 `hashFile` 函数本身（不再有调用方，留着就是死代码）
4. 删掉它自己的落库段（materials/contents/content_materials 三段 SQL），改为：先把文件 `putObject` 上去、再调 `persistMaterials`

> 注意顺序差异：老端点是「先入库再传存储」，直传是「先传存储再入库」。老端点保持
> 原顺序即可——它手里有真文件，`putObject` 失败会抛异常，不会留下孤儿记录。

- [ ] **Step 5: 跑测试确认通过**

Run: `cd apps/api && npx vitest run src/routes/__tests__/materials.test.ts`

Expected: PASS（原有 13 条 + 新增 8 条）

- [ ] **Step 6: 类型与 lint**

Run: `cd apps/api && npx tsc --noEmit && npx eslint src/routes/materials.ts src/services/material-persist.ts`

Expected: 0 error

- [ ] **Step 7: 提交实现（commit-2）**

```bash
git add apps/api/src/routes/materials.ts
git commit -m "feat(materials): 直传两端点 upload-urls/complete，老端点复用共用落库"
```

---

## Task 7: agent 下载域名改直连 + 守卫

**Files:**
- Modify: `services/agent/src/core-upgrader.ts`
- Modify: `services/agent/src/module-manager.ts`
- Modify: `services/agent/src/handlers/ensure-chrome.ts`（两处）
- Modify: `services/agent/src/handlers/ensure-ffmpeg.ts`
- Test: `services/agent/src/__tests__/cos-endpoint.test.ts`（新建）

**为什么：** 国内客户下载国内的桶，却走了跨境加速通道，又慢又贵——2026-07 账单「全球加速下行流量_境内到境内」33.28 元。

- [ ] **Step 1: 写失败测试**

新建 `services/agent/src/__tests__/cos-endpoint.test.ts`：

```ts
/**
 * 守卫：agent 的下载地址不许再用全球加速域名。
 *
 * 客户在国内、桶在广州——走 cos.accelerate 是拿跨境通道下国内文件，又慢又贵。
 * 这是个会真报红的守卫：谁把 accelerate 写回去，CI 当场拦。
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : walk(p);
    return /\.ts$/.test(e.name) ? [p] : [];
  });
}

describe('COS 下载域名', () => {
  it('agent 源码里不许出现 cos.accelerate', () => {
    const offenders = walk(SRC)
      .filter((f) => fs.readFileSync(f, 'utf8').includes('cos.accelerate'))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('确实在用广州直连域名（防止被整段删掉而假绿）', () => {
    const hit = walk(SRC).some((f) =>
      fs.readFileSync(f, 'utf8').includes('cos.ap-guangzhou.myqcloud.com'));
    expect(hit).toBe(true);
  });
});
```

- [ ] **Step 2: 跑测试确认失败（proven-to-fire）**

Run: `cd services/agent && npx vitest run src/__tests__/cos-endpoint.test.ts`

Expected: **FAIL**，第一条列出 4 个 offender 文件。**必须亲眼看到它报红**——没见过报红的守卫不算守卫。

- [ ] **Step 3: 提交红测试（commit-1）**

```bash
git add services/agent/src/__tests__/cos-endpoint.test.ts
git commit -m "test(agent): 守卫——下载地址不许再用 cos.accelerate 全球加速域名

客户在国内、桶在广州，走加速域名是拿跨境通道下国内文件。2026-07 账单
「全球加速下行流量_境内到境内」33.28 元就是这么来的。已确认它当前报红。"
```

- [ ] **Step 4: 改 4 个文件**

```bash
grep -rl "cos.accelerate.myqcloud.com" services/agent/src --include="*.ts" \
  | grep -v __tests__ \
  | xargs sed -i '' 's/cos\.accelerate\.myqcloud\.com/cos.ap-guangzhou.myqcloud.com/g'
grep -rn "cos.accelerate" services/agent/src --include="*.ts" | grep -v __tests__ \
  || echo "已全部替换"
```

- [ ] **Step 5: 跑测试确认通过**

Run: `cd services/agent && npx vitest run src/__tests__/cos-endpoint.test.ts`

Expected: PASS（2 条）

- [ ] **Step 6: 提交实现（commit-2）**

```bash
git add services/agent/src
git commit -m "fix(agent): COS 下载改广州直连域名，不再走全球加速"
```

---

## Task 8: 真链路 smoke

**Files:**
- Create: `.github/workflows/scripts/smoke/material-direct-upload-smoke.sh`

**为什么必须有：** 「零签名能力的客户端能传成功」和「签名不可篡改」是本设计的命门，只有真链路能证明——单测里的内存实现证明不了 COS 真的接受这个 URL。

- [ ] **Step 1: 写 smoke 脚本**

```bash
#!/usr/bin/env bash
# 素材直传真链路冒烟。
#
# 验的是单测证明不了的东西：
#   ① 服务端签的 URL，COS 真的认
#   ② 一个【零签名能力】的客户端（纯 curl，不带任何鉴权头）真能传上去
#   ③ 篡改签名会被拒——不是靠我们的代码拒，是靠 COS 拒
#   ④ complete 的 HEAD 校验真的挡得住「没传却说传好了」
set -uo pipefail

API="${ZJ_API_BASE:-http://localhost:5200}"
TOKEN="${ZJ_UPLOAD_TOKEN:-}"
FAIL=0
step() { printf '\n▶ %s\n' "$1"; }
ok()   { printf '  ✅ %s\n' "$1"; }
bad()  { printf '  ❌ %s\n' "$1"; FAIL=1; }

if [ -z "${TOKEN}" ]; then
  echo "SKIP: 未设置 ZJ_UPLOAD_TOKEN，跳过（不假绿）"
  exit 0
fi
if ! curl -sf "${API}/health" >/dev/null 2>&1; then
  echo "SKIP: API ${API} 不可达，跳过（不假绿）"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
head -c 65536 /dev/urandom > "${TMP}/probe.bin"
SIZE="$(wc -c < "${TMP}/probe.bin" | tr -d ' ')"

step "1/6 换预签名 URL"
RESP="$(curl -s -X POST "${API}/api/materials/upload-urls" \
  -H "X-Upload-Token: ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"files\":[{\"file_name\":\"smoke-probe.bin\",\"size_bytes\":${SIZE},\"mime_type\":\"image/jpeg\"}]}")"
URL="$(printf '%s' "${RESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["upload_url"])' 2>/dev/null)"
KEY="$(printf '%s' "${RESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["storage_key"])' 2>/dev/null)"
MID="$(printf '%s' "${RESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["files"][0]["material_id"])' 2>/dev/null)"
if [ -n "${URL}" ] && [ -n "${KEY}" ]; then
  ok "拿到 URL，storage_key=${KEY}"
else
  bad "换 URL 失败：${RESP}"; exit 1
fi

step "2/6 模拟快捷指令：纯 PUT，不带任何鉴权头"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@${TMP}/probe.bin" "${URL}")"
if [ "${CODE}" = "200" ]; then ok "零签名客户端上传成功 (HTTP 200)"; else bad "上传失败 HTTP ${CODE}"; fi

step "3/6 篡改签名必须被 COS 拒"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X PUT --data-binary "@${TMP}/probe.bin" "${URL}TAMPER")"
if [ "${CODE}" = "403" ]; then ok "篡改签名被拒 (HTTP 403)"; else bad "篡改签名居然得到 HTTP ${CODE}"; fi

step "4/6 complete 落库"
CRESP="$(curl -s -X POST "${API}/api/materials/complete" \
  -H "X-Upload-Token: ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"files\":[{\"storage_key\":\"${KEY}\",\"material_id\":\"${MID}\",\"file_name\":\"smoke-probe.bin\",\"mime_type\":\"image/jpeg\",\"size_bytes\":${SIZE}}],\"title\":\"smoke\"}")"
CID="$(printf '%s' "${CRESP}" | python3 -c 'import sys,json;print(json.load(sys.stdin)["data"]["content_id"])' 2>/dev/null)"
if [ -n "${CID}" ]; then ok "落库成功 content_id=${CID}"; else bad "complete 失败：${CRESP}"; fi

step "5/6 没传却说传好了 → 必须被 HEAD 校验挡住"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -X POST "${API}/api/materials/complete" \
  -H "X-Upload-Token: ${TOKEN}" -H 'Content-Type: application/json' \
  -d "{\"files\":[{\"storage_key\":\"${KEY}.nonexistent\",\"material_id\":\"00000000-0000-0000-0000-000000000000\",\"file_name\":\"x.jpg\",\"mime_type\":\"image/jpeg\",\"size_bytes\":1}]}")"
if [ "${CODE}" = "400" ]; then ok "空对象被拒 (HTTP 400)"; else bad "空对象居然得到 HTTP ${CODE}"; fi

step "6/6 查库确认 storage_key 在租户目录下、且记了上传者"
if command -v psql >/dev/null 2>&1 && [ -n "${PGDATABASE:-}" ]; then
  ROW="$(psql -t -A -F'|' -c "SELECT storage_key, uploaded_by_license_id IS NOT NULL FROM zenithjoy.materials WHERE id = '${MID}'" 2>/dev/null)"
  case "${ROW}" in
    *"|t") ok "落库记录正确：${ROW}" ;;
    "")    bad "库里查不到 material ${MID}" ;;
    *)     bad "落库记录异常：${ROW}" ;;
  esac
else
  echo "  (无 psql/PGDATABASE，跳过查库)"
fi

printf '\n'
if [ "${FAIL}" -eq 0 ]; then
  echo "✅ material-direct-upload-smoke 全部通过"
else
  echo "❌ material-direct-upload-smoke 有失败项"
fi
exit "${FAIL}"
```

- [ ] **Step 2: 本地跑一遍**

Run:
```bash
chmod +x .github/workflows/scripts/smoke/material-direct-upload-smoke.sh
ZJ_API_BASE=https://staging-autopilot.zenjoymedia.media \
ZJ_UPLOAD_TOKEN=ZJ-F-UP5B6R5Z \
bash .github/workflows/scripts/smoke/material-direct-upload-smoke.sh
```

Expected: 部署前会在第 1 步失败（端点还没上线），这是正常的；PR 阶段 CI 里因无 token 而 SKIP。部署后必须 6 步全绿。

- [ ] **Step 3: shell 变量括号棘轮检查**

Run: `bash .github/workflows/scripts/lint-shell-var-brace.test.sh`

Expected: 不增加基线计数。脚本里所有变量已用 `${VAR}` 形式。

- [ ] **Step 4: 提交**

```bash
git add .github/workflows/scripts/smoke/material-direct-upload-smoke.sh
git commit -m "test(materials): 直传真链路 smoke

验单测证明不了的三件事：服务端签的 URL COS 真认、零签名能力的客户端真能
传上去、篡改签名被 COS 拒。第 5 步验 HEAD 校验真挡得住「没传却说传好了」。
无 token/无 API 时明确 SKIP，不假绿。"
```

---

## Task 9: 登记与收尾

**Files:**
- Modify: `test-registry.yaml`
- Modify: `.github/workflows/scripts/smoke-baseline.txt`

**为什么：** CI 有 Orphan Test Check——新建的 `.test.ts` 没登记会红。

- [ ] **Step 1: 登记两个新测试**

在 `test-registry.yaml` 的 `material-storage-abstraction` 条目之后追加：

```yaml
  - id: material-persist-shared
    path: apps/api/src/services/__tests__/material-persist.test.ts
    type: unit
    ci: L3
    status: active
    product: 素材上传链路
    note: "共用落库层：直传与老端点共用同一套写库逻辑，两个入口的行为不可能漂移。含 uploaded_by_license_id 写入、去重命中拿回已有 id、按序挂满关联。"

  - id: agent-cos-endpoint-guard
    path: services/agent/src/__tests__/cos-endpoint.test.ts
    type: unit
    ci: L3
    status: active
    product: 素材上传链路
    note: "守卫：agent 源码不许出现 cos.accelerate 全球加速域名（国内下国内桶走跨境通道，2026-07 白花 33.28 元），且必须确实在用广州直连域名。"
```

- [ ] **Step 2: smoke 基线追加（只追加，绝不重排）**

Run:
```bash
echo "material-direct-upload-smoke.sh" >> .github/workflows/scripts/smoke-baseline.txt
bash .github/workflows/scripts/lint-smoke-baseline.sh
```

Expected: 通过。**注意：绝不对该文件排序**——linter 做行 diff，重排会被读成「删了 N 行」（本仓库踩过）。

- [ ] **Step 3: 全量测试**

Run:
```bash
cd apps/api && npm test 2>&1 | tail -20
cd ../../services/agent && npx vitest run 2>&1 | tail -10
```

Expected: apps/api 在原有 2332 passed 之上增加新条数；既有的 10 个 `boot-fail-api-contract` 失败是**已存在的**（需真 DB，在 main 检出上同样红），与本次无关。

- [ ] **Step 4: 提交**

```bash
git add test-registry.yaml .github/workflows/scripts/smoke-baseline.txt
git commit -m "chore(materials): 登记新测试与 smoke 基线"
```

---

## Task 10: 开 PR

- [ ] **Step 1: 推分支**

Run: `git push -u origin cp-0905093007-cos-direct-upload`

**注意：** 不要加 `-q` 再管道到 `tail`——那会把失败的 push 吞掉，出现「显示成功但远端没有」的假象（本仓库踩过）。

- [ ] **Step 2: 开 PR**

PR body 必须含 `GP-Anchor: line01/customer_first_success keep-green`。

```bash
gh pr create --repo perfectuser21/zenithjoy-workspace \
  --title "feat(materials): 素材改 COS 直传——预签名 URL，三入口统一，不再绕香港" \
  --body-file docs/superpowers/specs/2026-09-05-cos-direct-upload-design.md
```

若 body 里缺 GP-Anchor 行，先 `gh pr edit --body-file` 补上。

- [ ] **Step 3: 交给 watchdog**

```
Skill({"skill":"engine-ship"})
```

---

## 收尾提醒（交付后必须告诉用户）

1. **快捷指令要手工改**：改成 `/api/materials/upload-urls` → 裸 PUT → `/complete` 三步，Token 换成他自己的 `ZJ-F-*`。这一步只能在手机上手动做。
2. **COS 生命周期规则要配**：未完成分片 7 天自动中止、无引用对象自动清理。控制台配，不在代码里。
3. **本机那个 Python 上传服务可以停了**。
