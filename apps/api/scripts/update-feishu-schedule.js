#!/usr/bin/env node
/**
 * update-feishu-schedule.js — 更新飞书"内容排期"表的状态字段
 *
 * Usage:
 *   node apps/api/scripts/update-feishu-schedule.js --id=<draft_id> --status=<s>
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node update-feishu-schedule.js --id=<draft_id> --status=<s>
  --id        草稿 ID（必填）
  --status    新状态（必填）
  --help      Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    process.stdout.write(`OK mock update id=${args.id || '?'} status=${args.status || '?'}\n`);
    return 0;
  }

  if (!args.id || !args.status) {
    process.stderr.write('FAIL: --id + --status 必填\n');
    process.exit(2);
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();

  // search by 草稿 ID
  const searchUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_SCHEDULE_TABLE_ID}/records/search`;
  const search = await helper.postJson(
    searchUrl,
    { filter: { conjunction: 'and', conditions: [{ field_name: '草稿 ID', operator: 'is', value: [String(args.id)] }] } },
    { Authorization: `Bearer ${token}` },
  );
  if (search.code !== 0 || !search.data?.items?.length) {
    process.stderr.write('FAIL: 未找到 draft_id ' + args.id + '\n');
    process.exit(1);
  }
  const recordId = search.data.items[0].record_id;
  // patch
  const patchUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_SCHEDULE_TABLE_ID}/records/${recordId}`;
  const r = await helper.postJson(
    patchUrl,
    { fields: { 状态: String(args.status) } },
    { Authorization: `Bearer ${token}` },
  );
  if (r.code !== 0) {
    process.stderr.write('FAIL: ' + JSON.stringify(r) + '\n');
    process.exit(1);
  }
  process.stdout.write(`OK ${args.id} → ${args.status}\n`);
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`);
  process.exit(1);
});
