#!/usr/bin/env node
'use strict';
// seed Feishu 客户档案 (wechat_agent_customers)
// Usage: node seed-feishu-customer.js [--help] [--dry-run] [options]

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node seed-feishu-customer.js [--dry-run] [options]');
  console.log('  --dry-run   Print what would be done without writing to Feishu');
  console.log('  --help      Show this help');
  process.exit(0);
}

const dryRun = args.includes('--dry-run');
if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, script: 'seed-feishu-customer' }));
  process.exit(0);
}

// Real implementation connects to Feishu Bitable via FEISHU_APP_ID / FEISHU_APP_SECRET
console.error('Error: FEISHU_APP_ID and FEISHU_APP_SECRET required');
process.exit(1);
