#!/usr/bin/env node
/**
 * seed-feishu-customer.js — 在飞书"客户档案"表插入一行
 *
 * Usage:
 *   node apps/api/scripts/seed-feishu-customer.js --name=<name> --wechat_id=<id> [--industry=<i>] [--note=<n>]
 *   --help    Show this help
 *
 * CI mock 模式：缺凭据时输出 mock customer_id 占位。
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node seed-feishu-customer.js --name=<name> --wechat_id=<id> [--industry=<i>] [--note=<n>]
  --name        客户名（必填）
  --wechat_id   微信号（必填）
  --industry    行业（可选）
  --note        备注（可选）
  --help        Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    const fakeId = `mock_customer_${Date.now()}`;
    process.stdout.write(`${fakeId}\n`);
    return 0;
  }

  if (!args.name || !args.wechat_id) {
    process.stderr.write('FAIL: --name + --wechat_id 必填\n');
    process.exit(2);
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_CUSTOMER_TABLE_ID}/records`;
  const payload = {
    fields: {
      客户名: String(args.name),
      微信号: String(args.wechat_id),
      行业: args.industry ? String(args.industry) : '',
      备注: args.note ? String(args.note) : '',
      加入日期: Date.now(),
    },
  };
  const r = await helper.postJson(url, payload, { Authorization: `Bearer ${token}` });
  if (r.code !== 0) {
    process.stderr.write('FAIL: ' + JSON.stringify(r) + '\n');
    process.exit(1);
  }
  process.stdout.write(r.data.record.record_id + '\n');
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`);
  process.exit(1);
});
