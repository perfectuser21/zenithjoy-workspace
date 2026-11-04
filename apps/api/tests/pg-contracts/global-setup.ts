import { Pool } from 'pg';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { requireDisposableDatabases } from './disposable-db';
import { runCompanyFreezePostgres } from './run-company-freeze.mjs';

// Apply real production migrations in dependency order. Every SQL error fails setup.
const migrations = [
  '20260210_000000_create_works_tables.sql',
  '20260428_100000_create_tenants.sql',
  '20260428_100100_create_agents.sql',
  '20260428_104400_create_license_tables.sql',
  '20260428_120500_add_works_owner_id.sql',
  '20260428_132000_unify_tenant_isolation.sql',
  '20260507_115000_walking_skeleton_1.sql',
  '20260508_014306_publish_tasks_add_type.sql',
  '20260508_170000_tenant_feishu_bindings.sql',
  '20260510_0c10fc_agent_platform_sessions_add_role.sql',
  '20260510_0c10fd_publish_tasks_burner_columns.sql',
  '20260511_102431_publish_tasks_status_enum_full.sql',
  '20260618_190000_acquisition_collect.sql',
  '20260626_150000_agents_add_nickname_machine_role.sql',
  '20260629_193000_leads_add_comment_fields.sql',
  '20260706_120000_agent_platform_sessions_add_device_type.sql',
  '20260722_android_signal_reporting.sql',
  '20260728_134234_agent_scan_failures.sql',
];

export default async function setup() {
  const connection = requireDisposableDatabases();
  const admin = new Pool({ ...connection, database: 'postgres' });
  const created: string[] = [];
  const cleanup = async () => {
    try {
      // Never drop pre-existing databases: only names this invocation successfully created.
      for (const name of [...created].reverse()) await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    } finally { await admin.end(); }
  };
  try {
    for (const name of ['zenithjoy_contract_test', 'cecelia_scratch']) {
      await admin.query(`CREATE DATABASE "${name}"`); // existing DB => fail closed
      created.push(name);
    }
    const db = new Pool({ ...connection, database: 'zenithjoy_contract_test' });
    try {
      for (const file of migrations) {
        await db.query(await readFile(resolve('db/migrations', file), 'utf8'));
        console.log(`[pg-contracts] migrated ${file}`);
      }
    } finally { await db.end(); }
    // This unique phone-side SQL contract used to run in company-wiki smoke.
    // It shares the same fresh scratch DB and fails setup on child failure/skip.
    console.log(runCompanyFreezePostgres(connection));
    return cleanup;
  } catch (error) { await cleanup(); throw error; }
}
