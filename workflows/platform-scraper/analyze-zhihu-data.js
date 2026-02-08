#!/usr/bin/env node
/**
 * 知乎数据分析脚本
 * 分析已采集数据的结构和内容类型分布
 */
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.env.HOME, '.platform-data');

async function analyzeZhihuData() {
  console.log('📊 开始分析知乎数据...\n');

  // 读取所有知乎数据文件
  const files = fs.readdirSync(DATA_DIR)
    .filter(f => f.startsWith('zhihu_') && f.endsWith('.json'))
    .sort();

  console.log(`找到 ${files.length} 个知乎数据文件:\n`);
  files.forEach(f => console.log(`  - ${f}`));
  console.log('');

  // 读取最新文件
  const latestFile = files[files.length - 1];
  const filePath = path.join(DATA_DIR, latestFile);
  const content = fs.readFileSync(filePath, 'utf-8');
  const data = JSON.parse(content);

  console.log(`📄 分析文件: ${latestFile}\n`);
  console.log('基础信息:');
  console.log(`  - 平台: ${data.platform}`);
  console.log(`  - 平台代码: ${data.platform_code}`);
  console.log(`  - 总数: ${data.count}`);
  console.log(`  - 采集时间: ${data.scraped_at}`);
  console.log('');

  // 分析内容类型
  const typeStats = {};
  const allFields = new Set();
  const fieldsByType = {};

  data.items.forEach(item => {
    const type = item.type || 'unknown';
    typeStats[type] = (typeStats[type] || 0) + 1;

    // 收集所有字段
    Object.keys(item).forEach(key => {
      allFields.add(key);
      if (!fieldsByType[type]) fieldsByType[type] = new Set();
      fieldsByType[type].add(key);
    });
  });

  console.log('内容类型分布:');
  Object.entries(typeStats).forEach(([type, count]) => {
    const percentage = ((count / data.count) * 100).toFixed(1);
    console.log(`  - ${type}: ${count} 条 (${percentage}%)`);
  });
  console.log('');

  // 分析字段
  console.log('字段分析:');
  console.log(`  - 总共有 ${allFields.size} 个不同的字段\n`);

  // 按类型列出字段
  Object.entries(fieldsByType).forEach(([type, fields]) => {
    console.log(`\n${type} 字段 (${fields.size} 个):`);
    const fieldList = Array.from(fields).sort();
    fieldList.forEach(field => {
      console.log(`  - ${field}`);
    });
  });

  // 分析字段值
  console.log('\n\n字段值统计:');
  const fieldValueStats = {};

  data.items.forEach(item => {
    Object.entries(item).forEach(([key, value]) => {
      if (!fieldValueStats[key]) {
        fieldValueStats[key] = {
          totalCount: 0,
          nonZeroCount: 0,
          nonNullCount: 0,
          examples: []
        };
      }

      fieldValueStats[key].totalCount++;
      if (value !== 0 && value !== '0') fieldValueStats[key].nonZeroCount++;
      if (value !== null && value !== undefined) fieldValueStats[key].nonNullCount++;

      // 保存前3个示例
      if (fieldValueStats[key].examples.length < 3) {
        fieldValueStats[key].examples.push(value);
      }
    });
  });

  console.log('\n字段详情（非零值统计）:');
  Object.entries(fieldValueStats)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([field, stats]) => {
      const hasValue = stats.nonZeroCount > 0 || stats.nonNullCount > 0;
      const status = hasValue ? '✅ 有值' : '❌ 全为0/null';
      console.log(`\n  ${field}:`);
      console.log(`    状态: ${status}`);
      console.log(`    非零值: ${stats.nonZeroCount}/${stats.totalCount}`);
      console.log(`    示例: ${JSON.stringify(stats.examples.slice(0, 3))}`);
    });

  // 保存完整分析结果
  const analysisResult = {
    file: latestFile,
    analyzedAt: new Date().toISOString(),
    summary: {
      totalItems: data.count,
      typeDistribution: typeStats,
      totalFields: allFields.size
    },
    fields: {
      all: Array.from(allFields).sort(),
      byType: Object.fromEntries(
        Object.entries(fieldsByType).map(([type, fields]) => [type, Array.from(fields).sort()])
      )
    },
    fieldStats: fieldValueStats
  };

  const outputPath = '/tmp/zhihu-data-analysis.json';
  fs.writeFileSync(outputPath, JSON.stringify(analysisResult, null, 2));
  console.log(`\n\n✅ 完整分析结果已保存到: ${outputPath}`);

  // 随机抽取3个完整示例
  console.log('\n\n示例数据（随机抽取3个）:\n');
  const sampleIndices = [0, Math.floor(data.items.length / 2), data.items.length - 1];
  sampleIndices.forEach(idx => {
    console.log(`\n示例 #${idx + 1}:`);
    console.log(JSON.stringify(data.items[idx], null, 2));
  });

  // 保存API响应示例
  const apiSamplePath = '/tmp/zhihu-api-response.json';
  fs.writeFileSync(apiSamplePath, JSON.stringify({
    summary: {
      platform: data.platform,
      count: data.count,
      scraped_at: data.scraped_at
    },
    samples: sampleIndices.map(idx => data.items[idx])
  }, null, 2));
  console.log(`\n\n✅ API 响应示例已保存到: ${apiSamplePath}`);
}

analyzeZhihuData().catch(console.error);
