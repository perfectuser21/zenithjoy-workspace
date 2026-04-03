#!/usr/bin/env node
const _log = console.log.bind(console);
/**
 * 注册表验证
 *
 * 检查 registry.json 中声明的所有脚本文件是否存在且语法正确。
 * 同时验证 docs/registry/features/*.yml 中的 capabilities 层。
 * 用法: node validate-registry.cjs
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const REGISTRY_PATH = path.join(__dirname, 'registry.json');
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FEATURES_DIR = path.join(REPO_ROOT, 'docs', 'registry', 'features');

// ========== Part 1: registry.json 验证 ==========

function validateRegistryJson() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    _log('❌ registry.json 不存在');
    return 1;
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

  return errors;
}

// ========== Part 2: capabilities 层验证 ==========

/**
 * 简易 YAML 解析器 — 只需要提取 feature 的 entry_files 和 capabilities 段。
 * 不引入第三方依赖，通过正则 + 行级扫描完成。
 */
function parseCapabilitiesFromYml(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const features = [];
  let currentFeature = null;
  let inEntryFiles = false;
  let inCapabilities = false;
  let currentCap = null;
  let inCapTests = false;
  let inCapTestUnit = false;
  let inCapTestIntegration = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimEnd();

    // 检测 feature_id
    const featureMatch = trimmed.match(/^\s+-\s+feature_id:\s+(\S+)/);
    if (featureMatch) {
      if (currentCap && currentFeature) {
        currentFeature.capabilities.push(currentCap);
        currentCap = null;
      }
      if (currentFeature) features.push(currentFeature);
      currentFeature = {
        feature_id: featureMatch[1],
        entry_files: [],
        capabilities: [],
        code_root: null,
      };
      inEntryFiles = false;
      inCapabilities = false;
      inCapTests = false;
      inCapTestUnit = false;
      inCapTestIntegration = false;
      continue;
    }

    if (!currentFeature) continue;

    // code.root
    const rootMatch = trimmed.match(/^\s+root:\s+(\S+)/);
    if (rootMatch && !inCapabilities) {
      currentFeature.code_root = rootMatch[1];
    }

    // entry_files 段（非 capabilities 下的）
    if (trimmed.match(/^\s+entry_files:/) && !inCapabilities) {
      // 行内数组: entry_files: [a.js, b.js]
      const inlineMatch = trimmed.match(/entry_files:\s*\[(.+)\]/);
      if (inlineMatch) {
        currentFeature.entry_files = inlineMatch[1].split(',').map(s => s.trim());
        inEntryFiles = false;
      } else {
        inEntryFiles = true;
      }
      continue;
    }

    if (inEntryFiles) {
      const itemMatch = trimmed.match(/^\s+-\s+(\S+)/);
      if (itemMatch) {
        currentFeature.entry_files.push(itemMatch[1]);
      } else {
        inEntryFiles = false;
      }
    }

    // capabilities 段
    if (trimmed.match(/^\s+capabilities:$/)) {
      inCapabilities = true;
      inEntryFiles = false;
      continue;
    }

    if (inCapabilities) {
      // 新 capability 条目
      const capIdMatch = trimmed.match(/^\s+-\s+id:\s+(\S+)/);
      if (capIdMatch) {
        if (currentCap) {
          currentFeature.capabilities.push(currentCap);
        }
        currentCap = {
          id: capIdMatch[1],
          entry_file: null,
          tests_unit: [],
          tests_integration: [],
        };
        inCapTests = false;
        inCapTestUnit = false;
        inCapTestIntegration = false;
        continue;
      }

      if (currentCap) {
        const entryMatch = trimmed.match(/^\s+entry_file:\s+(\S+)/);
        if (entryMatch) {
          currentCap.entry_file = entryMatch[1];
          continue;
        }

        if (trimmed.match(/^\s+tests:$/)) {
          inCapTests = true;
          inCapTestUnit = false;
          inCapTestIntegration = false;
          continue;
        }

        if (inCapTests) {
          if (trimmed.match(/^\s+unit:$/)) {
            inCapTestUnit = true;
            inCapTestIntegration = false;
            continue;
          }
          const unitInline = trimmed.match(/^\s+unit:\s*\[(.*)?\]/);
          if (unitInline) {
            if (unitInline[1] && unitInline[1].trim()) {
              currentCap.tests_unit = unitInline[1].split(',').map(s => s.trim());
            }
            inCapTestUnit = false;
            continue;
          }
          if (trimmed.match(/^\s+integration:$/)) {
            inCapTestIntegration = true;
            inCapTestUnit = false;
            continue;
          }
          const intInline = trimmed.match(/^\s+integration:\s*\[(.*)?\]/);
          if (intInline) {
            if (intInline[1] && intInline[1].trim()) {
              currentCap.tests_integration = intInline[1].split(',').map(s => s.trim());
            }
            inCapTestIntegration = false;
            continue;
          }

          if (inCapTestUnit) {
            const testItem = trimmed.match(/^\s+-\s+(\S+)/);
            if (testItem) {
              currentCap.tests_unit.push(testItem[1]);
            } else {
              inCapTestUnit = false;
            }
          }
          if (inCapTestIntegration) {
            const testItem = trimmed.match(/^\s+-\s+(\S+)/);
            if (testItem) {
              currentCap.tests_integration.push(testItem[1]);
            } else {
              inCapTestIntegration = false;
            }
          }
        }
      }

      // 如果遇到非缩进行或新的 feature 级字段，退出 capabilities
      if (trimmed.match(/^\s{4}\w/) && !trimmed.match(/^\s{6}/)) {
        if (currentCap) {
          currentFeature.capabilities.push(currentCap);
          currentCap = null;
        }
        inCapabilities = false;
      }
    }
  }

  // 最后一个
  if (currentCap && currentFeature) {
    currentFeature.capabilities.push(currentCap);
  }
  if (currentFeature) features.push(currentFeature);

  return features;
}

