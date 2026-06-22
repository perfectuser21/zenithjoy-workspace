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
const KEY_AUTO_AGENT = 'auto_agent';

// ─── 自动代理（无审批自动回复闭环）配置 ──────────────────────────────────────────

/**
 * 自动代理 5 配置键（Line 04 无审批自动回复闭环）。整体作为一个 JSONB 对象存在
 * key='auto_agent' 下（标量 jsonb 在 parseJsonbValue 里读不回，必须整对象存）。
 */
export interface AutoAgentConfig {
  /** 「开启自动代理」总开关。默认 false = 监控态（出草稿不自动发）。 */
  auto_agent_enabled: boolean;
  /** 营业时间起（HH:MM）。 */
  business_hours_start: string;
  /** 营业时间止（HH:MM，'24:00' = 到午夜；支持跨午夜如 '02:00'）。 */
  business_hours_end: string;
  /** 关键人微信（上下线播报 / 失败告警的接收者）。空 = 跳过播报。 */
  key_contact_wechat: string;
  /** 每日单号自动回上限。0 = 不限；>0 且超额 → 转 pending_human。 */
  daily_limit: number;
}

const AUTO_AGENT_DEFAULTS: AutoAgentConfig = {
  auto_agent_enabled: false,
  business_hours_start: '06:00',
  business_hours_end: '24:00',
  key_contact_wechat: '',
  daily_limit: 0,
};

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

// ─── ③ 自动代理配置 AutoAgentConfig ─────────────────────────────────────────────

/**
 * 取自动代理配置。DB 有 key='auto_agent' 行 → 合并到默认值返回；无行 / DB 失败 → 全默认（默认关）。
 * 默认关（auto_agent_enabled=false）= 监控态，绝不在没人配过时就自动发。
 */
export async function getAutoAgentConfig(): Promise<AutoAgentConfig> {
  const fromDb = await readConfig<Partial<AutoAgentConfig>>(KEY_AUTO_AGENT);
  return { ...AUTO_AGENT_DEFAULTS, ...(fromDb ?? {}) };
}

/** 保存自动代理配置（partial 合并 upsert）。失败 console.warn 不抛。 */
export async function saveAutoAgentConfig(cfg: Partial<AutoAgentConfig>): Promise<void> {
  const current = await getAutoAgentConfig();
  await writeConfig(KEY_AUTO_AGENT, { ...current, ...cfg });
}
