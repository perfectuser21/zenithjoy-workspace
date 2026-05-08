#!/usr/bin/env node
/**
 * count-feishu-schedule.js — 输出"内容排期"表行数
 *
 * Usage:
 *   node apps/api/scripts/count-feishu-schedule.js [--status=<s>] [--date_today]
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node count-feishu-schedule.js [--status=<s>] [--date_today]
  --status      按状态筛选（可选）
  --date_today  仅今日生成的（可选）
  --help        Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    process.stdout.write('0\n');
    return 0;
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_SCHEDULE_TABLE_ID}/records/search`;
  const conditions = [];
  if (args.status) {
    conditions.push({ field_name: '状态', operator: 'is', value: [String(args.status)] });
  }
  if (args.date_today) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    conditions.push({
      field_name: '生成时间',
      operator: 'isGreater',
      value: [String(start.getTime())],
    });
  }
  const r = await helper.postJson(
    url,
    { filter: conditions.length ? { conjunction: 'and', conditions } : undefined, page_size: 500 },
    { Authorization: `Bearer ${token}` },
  );
  if (r.code !== 0) {
    process.stderr.write('FAIL: ' + JSON.stringify(r) + '\n');
    process.exit(1);
  }
  process.stdout.write(String((r.data?.items || []).length) + '\n');
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`);
  process.exit(1);
});
