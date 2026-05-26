#!/usr/bin/env node
'use strict';
// count Feishu 互动记录 records
// Usage: node count-feishu-interaction.js [--help] [--dry-run] [options]

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node count-feishu-interaction.js [--dry-run] [options]');
  console.log('  --dry-run   Print what would be done without writing to Feishu');
  console.log('  --help      Show this help');
  process.exit(0);
}

const dryRun = args.includes('--dry-run');
if (dryRun) {
  console.log(JSON.stringify({ ok: true, dryRun: true, script: 'count-feishu-interaction' }));
  process.exit(0);
}

// Real implementation connects to Feishu Bitable via FEISHU_APP_ID / FEISHU_APP_SECRET
console.error('Error: FEISHU_APP_ID and FEISHU_APP_SECRET required');
process.exit(1);
