const WebSocket = require("ws");
const http = require("http");
const https = require("https");

const CONTAINER_IP = process.argv[2] || "172.17.0.6";
const API_URL = "http://localhost:3333/api/platform-data/batch";

async function getPages() {
  return new Promise((resolve, reject) => {
    http.get(`http://${CONTAINER_IP}:9223/json`, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    }).on("error", reject);
  });
}

async function saveToAPI(items) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ items });

    const options = {
      hostname: 'localhost',
      port: 3333,
      path: '/api/platform-data/batch',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, res => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch(e) {
          reject(new Error("Failed to parse API response"));
        }
      });
    });

    req.on("error", reject);
    req.write(postData);
    req.end();
  });
}

async function scrapeXiaohongshu() {
  const pages = await getPages();
  console.error("Current URL:", pages[0].url);

  const ws = new WebSocket(`ws://${CONTAINER_IP}:9223/devtools/page/${pages[0].id}`);

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
  console.error("Connected to CDP");

  // Check login status
  const urlResult = await send("Runtime.evaluate", {
    expression: "window.location.href",
    returnByValue: true
  });

  const isLogin = urlResult.result.value.includes("login") || urlResult.result.value.includes("passport");
  if (isLogin) {
    console.log(JSON.stringify({ error: "Session expired", needLogin: true }));
    ws.close();
    return;
  }

  // Navigate to content analysis
  console.error("Navigating to content analysis...");
  await send("Runtime.evaluate", {
    expression: `
      const links = Array.from(document.querySelectorAll('a, div, span'));
      const contentLink = links.find(el => el.textContent.trim() === '内容分析');
      if (contentLink) contentLink.click();
    `
  });

  await new Promise(r => setTimeout(r, 5000));

  // Scroll to load more data
  console.error("Scrolling to load data...");
  for (let i = 0; i < 10; i++) {
    await send("Runtime.evaluate", {
      expression: "window.scrollTo(0, document.body.scrollHeight); true"
    });
    await new Promise(r => setTimeout(r, 2000));
    console.error("Scroll", i + 1);
  }

  // Extract data from table
  console.error("Extracting data...");
  const dataResult = await send("Runtime.evaluate", {
    expression: `
      (function() {
        const items = [];
        const rows = document.querySelectorAll('tbody tr');

        rows.forEach(row => {
          try {
            const cells = row.querySelectorAll('td');
            if (cells.length < 5) return;

            // First cell contains title and publish time
            const titleCell = cells[0];
            const titleEl = titleCell.querySelector('.note-title, [class*="title"]');
            const timeEl = titleCell.querySelector('.time, [class*="time"]');

            if (!titleEl) return;

            const title = titleEl.innerText.trim();
            const timeText = timeEl ? timeEl.innerText.trim() : '';

            // Extract publish time (format: "发布于2025-12-22 09:13")
            const timeMatch = timeText.match(/(\\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2})/);
            const publishTime = timeMatch ? timeMatch[1] + ':00' : '';

            // Check if it's a video
            const isVideo = row.innerHTML.includes('video') || row.innerHTML.includes('视频');

            // Get metrics from cells
            const getCellValue = (index) => {
              if (cells[index]) {
                const text = cells[index].innerText.trim();
                const num = parseInt(text.replace(/,/g, ''));
                return isNaN(num) ? 0 : num;
              }
              return 0;
            };

            const item = {
              platform: 'xiaohongshu',
              content_type: isVideo ? '视频' : '图文',
              title: title,
              publish_time: publishTime || new Date().toISOString().slice(0, 19).replace('T', ' '),
              status: '通过',
              views: getCellValue(1),  // 曝光数
              likes: getCellValue(4),   // 点赞数
              comments: getCellValue(5), // 评论数
              favorites: getCellValue(6) // 收藏数
            };

            items.push(item);
          } catch(e) {
            console.error('Parse error:', e.message);
          }
        });

        return items;
      })()
    `,
    returnByValue: true
  });

  const items = dataResult.result.value || [];
  console.error("Extracted items:", items.length);

  ws.close();

  if (items.length === 0) {
    console.log(JSON.stringify({ error: "No data extracted", itemsFound: 0 }));
    return;
  }

  // Save to API
  console.error("Saving to database...");
  try {
    const apiResult = await saveToAPI(items);
    console.error("API response:", JSON.stringify(apiResult));

    console.log(JSON.stringify({
      success: true,
      scraped: items.length,
      saved: apiResult
    }));
  } catch(err) {
    console.error("API error:", err.message);
    console.log(JSON.stringify({
      success: false,
      error: "Failed to save data",
      scraped: items.length,
      items: items
    }));
  }
}

scrapeXiaohongshu().catch(err => {
  console.error("Script error:", err.message);
  console.log(JSON.stringify({ error: err.message }));
  process.exit(1);
});
