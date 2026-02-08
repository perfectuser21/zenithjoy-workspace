#!/usr/bin/env node
/**
 * 测试知乎分析脚本
 * 验证：
 * 1. 数据文件存在且可读
 * 2. 分析结果正确
 * 3. 输出文件生成
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.env.HOME, '.platform-data');

async function testZhihuAnalysis() {
  console.log('🧪 测试知乎分析脚本...\n');

  let passed = 0;
  let failed = 0;

  // 测试1: 数据文件存在
  console.log('测试1: 检查数据文件...');
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('zhihu_') && f.endsWith('.json'));

    if (files.length > 0) {
      console.log(`✅ 找到 ${files.length} 个知乎数据文件`);
      passed++;
    } else {
      console.log('❌ 未找到知乎数据文件');
      failed++;
    }
  } catch (e) {
    console.log('❌ 无法读取数据目录:', e.message);
    failed++;
  }

  // 测试2: 数据结构正确
  console.log('\n测试2: 验证数据结构...');
  try {
    const files = fs.readdirSync(DATA_DIR)
      .filter(f => f.startsWith('zhihu_') && f.endsWith('.json'))
      .sort();
    const latestFile = files[files.length - 1];
    const filePath = path.join(DATA_DIR, latestFile);
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    const hasRequiredFields = data.platform && data.count && data.items;
    if (hasRequiredFields) {
      console.log('✅ 数据结构正确（platform, count, items）');
      passed++;
    } else {
      console.log('❌ 数据结构缺少必要字段');
      failed++;
    }

    // 验证items数组
    if (Array.isArray(data.items) && data.items.length > 0) {
      console.log(`✅ items 数组有效（${data.items.length} 条）`);
      passed++;

      // 验证单条数据字段
      const item = data.items[0];
      const hasItemFields = item.title && item.publishTime && item.type;
      if (hasItemFields) {
        console.log('✅ 单条数据字段完整（title, publishTime, type）');
        passed++;
      } else {
        console.log('❌ 单条数据字段不完整');
        failed++;
      }
    } else {
      console.log('❌ items 数组无效或为空');
      failed++;
    }
  } catch (e) {
    console.log('❌ 数据结构验证失败:', e.message);
    failed++;
  }

  // 测试3: 分析结果文件生成
  console.log('\n测试3: 检查分析结果文件...');
  const analysisFile = '/tmp/zhihu-data-analysis.json';
  const apiSampleFile = '/tmp/zhihu-api-response.json';

  try {
    if (fs.existsSync(analysisFile)) {
      const content = JSON.parse(fs.readFileSync(analysisFile, 'utf-8'));
      if (content.summary && content.fields) {
        console.log('✅ 分析结果文件正确生成');
        passed++;
      } else {
        console.log('❌ 分析结果文件格式不正确');
        failed++;
      }
    } else {
      console.log('❌ 分析结果文件未生成');
      failed++;
    }
  } catch (e) {
    console.log('❌ 分析结果文件验证失败:', e.message);
    failed++;
  }

  try {
    if (fs.existsSync(apiSampleFile)) {
      const content = JSON.parse(fs.readFileSync(apiSampleFile, 'utf-8'));
      if (content.summary && content.samples) {
        console.log('✅ API 响应示例文件正确生成');
        passed++;
      } else {
        console.log('❌ API 响应示例文件格式不正确');
        failed++;
      }
    } else {
      console.log('❌ API 响应示例文件未生成');
      failed++;
    }
  } catch (e) {
    console.log('❌ API 响应示例文件验证失败:', e.message);
    failed++;
  }

  // 测试4: 平台文档生成
  console.log('\n测试4: 检查平台文档...');
  const platformDoc = '/home/xx/.claude/skills/platform-scraper/platforms/zhihu.md';
  const comparisonDoc = '/tmp/zhihu-content-type-comparison.md';

  try {
    if (fs.existsSync(platformDoc)) {
      const content = fs.readFileSync(platformDoc, 'utf-8');
      if (content.includes('# 知乎平台分析') && content.includes('## 基本信息')) {
        console.log('✅ 平台文档正确生成');
        passed++;
      } else {
        console.log('❌ 平台文档格式不正确');
        failed++;
      }
    } else {
      console.log('❌ 平台文档未生成');
      failed++;
    }
  } catch (e) {
    console.log('❌ 平台文档验证失败:', e.message);
    failed++;
  }

  try {
    if (fs.existsSync(comparisonDoc)) {
      const content = fs.readFileSync(comparisonDoc, 'utf-8');
      if (content.includes('# 知乎内容类型字段对比分析')) {
        console.log('✅ 对比文档正确生成');
        passed++;
      } else {
        console.log('❌ 对比文档格式不正确');
        failed++;
      }
    } else {
      console.log('❌ 对比文档未生成');
      failed++;
    }
  } catch (e) {
    console.log('❌ 对比文档验证失败:', e.message);
    failed++;
  }

  // 测试5: Memory 更新
  console.log('\n测试5: 检查 Memory 更新...');
  const memoryFile = '/home/xx/.claude/projects/-home-xx-perfect21-zenithjoy-workspace/memory/MEMORY.md';

  try {
    if (fs.existsSync(memoryFile)) {
      const content = fs.readFileSync(memoryFile, 'utf-8');
      if (content.includes('知乎 ⚠️')) {
        console.log('✅ Memory 已更新（知乎条目存在）');
        passed++;
      } else {
        console.log('❌ Memory 未包含知乎条目');
        failed++;
      }
    } else {
      console.log('❌ Memory 文件不存在');
      failed++;
    }
  } catch (e) {
    console.log('❌ Memory 验证失败:', e.message);
    failed++;
  }

  // 总结
  console.log('\n' + '='.repeat(50));
  console.log('测试结果:');
  console.log(`  ✅ 通过: ${passed}`);
  console.log(`  ❌ 失败: ${failed}`);
  console.log(`  总计: ${passed + failed}`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 所有测试通过！');
    process.exit(0);
  } else {
    console.log('\n⚠️ 部分测试失败');
    process.exit(1);
  }
}

testZhihuAnalysis().catch(e => {
  console.error('测试脚本执行失败:', e);
  process.exit(1);
});