function validateCapabilities() {
  if (!fs.existsSync(FEATURES_DIR)) {
    _log('\n⚠️  docs/registry/features/ 目录不存在，跳过 capabilities 验证');
    return 0;
  }

  const ymlFiles = fs.readdirSync(FEATURES_DIR).filter(f => f.endsWith('.yml'));
  let errors = 0;
  let totalCaps = 0;
  let totalFeatures = 0;

  // 基础设施 feature 不需要 capabilities
  const infraFeatures = new Set(['pub_probe', 'pub_alert', 'pub_keepalive', 'pub_registry']);

  _log('\n=== Capabilities 层验证 ===\n');

  for (const ymlFile of ymlFiles) {
    const filePath = path.join(FEATURES_DIR, ymlFile);
    const features = parseCapabilitiesFromYml(filePath);

    _log(`${ymlFile} (${features.length} features)`);

    for (const feature of features) {
      totalFeatures++;

      // 基础设施跳过
      if (infraFeatures.has(feature.feature_id)) {
        _log(`  [${feature.feature_id}] 基础设施，跳过`);
        continue;
      }

      const caps = feature.capabilities;
      const entryCount = feature.entry_files.length;

      // 检查 1: capabilities 存在性
      if (!caps || caps.length === 0) {
        _log(`  ❌ [${feature.feature_id}] 缺少 capabilities 段`);
        errors++;
        continue;
      }

      // 检查 2: capabilities 数量和 entry_files 数量一致
      if (caps.length !== entryCount) {
        _log(`  ❌ [${feature.feature_id}] capabilities 数量 (${caps.length}) != entry_files 数量 (${entryCount})`);
        errors++;
      }

      for (const cap of caps) {
        totalCaps++;

        // 检查 3: capability.entry_file 必须存在于磁盘
        if (cap.entry_file && feature.code_root) {
          const entryPath = path.join(REPO_ROOT, feature.code_root, cap.entry_file);
          if (!fs.existsSync(entryPath)) {
            _log(`  ❌ [${cap.id}] entry_file 不存在: ${feature.code_root}${cap.entry_file}`);
            errors++;
          } else {
            _log(`  ✅ [${cap.id}] ${cap.entry_file}`);
          }
        }

        // 检查 4: capability 的 test 文件必须存在于磁盘
        const allTests = [...(cap.tests_unit || []), ...(cap.tests_integration || [])];
        for (const testFile of allTests) {
          const testPath = path.join(REPO_ROOT, testFile);
          if (!fs.existsSync(testPath)) {
            _log(`  ❌ [${cap.id}] 测试文件不存在: ${testFile}`);
            errors++;
          }
        }
      }
    }
    _log('');
  }

  _log(`--- Capabilities 汇总 ---`);
  _log(`Features: ${totalFeatures}`);
  _log(`Capabilities: ${totalCaps} 个（❌ ${errors} 个问题）`);

  return errors;
}

// ========== Main ==========

function main() {
  const registryErrors = validateRegistryJson();
  const capErrors = validateCapabilities();
  const totalErrors = registryErrors + capErrors;

  _log('\n=== 最终结果 ===');
  if (totalErrors > 0) {
    _log(`❌ 验证失败（${totalErrors} 个错误）`);
    process.exit(1);
  }
  _log('✅ 全部通过');
}

main();
