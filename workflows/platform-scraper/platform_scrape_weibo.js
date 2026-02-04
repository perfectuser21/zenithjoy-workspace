#!/usr/bin/env node
/**
 * 微博创作者数据爬取脚本
 * 使用 CDP 协议连接容器内的 Chrome 浏览器
 */

const WebSocket = require("ws");
const http = require("http");

const CONTAINER_IP = process.argv[2] || "172.17.0.8";
const CDP_PORT = 9223; // socat 转发端口
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

async function scrapeWeibo() {
  console.log("[1/6] Connecting to CDP...");
  const pages = await getPages();
  console.log("Current URL:", pages[0].url);

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

  // First check if logged in
  console.log("\n[2/5] Checking login status...");
  await send("Page.navigate", {
    url: "https://weibo.com"
  });
  await new Promise(r => setTimeout(r, 5000));

  const loginCheck = await send("Runtime.evaluate", {
    expression: `
      (function() {
        try {
          const configMatch = document.body.innerHTML.match(/window.\\$CONFIG = ({[^;]+});/);
          if (configMatch) {
            const config = JSON.parse(configMatch[1]);
            return {
              loggedIn: !!config.user,
              userId: config.user ? config.user.id : null,
              username: config.user ? config.user.screen_name : null
            };
          }
          return { loggedIn: false };
        } catch(e) {
          return { loggedIn: false, error: e.message };
        }
      })()
    `,
    returnByValue: true
  });

  console.log("Login status:", JSON.stringify(loginCheck.result.value));

  if (!loginCheck.result.value.loggedIn) {
    console.log("\n❌ Session expired! Need to login via VNC.");
    console.log("Please use VNC at http://146.190.52.84:6084 (password: 123456)");
    ws.close();
    process.exit(1);
  }

  const userId = loginCheck.result.value.userId;
  console.log(`Logged in as: ${loginCheck.result.value.username} (${userId})`);

  // Navigate to user profile to get posts
  console.log("\n[3/5] Navigating to user profile...");
  await send("Page.navigate", {
    url: `https://weibo.com/u/${userId}`
  });

  await new Promise(r => setTimeout(r, 8000));

  // Scroll to load data
  console.log("\n[4/5] Scrolling to load data...");
  for (let i = 0; i < 10; i++) {
    await send("Runtime.evaluate", {
      expression: "window.scrollTo(0, document.body.scrollHeight); true"
    });
    await new Promise(r => setTimeout(r, 2000));
    if ((i + 1) % 3 === 0) {
      console.log(`Scrolled ${i+1}/10...`);
    }
  }

  // Extract data
  console.log("\n[5/5] Extracting data from profile...");
  const dataResult = await send("Runtime.evaluate", {
    expression: `
      (function() {
        const items = [];

        try {
          // Try to extract from React state or page data
          const htmlContent = document.body.innerHTML;

          // Look for post data in script tags
          const scriptTags = document.querySelectorAll('script');
          let postsData = null;

          for (let script of scriptTags) {
            const text = script.textContent;
            if (text.includes('mblog') || text.includes('statuses')) {
              // Try to find JSON data
              try {
                const jsonMatch = text.match(/\\$render_data = \\[({[^<]+})\\]/);
                if (jsonMatch) {
                  const data = JSON.parse(jsonMatch[1]);
                  if (data.status && data.status.statuses) {
                    postsData = data.status.statuses;
                    break;
                  }
                }
              } catch(e) {}
            }
          }

          // If found posts data, extract it
          if (postsData && postsData.length > 0) {
            postsData.forEach(post => {
              try {
                const item = {
                  platform: 'weibo',
                  content_type: post.pic_num > 0 ? '图文' : (post.page_info && post.page_info.type === 'video' ? '视频' : '文字'),
                  title: (post.text_raw || post.text || '').substring(0, 200),
                  publish_time: post.created_at || '',
                  status: '通过',
                  views: post.reads_count || post.read_count || 0,
                  likes: post.attitudes_count || 0,
                  comments: post.comments_count || 0,
                  shares: post.reposts_count || 0
                };

                if (item.title.length > 10) {
                  items.push(item);
                }
              } catch(e) {}
            });
          }

          // Fallback: manual parsing from DOM
          if (items.length === 0) {
            console.log("No structured data found, trying DOM parsing...");

            // For Weibo, we need to note that the data might not be accessible via CDP
            // because it's a complex SPA. Return a message indicating manual access needed.
          }

        } catch(e) {
          console.error("Extraction error:", e.message);
        }

        return {
          items: items,
          count: items.length,
          note: items.length === 0 ? "Unable to extract data from SPA. May need VNC access or API interception." : ""
        };
      })()
    `,
    returnByValue: true
  });

  ws.close();

  if (!dataResult.result || !dataResult.result.value) {
    console.log("\n❌ Failed to extract data");
    process.exit(1);
  }

  const extractedData = dataResult.result.value;
  console.log(`✓ Extracted ${extractedData.count} items`);

  // Filter and fix items
  const validItems = extractedData.items
    .filter(item => item.views > 0 && item.title.length > 10)
    .map(item => {
      // Fix empty publish_time
      if (!item.publish_time) {
        item.publish_time = new Date().toISOString().slice(0, 19).replace('T', ' ');
      }
      return item;
    });

  console.log(`✓ Filtered to ${validItems.length} valid items`);

  if (validItems.length === 0) {
    console.log("\n⚠ No valid items to save");
    console.log(extractedData.note || "");
    console.log("\nℹ Weibo uses a complex SPA architecture. You may need to:");
    console.log("  1. Use VNC to manually navigate: http://146.190.52.84:6084 (password: 123456)");
    console.log("  2. Check if the creator center URL has changed");
    console.log("  3. Use network interception to find the actual API endpoints");
    process.exit(0);
  }

  // Save to API
  console.log("\n[6/6] Saving to database...");
  return new Promise((resolve, reject) => {
    const apiData = JSON.stringify({ items: validItems });

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
scrapeWeibo()
  .then(() => {
    console.log("\n🎉 Weibo scraping completed successfully!");
    process.exit(0);
  })
  .catch(err => {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
  });
