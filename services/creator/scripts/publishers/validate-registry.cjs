#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 注册表验证
 *
 * 检查 registry.json 中声明的所有脚本文件是否存在且语法正确。
 * 用法: node validate-registry.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');

function main() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    _log('❌ registry.json 不存在');
    process.exit(1);
  }

  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
  const platforms = registry.platforms;
  let errors = 0;
  let total = 0;

  _log('=== Publisher Registry 验证 ===\n');

  for (const [id, platform] of Object.entries(platforms)) {
    const types = platform.content_types || [];
    const scripts = platform.scripts || {};
    _log(`${platform.name} (${id}) — ${platform.mode || 'cdp'} — 类型: ${types.join(', ')}`);

    for (const [type, scriptPath] of Object.entries(scripts)) {
      total++;
      const fullPath = path.join(__dirname, scriptPath);
      const exists = fs.existsSync(fullPath);

      if (!exists) {
        _log(`  ❌ [${type}] ${scriptPath} — 文件不存在`);
        errors++;
        continue;
      }

      // node --check 语法验证
      try {
        execSync(`node --check "${fullPath}"`, { stdio: 'pipe' });
        _log(`  ✅ [${type}] ${scriptPath}`);
      } catch (e) {
        _log(`  ❌ [${type}] ${scriptPath} — 语法错误`);
        errors++;
      }
    }
    _log('');
  }

  _log(`--- 汇总 ---`);
  _log(`平台: ${Object.keys(platforms).length}`);
  _log(`脚本: ${total} 个（✅ ${total - errors} 通过，❌ ${errors} 失败）`);

  if (errors > 0) {
    _log('\n❌ 验证失败');
    process.exit(1);
  }
  _log('\n✅ 全部通过');
}

main();
