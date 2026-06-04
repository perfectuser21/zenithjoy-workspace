/**
 * apps/api/src/services/wechat/cs-config-store.ts — 微信客服配置 DB 存取层（Sprint B）
 *
 * Sprint A 把人设 / 企业知识库写死在 apps/api/config/*.json，由 persona.ts / business-kb.ts
 * 的 loadPersona() / loadBusinessKB() 同步读取。Sprint B 把它们「搬上中台」：运营在页面上填、
 * 保存进 zenithjoy.wechat_cs_config（key-value JSONB），保存即生效。
 *
 * 本文件是引擎与中台之间的唯一存取入口：
 *   - 读：getPersona / getBusinessKB —— DB 有行用 DB 值；无行 / DB 失败 → 回落 config 兜底。
 *   - 写：savePersona / saveBusinessKB —— upsert（ON CONFLICT DO UPDATE）。
 *
 * 容错纪律（与 contact-memory.ts 一致）：全程 try/catch，读类失败 console.warn 后回落兜底，
 * 写类失败 console.warn 不抛 —— 绝不让 DB 抖动阻塞回复主链路或中台保存。
 *
 * 详见 docs/superpowers/specs/2026-06-04-wechat-cs-config-ui-design.md §2.1 / §2.2
 */

import pool from '../../db/connection';
import { loadPersona } from './persona';
import { loadBusinessKB } from './business-kb';
import type { BusinessKB, Persona } from './types';

const KEY_PERSONA = 'persona';
const KEY_BUSINESS_KB = 'business_kb';

// ─── jsonb 解析容错 ─────────────────────────────────────────────────────────────

/**
 * 把 jsonb 列解析成对象。node-pg 对 jsonb 通常已给对象，但也可能（驱动/类型配置差异）
 * 给字符串，这里两种都兜：字符串 → JSON.parse；对象 → 原样；其它 / 解析失败 → null。
 */
function parseJsonbValue<T>(raw: unknown): T | null {
  if (raw == null) return null;
  let val: unknown = raw;
  if (typeof raw === 'string') {
    try {
      val = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!val || typeof val !== 'object') return null;
  return val as T;
}

// ─── 读：取某 key 的 value（DB 命中→解析；无行 / 失败→null）──────────────────────

async function readConfig<T>(key: string): Promise<T | null> {
  try {
    const res = await pool.query(
      `SELECT value FROM zenithjoy.wechat_cs_config WHERE key = $1`,
      [key],
    );
    const row = res.rows?.[0];
    if (!row) return null;
    return parseJsonbValue<T>(row.value);
  } catch (err) {
    console.warn(`[cs-config-store] readConfig(${key}) 读取失败，回落兜底:`, err);
    return null;
  }
}

// ─── 写：upsert 某 key 的 value（失败 console.warn 不抛）────────────────────────

async function writeConfig(key: string, value: unknown): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO zenithjoy.wechat_cs_config (key, value, updated_at)
       VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value,
             updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  } catch (err) {
    console.warn(`[cs-config-store] writeConfig(${key}) 写入失败:`, err);
  }
}

// ─── ① 人设 Persona ────────────────────────────────────────────────────────────

/**
 * 取人设。DB 有 key='persona' 行 → 解析 jsonb 返回；无行 / DB 失败 / 解析失败 → loadPersona() 兜底。
 */
export async function getPersona(): Promise<Persona> {
  const fromDb = await readConfig<Persona>(KEY_PERSONA);
  return fromDb ?? loadPersona();
}

/** 保存人设（upsert）。失败 console.warn 不抛。 */
export async function savePersona(p: Persona): Promise<void> {
  await writeConfig(KEY_PERSONA, p);
}

// ─── ② 企业知识库 BusinessKB ────────────────────────────────────────────────────

/**
 * 取企业知识库。DB 有 key='business_kb' 行 → 解析 jsonb 返回；无行 / DB 失败 / 解析失败 → loadBusinessKB() 兜底。
 */
export async function getBusinessKB(): Promise<BusinessKB> {
  const fromDb = await readConfig<BusinessKB>(KEY_BUSINESS_KB);
  return fromDb ?? loadBusinessKB();
}

/** 保存企业知识库（upsert）。失败 console.warn 不抛。 */
export async function saveBusinessKB(kb: BusinessKB): Promise<void> {
  await writeConfig(KEY_BUSINESS_KB, kb);
}
