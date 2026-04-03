#!/usr/bin/env node
'use strict';

/**
 * Registry Auto-Sync Phase 0 — 只读检查 + CI block
 *
 * 扫描 services/creator/scripts/publishers/ 目录，
 * 与 docs/registry/features/publisher.yml + docs/registry/system-registry.yml 对比，
 * 发现漂移则 exit 1（CI block PR）。
 *
 * 零外部依赖 — 只用 node 内置模块 + 简易 YAML 行解析。
 */

const fs = require('fs');
const path = require('path');

const _log = console.log.bind(console);

// ─── 常量 ──────────────────────────────────────────────────────
const REPO_ROOT = path.resolve(__dirname, '..');
const PUBLISHERS_DIR = path.join(REPO_ROOT, 'services/creator/scripts/publishers');
const PUBLISHER_YML = path.join(REPO_ROOT, 'docs/registry/features/publisher.yml');
const SYSTEM_YML = path.join(REPO_ROOT, 'docs/registry/system-registry.yml');

// 入口脚本模式（publish-*, check-*）
const ENTRY_PATTERNS = [/^publish-.*\.(cjs|js)$/, /^check-.*\.(cjs|js)$/];

// 排除目录/文件（不算入口脚本）
const EXCLUDE_DIRS = ['__tests__', 'node_modules', '.cookie-backups'];
const EXCLUDE_FILES = [
  /\.test\.(cjs|js)$/,
  /^batch-.*\.sh$/,
  /^utils\.cjs$/,
  /^cdp-client\.cjs$/,
  /^keepalive\.cjs$/,        // 子目录下的辅助保活
  /^publish-.*-api\.cjs$/,   // API 辅助模块，不是独立入口
];

// 基础设施脚本（在 publishers 根目录）
const INFRA_SCRIPTS = [
  'probe-all-platforms.cjs',
  'alert-offline.cjs',
  'keepalive-all.cjs',
  'validate-registry.cjs',
  'registry.json',
];

// ─── 简易 YAML 解析器 ─────────────────────────────────────────
// 只解析 publisher.yml 和 system-registry.yml 需要的结构，
// 不做通用解析。

