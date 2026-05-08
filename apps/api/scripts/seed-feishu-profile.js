#!/usr/bin/env node
/**
 * seed-feishu-profile.js — 在飞书"营销画像"表插入一行
 *
 * Usage:
 *   node apps/api/scripts/seed-feishu-profile.js --customer=<c> --industry=<i> --audience=<a> --hook=<h>
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node seed-feishu-profile.js --customer=<c> --industry=<i> --audience=<a> --hook=<h>
  --customer   关联客户名（必填）
  --industry   行业（必填）
  --audience   受众（必填）
  --hook       钩子文案（必填）
  --help       Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    process.stdout.write(`mock_profile_${Date.now()}\n`);
    return 0;
  }

  for (const k of ['customer', 'industry', 'audience', 'hook']) {
    if (!args[k]) {
      process.stderr.write(`FAIL: --${k} 必填\n`);
      process.exit(2);
    }
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_PROFILE_TABLE_ID}/records`;
  const r = await helper.postJson(
    url,
    {
      fields: {
        行业: String(args.industry),
        受众: String(args.audience),
        钩子文案: String(args.hook),
      },
    },
    { Authorization: `Bearer ${token}` },
  );
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
