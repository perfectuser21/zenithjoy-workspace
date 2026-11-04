import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { disposableConnection } from './connection';

// Real production DDL in dependency order; no skipped/ignored migration errors.
const migrations = [
  '20260210_000000_create_works_tables.sql',
  '20260416_163600_create_zenithjoy_topics.sql', '20260416_163601_create_zenithjoy_pacing_config.sql',
  '20260417_173000_add_notebook_id_to_topics.sql',
  '20260428_100000_create_tenants.sql', '20260428_100100_create_agents.sql',
  '20260428_104400_create_license_tables.sql', '20260428_120500_add_works_owner_id.sql',
  '20260428_132000_unify_tenant_isolation.sql', '20260428_205500_better_auth_schema.sql',
  '20260429_161500_licenses_allow_free_tier.sql', '20260429_161614_create_credits.sql',
  '20260429_000000_create_daily_snapshots.sql', '20260502_000000_add_response_to_publish_logs.sql',
  '20260507_115000_walking_skeleton_1.sql', '20260508_014306_publish_tasks_add_type.sql',
  '20260508_170000_tenant_feishu_bindings.sql', '20260510_0c10fc_agent_platform_sessions_add_role.sql',
  '20260510_0c10fd_publish_tasks_burner_columns.sql', '20260511_102431_publish_tasks_status_enum_full.sql',
  '20260513_221815_create_llm_audit.sql',
  '20260521_120000_clips.sql', '20260522_130000_user_clip_oauth.sql',
  '20260524_100000_acquisition_tables.sql', '20260529_100000_add_os_type_to_agents.sql',
  '20260604_120000_create_wechat_cs_engine_tables.sql', '20260604_130000_create_wechat_cs_config.sql',
  '20260618_153000_create_cs_memory_tenant_memory.sql',
  '20260618_190000_acquisition_collect.sql', '20260622_210000_create_wechat_cs_account_config.sql',
  '20260624_120000_wechat_messages_add_cs_wechat_id.sql',
  '20260625_100000_add_blacklist_and_takeover_mode.sql',
  '20260626_150000_agents_add_nickname_machine_role.sql',
  '20260626_214500_acquisition_dispatch.sql',
  '20260628_120000_wechat_cs_account_config_full_persona_kb.sql',
  '20260628_line02_collect_tasks_stage1.sql',
  '20260628_line02_account_sessions.sql', '20260629_193000_leads_add_comment_fields.sql',
  '20260703000000_leads_reply_assignee.sql',
  '20260702_170000_acquisition_collect_videos.sql', '20260703_account_role_unify.sql',
  '20260704_lead_comments_history.sql', '20260712_content_judgment_gate.sql',
  '20260710_150000_collect_videos_composite_pk.sql',
  '20260705_100000_add_wechat_messages_status.sql',
  '20260715_150000_acquisition_leads_douyin_id.sql',
  '20260719_180000_acquisition_collect_videos_transcript.sql',
  '20260721_100000_agents_add_owner_type.sql',
  '20260722_android_signal_reporting.sql',
  '20260731_acquisition_cancel_lifecycle.sql',
  '20260820_120000_structured_workbench.sql',
  '20260904_224500_materials_contents.sql', '20260910_083000_contents_scheduled_at.sql',
  '20260922_120000_payment_orders.sql',
];
export default async function setup() {
  const connection = disposableConnection();
  const admin = new Pool({ ...connection, database: 'postgres' });
  let owned = false;
  const cleanup = async () => {
    try { if (owned) await admin.query('DROP DATABASE "zenithjoy_consolidation_test" WITH (FORCE)'); }
    finally { await admin.end(); }
  };
  try {
    await admin.query('CREATE DATABASE "zenithjoy_consolidation_test"');
    owned = true; // An existing database fails above and is never reused/dropped.
    const db = new Pool(connection);
    try {
      for (const file of migrations) {
        await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
        console.log(`[consolidated-pg] migrated ${file}`);
      }
    } finally { await db.end(); }
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
