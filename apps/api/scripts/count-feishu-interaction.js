#!/usr/bin/env node
/**
 * count-feishu-interaction.js — 输出"互动记录"表行数
 *
 * Usage:
 *   node apps/api/scripts/count-feishu-interaction.js [--customer=<c>] [--status=<s>] [--status_in=a,b]
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node count-feishu-interaction.js [--customer=<c>] [--status=<s>] [--status_in=a,b]
  --customer   按客户名筛选（可选）
  --status     按状态筛选（可选）
  --status_in  状态多值（逗号分隔，可选）
  --help       Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    process.stdout.write('0\n');
    return 0;
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_INTERACTION_TABLE_ID}/records/search`;
  const conditions = [];
  if (args.customer) {
    conditions.push({ field_name: '客户名', operator: 'is', value: [String(args.customer)] });
  }
  if (args.status) {
    conditions.push({ field_name: '状态', operator: 'is', value: [String(args.status)] });
  }
  if (args.status_in) {
    const values = String(args.status_in).split(',').map((s) => s.trim()).filter(Boolean);
    conditions.push({ field_name: '状态', operator: 'isAnyOf', value: values });
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
