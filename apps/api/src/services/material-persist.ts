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
      // 已存在：拿回已有的 id。**必须带 tenant_id** —— 绝不能跨租户拿回别人的素材 id。
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
