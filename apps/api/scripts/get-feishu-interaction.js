#!/usr/bin/env node
/**
 * get-feishu-interaction.js — 输出"互动记录"表最新一条 / 字段值
 *
 * Usage:
 *   node apps/api/scripts/get-feishu-interaction.js --customer=<c> --latest [--field=<f>]
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node get-feishu-interaction.js --customer=<c> --latest [--field=<f>]
  --customer  关联客户（必填）
  --latest    取最新一条（必填，标志位）
  --field     仅输出指定字段值（可选）
  --help      Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    if (args.field) {
      process.stdout.write('mock_value\n');
    } else {
      process.stdout.write(JSON.stringify({ mock: true, customer: args.customer || null }) + '\n');
    }
    return 0;
  }

  if (!args.customer || !args.latest) {
    process.stderr.write('FAIL: --customer + --latest 必填\n');
    process.exit(2);
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_INTERACTION_TABLE_ID}/records/search`;
  const r = await helper.postJson(
    url,
    {
      filter: { conjunction: 'and', conditions: [{ field_name: '客户名', operator: 'is', value: [String(args.customer)] }] },
      sort: [{ field_name: '生成时间', desc: true }],
      page_size: 1,
    },
    { Authorization: `Bearer ${token}` },
  );
  if (r.code !== 0 || !r.data?.items?.length) {
    process.stderr.write('FAIL: 未找到记录\n');
    process.exit(1);
  }
  const latest = r.data.items[0];
  if (args.field) {
    const v = latest.fields?.[args.field];
    process.stdout.write((typeof v === 'object' ? JSON.stringify(v) : String(v ?? '')) + '\n');
  } else {
    process.stdout.write(JSON.stringify(latest) + '\n');
  }
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`);
  process.exit(1);
});
