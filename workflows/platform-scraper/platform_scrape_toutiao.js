#!/usr/bin/env node
/**
 * 今日头条创作者数据爬取脚本 v4
 * 直接调用 API 获取所有内容（支持分页）
 */

const WebSocket = require("ws");
const http = require("http");
const https = require("https");

const CONTAINER_IP = process.argv[2] || "172.17.0.7";
const CDP_PORT = 9223;
const API_URL = "http://localhost:3333/api/platform-data/batch";

async function getPages() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CONTAINER_IP}:${CDP_PORT}/json`, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function clearOldData() {
  console.log("\n[清理] 删除旧数据...");
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3333,
      path: '/api/platform-data/toutiao',
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json'
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          console.log("✓ 旧数据已清除");
          resolve();
        } else {
          console.log(`⚠ 删除失败 (${res.statusCode}), 继续执行`);
          resolve();
        }
      });
    });

    req.on('error', (err) => {
      console.error('⚠ 删除出错:', err.message);
      resolve();
    });

    req.end();
  });
}

async function scrapeToutiao() {
  console.log("[1/5] Connecting to CDP...");
  const pages = await getPages();
  const ws = new WebSocket(`ws://${CONTAINER_IP}:${CDP_PORT}/devtools/page/${pages[0].id}`);

  let msgId = 0;
  const send = (method, params = {}) => new Promise((resolve) => {
    const id = ++msgId;
    const timeout = setTimeout(() => resolve({ error: "timeout" }), 30000);
    const handler = (data) => {
      const msg = JSON.parse(data);
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.off("message", handler);
        resolve(msg.result);
      }
    };
    ws.on("message", handler);
    ws.send(JSON.stringify({ id, method, params }));
  });

  await new Promise(r => ws.on("open", r));
  console.log("CDP Connected");

  // Check login status
  console.log("\n[2/5] Checking login status...");
  const urlResult = await send("Runtime.evaluate", {
    expression: "window.location.href",
    returnByValue: true
  });

  const currentUrl = urlResult.result.value;
  console.log("Current URL:", currentUrl);

  const isLogin = currentUrl.includes("passport") ||
                  currentUrl.includes("login") ||
                  currentUrl.includes("sso");

  if (isLogin) {
    console.log("\n❌ Session expired! Need to login via VNC.");
    ws.close();
    process.exit(1);
  }

  // Get cookies for API calls
  console.log("\n[3/5] Extracting cookies...");
  const cookiesResult = await send("Runtime.evaluate", {
    expression: "document.cookie",
    returnByValue: true
  });

  const cookies = cookiesResult.result.value;
  console.log("✓ Cookies extracted");

  // Get user ID from page - try multiple methods
  const userIdResult = await send("Runtime.evaluate", {
    expression: `
      (function() {
        // Method 1: Check window.__INIT_VMOK_DEPLOY_GLOBAL_DATA__ or similar
        if (window.__INIT_VMOK_DEPLOY_GLOBAL_DATA__ && window.__INIT_VMOK_DEPLOY_GLOBAL_DATA__.visited_uid) {
          return window.__INIT_VMOK_DEPLOY_GLOBAL_DATA__.visited_uid.toString();
        }

        // Method 2: Parse from page scripts/data
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const match = script.textContent.match(/visited_uid["':\\s]+([\\d]+)/);
          if (match) return match[1];
        }

        // Method 3: Parse from any API calls that were made
        const pageHTML = document.documentElement.innerHTML;
        const match = pageHTML.match(/visited_uid[="':\\s]+([\\d]{10,})/);
        if (match) return match[1];

        // Method 4: Check cookies
        const cookieMatch = document.cookie.match(/uid[=:]([\\d]{10,})/);
        if (cookieMatch) return cookieMatch[1];

        return null;
      })()
    `,
    returnByValue: true
  });

  let userId = userIdResult.result.value;

  // If still no user ID, try extracting from the initial API call in network tab
  if (!userId) {
    const apiCheckResult = await send("Runtime.evaluate", {
      expression: `
        (function() {
          // Try to make a test API call and see what visited_uid the page uses
          return fetch('https://mp.toutiao.com/api/feed/mp_provider/v1/?provider_type=mp_provider&aid=13&app_name=news_article&category=mp_all&count=1&offset=0')
            .then(r => r.url)
            .then(url => {
              const match = url.match(/visited_uid=([\\d]+)/);
              return match ? match[1] : null;
            })
            .catch(() => null);
        })()
      `,
      awaitPromise: true,
      returnByValue: true
    });

    if (apiCheckResult.result && apiCheckResult.result.value) {
      userId = apiCheckResult.result.value;
    }
  }

  // Last resort: hardcode the known user ID from earlier test
  if (!userId) {
    userId = '87914538952';
    console.log(`⚠ Using fallback user ID: ${userId}`);
  } else {
    console.log(`✓ User ID: ${userId}`);
  }

  // Call the API to get content list
  console.log("\n[4/5] Fetching content from API...");

  const allItems = [];
  const pageSize = 20; // Fetch 20 items per request
  let offset = 0;
  let hasMore = true;

  while (hasMore && offset < 200) { // Safety limit of 200 items
    const apiUrl = `https://mp.toutiao.com/api/feed/mp_provider/v1/?provider_type=mp_provider&aid=13&app_name=news_article&category=mp_all&stream_api_version=88&genre_type_switch=%7B%22repost%22%3A1%2C%22small_video%22%3A1%2C%22toutiao_graphic%22%3A1%2C%22weitoutiao%22%3A1%2C%22xigua_video%22%3A1%7D&device_platform=pc&platform_id=0${userId ? `&visited_uid=${userId}` : ''}&offset=${offset}&count=${pageSize}&keyword=&client_extra_params=%7B%22category%22%3A%22mp_all%22%2C%22real_app_id%22%3A%221231%22%2C%22need_forward%22%3A%22true%22%2C%22offset_mode%22%3A%221%22%2C%22status%22%3A%228%22%2C%22source%22%3A%220%22%7D&app_id=1231`;

    const fetchResult = await send("Runtime.evaluate", {
      expression: `
        fetch('${apiUrl}', {
          method: 'GET',
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'User-Agent': navigator.userAgent
          }
        }).then(r => r.json())
      `,
      awaitPromise: true,
      returnByValue: true
    });

    if (!fetchResult.result || !fetchResult.result.value) {
      console.log(`❌ Failed to fetch page at offset ${offset}`);
      break;
    }

    const apiData = fetchResult.result.value;

    if (apiData.error) {
      console.log(`❌ API Error: ${apiData.error}`);
      break;
    }

    if (!apiData.data || apiData.data.length === 0) {
      console.log(`✓ No more items at offset ${offset}`);
      hasMore = false;
      break;
    }

    const items = apiData.data;
    console.log(`  Fetched ${items.length} items (offset ${offset})`);

    // Parse each item
    items.forEach(rawItem => {
      try {
        // The structure is: { assembleCell: { itemCell: { ... } } }
        const itemCell = rawItem.assembleCell?.itemCell || {};
        const articleBase = itemCell.articleBase || {};
        const classification = itemCell.articleClassification || {};
        const counter = itemCell.itemCounter || {};
        const extra = itemCell.extra || {};

        // Parse origin_content for additional metadata
        let articleData = {};
        if (extra.origin_content) {
          try {
            const parsed = JSON.parse(extra.origin_content);
            articleData = parsed.ArticleAttr || {};
          } catch (e) {
            // Ignore JSON parse errors
          }
        }

        // Determine content type
        const genre = classification.groupSource || classification.itemGenre || '';
        const typeDesc = articleData.TypeDesc || '';

        const contentType =
          typeDesc.includes('微头条') || genre === 'weitoutiao' || genre === 2 ? '微头条' :
          typeDesc.includes('视频') || genre === 'video' || genre === 'xigua_video' ? '视频' :
          typeDesc.includes('小视频') || genre === 'small_video' ? '小视频' :
          typeDesc.includes('音频') || genre === 'audio' ? '音频' :
          '文章';

        // Get status from itemStatus: 2=published, 1=审核中, etc
        let status = '已发布';
        const itemStatus = articleBase.itemStatus;
        if (itemStatus === 20 || itemStatus === 2) {
          status = '已发布';
        } else if (itemStatus === 1 || itemStatus === 10) {
          status = '审核中';
        } else if (itemStatus === 3 || itemStatus === 30) {
          status = '未通过';
        } else if (articleData.StatusDesc) {
          status = articleData.StatusDesc;
        }

        // Get publish time (Unix timestamp)
        const createTime = articleBase.createTime || articleBase.publishTime || articleData.CreateTime || 0;
        const publishTime = createTime > 0
          ? new Date(createTime * 1000).toISOString().slice(0, 19).replace('T', ' ')
          : new Date().toISOString().slice(0, 19).replace('T', ' ');

        // Get title
        const title = articleBase.title || articleBase.abstractText || articleData.Title || '无标题';

        // Get metrics from itemCounter
        const views = parseInt(counter.showCount || counter.readCount || 0);
        const likes = parseInt(counter.diggCount || 0);
        const comments = parseInt(counter.commentCount || 0);
        const shares = parseInt(counter.repinCount || counter.shareCount || 0);

        allItems.push({
          platform: 'toutiao',
          content_type: contentType,
          title: title.substring(0, 500).replace(/<br>/g, ' ').replace(/\n/g, ' ').trim(),
          publish_time: publishTime,
          status: status,
          views: views,
          likes: likes,
          comments: comments,
          shares: shares
        });
      } catch (e) {
        console.error(`⚠ Error parsing item:`, e.message);
      }
    });

    offset += items.length;

    // If we got fewer items than requested, we've reached the end
    if (items.length < pageSize) {
      hasMore = false;
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }

  ws.close();

  console.log(`\n✓ Total items fetched: ${allItems.length}`);

  if (allItems.length === 0) {
    console.log("\n⚠ No items to save");
    process.exit(0);
  }

  // Show sample
  console.log("\nSample items:");
  allItems.slice(0, 5).forEach((item, i) => {
    console.log(`${i+1}. [${item.content_type}] ${item.title.substring(0, 60)}...`);
    console.log(`   Time: ${item.publish_time}, Views: ${item.views}, Likes: ${item.likes}`);
  });

  // Clear old data first
  await clearOldData();

  // Save to API
  console.log("\n[5/5] Saving to database...");
  return new Promise((resolve, reject) => {
    const apiData = JSON.stringify({ items: allItems });

    const req = http.request({
      hostname: 'localhost',
      port: 3333,
      path: '/api/platform-data/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(apiData)
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          console.log(`\n✅ Success!`);
          console.log(`   - Inserted: ${result.items.inserted}`);
          console.log(`   - Updated: ${result.items.updated}`);
          console.log(`   - Total: ${result.total}`);
          resolve(result);
        } else {
          console.log(`\n❌ API Error (${res.statusCode}):`);
          console.log(data);
          reject(new Error(data));
        }
      });
    });

    req.on('error', (err) => {
      console.error('\n❌ API Error:', err.message);
      reject(err);
    });

    req.write(apiData);
    req.end();
  });
}

// Main
scrapeToutiao()
  .then(() => {
    console.log("\n🎉 Toutiao scraping completed successfully!");
    process.exit(0);
  })
  .catch(err => {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  });
