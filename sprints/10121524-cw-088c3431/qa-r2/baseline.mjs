#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const appDir = path.join(ROOT, 'apps', 'staff-hub');
const banned = ['openai', 'anthropic', '@anthropic-ai/sdk'];

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      files.push(...walk(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

if (!fs.existsSync(appDir)) {
  console.error('apps/staff-hub not found');
  process.exit(1);
}

const offenders = [];
for (const file of walk(appDir)) {
  const content = fs.readFileSync(file, 'utf8');
  for (const mod of banned) {
    if (content.includes(`from '${mod}'`) || content.includes(`from "${mod}"`) || content.includes(`require('${mod}')`) || content.includes(`require("${mod}")`)) {
      offenders.push(`${file}: ${mod}`);
    }
  }
}

if (offenders.length > 0) {
  console.error(offenders.join('\n'));
  process.exit(1);
}

console.log('OK');
