#!/usr/bin/env node
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
              noteDesc: d.note_info?.desc,
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
            });
            console.log(`[分析] ✅ ${noteId.substring(0,10)}... | type=${d.note_info?.type} | avg_img=${d.avg_view_image} | full_view=${d.full_view_rate}`);
          }
        } catch (e) {}
      }
    });

    console.log('[分析] 导航到作品管理页面...');
    await Page.navigate({ url: 'https://creator.xiaohongshu.com/creator/post-management' });
    await new Promise(r => setTimeout(r, 8000));

    // 获取作品列表中的"详情数据"链接并点击
    console.log('[分析] 查找作品详情链接...');
    const { result } = await Runtime.evaluate({
      expression: `
        (function() {
          const links = Array.from(document.querySelectorAll('a'));
          const detailLinks = links.filter(a => a.innerText.includes('详情数据') || a.href.includes('note_id='));
          return detailLinks.slice(0, 15).map(a => a.href);  // 取前15个
        })()
      `
    });

    const links = result.value || [];
    console.log(`[分析] 找到 ${links.length} 个详情链接`);

    if (links.length === 0) {
      console.log('[分析] 未找到详情链接，尝试直接从页面提取 note_id...');
      
      // 方案B：从页面提取 note_id
      const { result: noteIds } = await Runtime.evaluate({
        expression: `
          (function() {
            const allLinks = Array.from(document.querySelectorAll('a[href*="note_id"]'));
            const ids = allLinks.map(a => {
              const match = a.href.match(/note_id=([a-f0-9]+)/i);
              return match ? match[1] : null;
            }).filter(Boolean);
            return [...new Set(ids)].slice(0, 15);  // 去重，取前15个
          })()
        `
      });

      const ids = noteIds.value || [];
      console.log(`[分析] 提取到 ${ids.length} 个 note_id`);

      // 手动构造API URL并访问
      for (const id of ids) {
        const apiUrl = `https://creator.xiaohongshu.com/api/galaxy/creator/datacenter/note/base?note_id=${id}&data_level=third_level&data_type=day`;
        console.log(`[分析] 访问 ${id.substring(0,10)}...`);
        await Page.navigate({ url: apiUrl });
        await new Promise(r => setTimeout(r, 1500));
      }
    } else {
      // 方案A：点击详情链接
      for (let i = 0; i < Math.min(links.length, 15); i++) {
        console.log(`[分析] 访问第 ${i+1}/${links.length} 个作品...`);
        await Page.navigate({ url: links[i] });
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    console.log(`\n[分析] 总共捕获 ${apiResponses.length} 个作品的 API 数据`);

    if (apiResponses.length > 0) {
      // 分析字段差异
      const withAvgImage = apiResponses.filter(r => r.avg_view_image > 0);
      const withFullView = apiResponses.filter(r => r.full_view_rate > 0);
      const withDanmaku = apiResponses.filter(r => r.danmaku_count > 0);

      console.log('\n=== 字段统计 ===');
      console.log(`avg_view_image > 0: ${withAvgImage.length} / ${apiResponses.length}`);
      console.log(`full_view_rate > 0: ${withFullView.length} / ${apiResponses.length}`);
      console.log(`danmaku_count > 0: ${withDanmaku.length} / ${apiResponses.length}`);

      console.log('\n=== 样本数据 ===');
      if (withAvgImage.length > 0) {
        console.log('\n有 avg_view_image 的作品（可能是图文）：');
        withAvgImage.slice(0, 3).forEach(r => {
          console.log(`  - ${r.noteDesc?.substring(0,30)}... | avg_img=${r.avg_view_image} | full_view=${r.full_view_rate}`);
        });
      }
      if (withFullView.length > 0) {
        console.log('\n有 full_view_rate 的作品（可能是视频）：');
        withFullView.slice(0, 3).forEach(r => {
          console.log(`  - ${r.noteDesc?.substring(0,30)}... | full_view=${r.full_view_rate} | avg_img=${r.avg_view_image}`);
        });
      }

      // 保存数据
      const filename = '/tmp/xiaohongshu-fields-analysis.json';
      fs.writeFileSync(filename, JSON.stringify(apiResponses, null, 2));
      console.log(`\n✅ 完整数据已保存到 ${filename}`);
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