function parsePublisherYml(content) {
  const features = [];
  let current = null;
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // feature_id 标记新 feature 开始
    const fidMatch = trimmed.match(/^-\s+feature_id:\s*(.+)/);
    if (fidMatch) {
      current = {
        feature_id: fidMatch[1].trim(),
        root: '',
        entry_files: [],
        tests_unit: [],
        skills: [],
        maturity: 0,
        docs: { prd: null, dod: null, adr: null, api_doc: null, runbook: null },
      };
      features.push(current);
      continue;
    }
    if (!current) continue;

    // root
    const rootMatch = trimmed.match(/^root:\s*(.+)/);
    if (rootMatch) {
      current.root = rootMatch[1].trim();
      continue;
    }

    // maturity
    const matMatch = trimmed.match(/^maturity:\s*(\d+)/);
    if (matMatch) {
      current.maturity = parseInt(matMatch[1], 10);
      continue;
    }

    // entry_files（支持 inline 数组和多行列表）
    const efInline = trimmed.match(/^entry_files:\s*\[(.+)\]/);
    if (efInline) {
      current.entry_files = efInline[1].split(',').map(s => s.trim().replace(/"/g, ''));
      continue;
    }
    if (trimmed === 'entry_files:') {
      // 多行列表
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j].trimStart();
        if (sub.startsWith('- ')) {
          current.entry_files.push(sub.slice(2).trim().replace(/"/g, ''));
          i = j;
        } else {
          break;
        }
      }
      continue;
    }

    // tests > unit（多行列表）
    if (trimmed === 'unit:') {
      for (let j = i + 1; j < lines.length; j++) {
        const sub = lines[j].trimStart();
        if (sub.startsWith('- ')) {
          const val = sub.slice(2).trim().replace(/"/g, '');
          if (val) current.tests_unit.push(val);
          i = j;
        } else {
          break;
        }
      }
      continue;
    }

    // docs 字段
    const docsFields = ['prd', 'dod', 'adr', 'api_doc', 'runbook'];
    for (const df of docsFields) {
      const dMatch = trimmed.match(new RegExp(`^${df}:\\s*(.+)`));
      if (dMatch) {
        const val = dMatch[1].trim();
        current.docs[df] = val === 'null' ? null : val;
        break;
      }
    }

    // skills（简化：检查 skill_file 或 name）
    const skillFileMatch = trimmed.match(/^skill_file:\s*(.+)/);
    if (skillFileMatch) {
      current.skills.push(skillFileMatch[1].trim());
      continue;
    }
    const skillNameMatch = trimmed.match(/^-\s+name:\s*(.+)/);
    if (skillNameMatch && i > 0) {
      // 判断是否在 skills 上下文（向上找 skills:）
      for (let k = i - 1; k >= Math.max(0, i - 10); k--) {
        if (lines[k].trimStart().startsWith('skills:')) {
          // 这是 skills 下的 name
          current._hasSkillName = true;
          break;
        }
        if (lines[k].trimStart().match(/^-\s+feature_id:/)) break;
      }
    }
  }

  return features;
}

function parseSystemYml(content) {
  const systems = [];
  let current = null;
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trimStart();

    const idMatch = trimmed.match(/^-\s+id:\s*(.+)/);
    if (idMatch) {
      current = { id: idMatch[1].trim(), feature_count: 0, features_file: '' };
      systems.push(current);
      continue;
    }
    if (!current) continue;

    const fcMatch = trimmed.match(/^feature_count:\s*(\d+)/);
    if (fcMatch) {
      current.feature_count = parseInt(fcMatch[1], 10);
      continue;
    }

    const ffMatch = trimmed.match(/^features_file:\s*(.+)/);
    if (ffMatch) {
      current.features_file = ffMatch[1].trim();
      continue;
    }
  }

  return systems;
}

// ─── 文件系统扫描 ──────────────────────────────────────────────

function isEntryFile(filename) {
  return ENTRY_PATTERNS.some(p => p.test(filename));
}

function isExcludedFile(filename) {
  return EXCLUDE_FILES.some(p => p.test(filename));
}

/**
 * 扫描一个平台子目录，返回 { entryFiles, testFiles, hasSkillMd, hasStatusMd }
 */
function scanPlatformDir(dirPath) {
  const result = { entryFiles: [], testFiles: [], hasSkillMd: false, hasStatusMd: false };

  if (!fs.existsSync(dirPath)) return result;

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    if (EXCLUDE_DIRS.includes(entry.name)) {
      // 扫描 __tests__
      if (entry.name === '__tests__' && entry.isDirectory()) {
        const testDir = path.join(dirPath, '__tests__');
        const testEntries = fs.readdirSync(testDir);
        for (const tf of testEntries) {
          if (/\.(test|spec)\.(cjs|js)$/.test(tf)) {
            const relPath = path.relative(REPO_ROOT, path.join(testDir, tf));
            result.testFiles.push(relPath);
          }
        }
      }
      continue;
    }

    if (!entry.isFile()) continue;

    if (entry.name === 'SKILL.md') {
      result.hasSkillMd = true;
      continue;
    }
    if (entry.name === 'STATUS.md') {
      result.hasStatusMd = true;
      continue;
    }

    if (isExcludedFile(entry.name)) continue;

    if (isEntryFile(entry.name)) {
      result.entryFiles.push(entry.name);
    }
  }

  return result;
}

/**
 * 扫描 publishers 根目录的基础设施脚本
 */
function scanInfraFiles() {
  const found = [];
  if (!fs.existsSync(PUBLISHERS_DIR)) return found;

  const entries = fs.readdirSync(PUBLISHERS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile() && INFRA_SCRIPTS.includes(entry.name)) {
      found.push(entry.name);
    }
  }
  return found;
}

/**
 * 获取所有平台子目录名
 */
function getPlatformDirs() {
  if (!fs.existsSync(PUBLISHERS_DIR)) return [];
  return fs.readdirSync(PUBLISHERS_DIR, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name.endsWith('-publisher'))
    .map(e => e.name);
}

// ─── 检查逻辑 ──────────────────────────────────────────────────

class Checker {
  constructor() {
    this.checks = 0;
    this.passes = 0;
    this.failures = 0;
    this.details = [];
  }

  pass(featureId, category, msg) {
    this.checks++;
    this.passes++;
    this.details.push({ featureId, ok: true, category, msg });
  }

  fail(featureId, category, msg) {
    this.checks++;
    this.failures++;
    this.details.push({ featureId, ok: false, category, msg });
  }

  report() {
    _log('');
    _log('=== Registry Sync Check ===');
    _log('');

    // 按 feature 分组
    const byFeature = {};
    for (const d of this.details) {
      const fid = d.featureId || '_system';
      if (!byFeature[fid]) byFeature[fid] = [];
      byFeature[fid].push(d);
    }

    // 先输出 feature 级别
    const featureIds = Object.keys(byFeature).filter(k => k !== '_system').sort();
    if (featureIds.length > 0) {
      _log(`[publisher.yml] 检查 ${featureIds.length} features...`);
      _log('');
      for (const fid of featureIds) {
        _log(`  ${fid}:`);
        for (const d of byFeature[fid]) {
          const icon = d.ok ? '  \u2705' : '  \u274C';
          _log(`  ${icon} ${d.category}: ${d.msg}`);
        }
        _log('');
      }
    }

    // 系统级别
    if (byFeature['_system']) {
      _log('[system-registry.yml]');
      for (const d of byFeature['_system']) {
        const icon = d.ok ? '  \u2705' : '  \u274C';
        _log(`${icon} ${d.category}: ${d.msg}`);
      }
      _log('');
    }

    _log(`结果: ${this.checks} 检查, ${this.passes} 通过, ${this.failures} 失败`);
    return this.failures;
  }
}

