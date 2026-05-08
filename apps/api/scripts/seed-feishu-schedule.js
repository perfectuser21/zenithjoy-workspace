#!/usr/bin/env node
/**
 * seed-feishu-schedule.js — 在飞书"内容排期"表插入一行
 *
 * Usage:
 *   node apps/api/scripts/seed-feishu-schedule.js --customer=<c> --content=<x> --status=<s>
 *   --help    Show this help
 */
const helper = require('./_feishu-helper');

const USAGE = `Usage: node seed-feishu-schedule.js --customer=<c> --content=<x> --status=<s>
  --customer   关联客户（必填）
  --content    草稿文案（必填）
  --status     初始状态（必填，例：draft|pending_review|approved|rejected|published）
  --help       Show this help`;

async function main() {
  const args = helper.parseArgs(process.argv);
  if (args.help) helper.showHelpAndExit(USAGE);

  if (helper.isMockMode()) {
    process.stdout.write(`mock_schedule_${Date.now()}\n`);
    return 0;
  }

  for (const k of ['customer', 'content', 'status']) {
    if (!args[k]) {
      process.stderr.write(`FAIL: --${k} 必填\n`);
      process.exit(2);
    }
  }

  const env = { ...helper.loadCredentials(), ...process.env };
  const token = await helper.getTenantToken();
  const draftId = `draft_${Date.now()}`;
  const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${env.FEISHU_TEST_APP_TOKEN}/tables/${env.FEISHU_SCHEDULE_TABLE_ID}/records`;
  const r = await helper.postJson(
    url,
    {
      fields: {
        '草稿 ID': draftId,
        生成时间: Date.now(),
        文案: String(args.content),
        排期时间: Date.now() + 60 * 60 * 1000,
        状态: String(args.status),
      },
    },
    { Authorization: `Bearer ${token}` },
  );
  if (r.code !== 0) {
    process.stderr.write('FAIL: ' + JSON.stringify(r) + '\n');
    process.exit(1);
  }
  process.stdout.write(draftId + '\n');
}

main().catch((e) => {
  process.stderr.write(`FAIL: ${e.message}\n`);
  process.exit(1);
});
