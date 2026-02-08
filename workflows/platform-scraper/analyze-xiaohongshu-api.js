#!/usr/bin/env node
/**
 * 小红书字段分析脚本
 * 目标：拦截多个作品的 API 响应，分析图文和视频的字段差异
 */
const CDP = require('chrome-remote-interface');
const fs = require('fs');

const NODE_PC_HOST = '100.97.242.124';
const PORT = 19224;

async function main() {
  let client;
  const apiResponses = [];

  try {
    client = await CDP({ host: NODE_PC_HOST, port: PORT, timeout: 30000 });
    const { Runtime, Page, Network } = client;
    await Runtime.enable();
    await Page.enable();
    await Network.enable();

    console.log('[分析] 启动 API 拦截...');

    // 拦截 note/base API
    Network.responseReceived(async (params) => {
      const url = params.response.url;
      if (url.includes('/api/galaxy/creator/datacenter/note/base')) {
        try {
          const { body } = await Network.getResponseBody({ requestId: params.requestId });
          const data = JSON.parse(body);
          
          const noteId = url.match(/note_id=([^&]+)/)?.[1];
          if (noteId && data.data) {
            const d = data.data;
            apiResponses.push({
              noteId,
              noteType: d.note_info?.type,
              hasAvgViewImage: d.avg_view_image !== undefined && d.avg_view_image > 0,
              hasFullViewRate: d.full_view_rate !== undefined && d.full_view_rate > 0,
              hasDanmaku: d.danmaku_count !== undefined && d.danmaku_count > 0,
              fields: {
                avg_view_image: d.avg_view_image,
                full_view_rate: d.full_view_rate,
                finish5s_rate: d.finish5s_rate,
                exit_view2s_rate: d.exit_view2s_rate,
                view_time_avg: d.view_time_avg,
                cover_click_rate: d.cover_click_rate,
                danmaku_count: d.danmaku_count,
                view_count: d.view_count,
                like_count: d.like_count,
                comment_count: d.comment_count,
                collect_count: d.collect_count,
                share_count: d.share_count
              },
              rawData: data  // 保存完整响应用于深入分析
            });
            console.log(`[分析] 捕获作品: ${noteId.substring(0,12)}... type=${d.note_info?.type} avg_img=${d.avg_view_image} full_view=${d.full_view_rate}`);
          }
        } catch (e) {
          console.error(`[分析] 解析API失败: ${e.message}`);
        }
      }
    });

    console.log('[分析] 导航到数据分析页面...');
    await Page.navigate({ url: 'https://creator.xiaohongshu.com/statistics/data-analysis' });
    await new Promise(r => setTimeout(r, 10000));

    // 滚动触发更多 API 调用
    console.log('[分析] 滚动加载更多数据...');
    for (let i = 0; i < 10; i++) {
      await Runtime.evaluate({ expression: 'window.scrollTo(0, document.body.scrollHeight)' });
      await new Promise(r => setTimeout(r, 2000));
    }

    console.log(`\n[分析] 总共捕获 ${apiResponses.length} 个作品的 API 数据`);

    if (apiResponses.length > 0) {
      // 分析字段差异
      const hasAvgImage = apiResponses.filter(r => r.hasAvgViewImage).length;
      const hasFullView = apiResponses.filter(r => r.hasFullViewRate).length;
      const hasDanmaku = apiResponses.filter(r => r.hasDanmaku).length;

      console.log('\n=== 字段统计 ===');
      console.log(`有 avg_view_image > 0: ${hasAvgImage} / ${apiResponses.length}`);
      console.log(`有 full_view_rate > 0: ${hasFullView} / ${apiResponses.length}`);
      console.log(`有 danmaku_count > 0: ${hasDanmaku} / ${apiResponses.length}`);

      // 保存数据
      const filename = '/tmp/xiaohongshu-api-analysis.json';
      fs.writeFileSync(filename, JSON.stringify(apiResponses, null, 2));
      console.log(`\n✅ 数据已保存到 ${filename}`);
      console.log(`\n提示：查看文件分析图文和视频的字段差异`);
    } else {
      console.log('\n⚠️ 未捕获到任何 API 数据');
    }

    await client.close();
  } catch (e) {
    console.error('[分析] 错误:', e.message);
    if (client) await client.close();
    process.exit(1);
  }
}

main();