// ─── 主流程 ────────────────────────────────────────────────────

function main() {
  // 读取 registry 文件
  if (!fs.existsSync(PUBLISHER_YML)) {
    _log('错误: 找不到 ' + PUBLISHER_YML);
    process.exit(1);
  }
  if (!fs.existsSync(SYSTEM_YML)) {
    _log('错误: 找不到 ' + SYSTEM_YML);
    process.exit(1);
  }

  const publisherContent = fs.readFileSync(PUBLISHER_YML, 'utf8');
  const systemContent = fs.readFileSync(SYSTEM_YML, 'utf8');

  const registryFeatures = parsePublisherYml(publisherContent);
  const systems = parseSystemYml(systemContent);

  const checker = new Checker();

  // 建立 feature_id → registry feature 映射
  const featureMap = new Map();
  for (const f of registryFeatures) {
    featureMap.set(f.feature_id, f);
  }

  // ────────────────────────────────────────────────────────────
  // 1. 平台发布器检查
  // ────────────────────────────────────────────────────────────
  const platformDirs = getPlatformDirs();

  for (const dirName of platformDirs) {
    const dirPath = path.join(PUBLISHERS_DIR, dirName);
    const scan = scanPlatformDir(dirPath);

    // 找到对应的 registry feature
    // 命名规则: douyin-publisher → pub_douyin
    const platformName = dirName.replace(/-publisher$/, '').replace(/-/g, '_');
    const featureId = `pub_${platformName}`;
    const regFeature = featureMap.get(featureId);

    if (!regFeature) {
      // 代码目录存在但 registry 没有对应 feature — 报错
      checker.fail(featureId, 'registration', `目录 ${dirName}/ 存在但 registry 未注册该 feature`);
      continue;
    }

    // ── entry_files 漂移检查 ──
    const regEntries = new Set(regFeature.entry_files);
    const diskEntries = new Set(scan.entryFiles);

    // 代码有但 registry 没注册
    const unregistered = [...diskEntries].filter(f => !regEntries.has(f));
    // registry 声明但文件不存在
    const ghosts = [...regEntries].filter(f => !diskEntries.has(f));

    // 幽灵文件需要检查实际文件是否存在（registry 可能用不同路径）
    const confirmedGhosts = ghosts.filter(f => {
      const fullPath = path.join(dirPath, f);
      return !fs.existsSync(fullPath);
    });

    if (unregistered.length === 0 && confirmedGhosts.length === 0) {
      checker.pass(featureId, 'entry_files', `${regEntries.size} 个全部匹配`);
    } else {
      if (unregistered.length > 0) {
        checker.fail(featureId, 'entry_files', `代码新增未注册: ${unregistered.join(', ')}`);
      }
      if (confirmedGhosts.length > 0) {
        checker.fail(featureId, 'entry_files', `幽灵引用(文件不存在): ${confirmedGhosts.join(', ')}`);
      }
    }

    // ── 测试漂移检查 ──
    const regTests = new Set(regFeature.tests_unit);
    const diskTests = new Set(scan.testFiles);

    const unregisteredTests = [...diskTests].filter(t => !regTests.has(t));
    const ghostTests = [...regTests].filter(t => {
      const fullPath = path.join(REPO_ROOT, t);
      return !fs.existsSync(fullPath);
    });

    if (unregisteredTests.length === 0 && ghostTests.length === 0) {
      const testCount = regTests.size;
      if (testCount === 0 && regFeature.maturity <= 1) {
        checker.pass(featureId, 'tests', `0 个（maturity=${regFeature.maturity} 不要求）`);
      } else {
        checker.pass(featureId, 'tests', `${testCount} 个全部匹配`);
      }
    } else {
      if (unregisteredTests.length > 0) {
        checker.fail(featureId, 'tests', `发现未注册测试: ${unregisteredTests.join(', ')}`);
      }
      if (ghostTests.length > 0) {
        checker.fail(featureId, 'tests', `幽灵测试(文件不存在): ${ghostTests.join(', ')}`);
      }
    }

    // ── skill 漂移检查 ──
    if (scan.hasSkillMd) {
      // 检查 registry 是否有 skills 注册
      const hasSkillInRegistry = regFeature.skills.length > 0 || regFeature._hasSkillName;
      if (hasSkillInRegistry) {
        checker.pass(featureId, 'skills', 'SKILL.md 已注册');
      } else {
        checker.fail(featureId, 'skills', '代码有 SKILL.md 但 registry skills 段为空');
      }
    } else {
      checker.pass(featureId, 'skills', '无 SKILL.md（无需注册）');
    }

    // ── maturity 不诚实检查 ──
    if (regFeature.maturity >= 2 && regFeature.tests_unit.length === 0) {
      checker.fail(featureId, 'maturity', `maturity=${regFeature.maturity} 但 tests.unit 为空`);
    } else if (regFeature.maturity >= 1) {
      // maturity >= 1 但 docs 全是 null（STATUS.md 算 runbook）
      const allDocsNull = Object.values(regFeature.docs).every(v => v === null);
      if (allDocsNull && !scan.hasStatusMd) {
        checker.fail(featureId, 'maturity', `maturity=${regFeature.maturity} 但 docs 全为 null 且无 STATUS.md`);
      } else {
        checker.pass(featureId, 'maturity', `${regFeature.maturity}（合理）`);
      }
    } else {
      checker.pass(featureId, 'maturity', `${regFeature.maturity}（合理）`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 2. 基础设施 feature 检查
  // ────────────────────────────────────────────────────────────
  const infraFeatureIds = ['pub_probe', 'pub_alert', 'pub_keepalive', 'pub_registry'];
  for (const fid of infraFeatureIds) {
    const regFeature = featureMap.get(fid);
    if (!regFeature) {
      checker.fail(fid, 'registration', 'registry 未注册该基础设施 feature');
      continue;
    }

    // entry_files 幽灵检查
    const rootDir = path.join(REPO_ROOT, regFeature.root);
    const ghosts = regFeature.entry_files.filter(f => {
      return !fs.existsSync(path.join(rootDir, f));
    });

    if (ghosts.length === 0) {
      checker.pass(fid, 'entry_files', `${regFeature.entry_files.length} 个全部存在`);
    } else {
      checker.fail(fid, 'entry_files', `幽灵引用(文件不存在): ${ghosts.join(', ')}`);
    }

    // maturity 检查
    if (regFeature.maturity >= 2 && regFeature.tests_unit.length === 0) {
      checker.fail(fid, 'maturity', `maturity=${regFeature.maturity} 但 tests.unit 为空`);
    } else {
      checker.pass(fid, 'maturity', `${regFeature.maturity}（合理）`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 3. system-registry.yml feature_count 检查
  // ────────────────────────────────────────────────────────────
  const publisherSystem = systems.find(s => s.id === 'publisher');
  if (publisherSystem) {
    const actualCount = registryFeatures.length;
    if (publisherSystem.feature_count === actualCount) {
      checker.pass(null, `publisher.feature_count`, `${publisherSystem.feature_count} = 实际 ${actualCount}`);
    } else {
      checker.fail(null, `publisher.feature_count`, `${publisherSystem.feature_count} ≠ 实际 ${actualCount}`);
    }
  } else {
    checker.fail(null, 'publisher.feature_count', 'system-registry.yml 中找不到 publisher system');
  }

  // 检查其他 system 的 feature_count（如果 features 文件存在）
  for (const sys of systems) {
    if (sys.id === 'publisher') continue; // 已检查

    const featuresPath = path.join(REPO_ROOT, 'docs/registry', sys.features_file);
    if (!fs.existsSync(featuresPath)) continue;

    const featContent = fs.readFileSync(featuresPath, 'utf8');
    // 简单计数 feature_id 出现次数
    const featureIdMatches = featContent.match(/feature_id:\s/g);
    const actualCount = featureIdMatches ? featureIdMatches.length : 0;

    if (sys.feature_count === actualCount) {
      checker.pass(null, `${sys.id}.feature_count`, `${sys.feature_count} = 实际 ${actualCount}`);
    } else {
      checker.fail(null, `${sys.id}.feature_count`, `${sys.feature_count} ≠ 实际 ${actualCount}`);
    }
  }

  // ────────────────────────────────────────────────────────────
  // 4. 反向检查：registry 有但代码目录不存在的平台
  // ────────────────────────────────────────────────────────────
  const platformFeatures = registryFeatures.filter(f => f.feature_id.startsWith('pub_') && !infraFeatureIds.includes(f.feature_id));
  for (const f of platformFeatures) {
    const rootPath = path.join(REPO_ROOT, f.root);
    if (!fs.existsSync(rootPath)) {
      checker.fail(f.feature_id, 'code_root', `registry root ${f.root} 目录不存在`);
    }
  }

  // ── 输出报告 ──
  const failures = checker.report();
  process.exit(failures > 0 ? 1 : 0);
}

main();
