#!/usr/bin/env node
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = 19225;
const WINDOWS_IP = '100.97.242.124';

async function publishVideo(configPath) {
  console.log(`📹 开始发布视频`);
  
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const dateStr = '2026-02-09';
  const windowsVideoPath = `C:\\Users\\Administrator\\Desktop\\toutiao-media\\${dateStr}\\videos\\test-video.mp4`;
  const windowsCoverPath = `C:\\Users\\Administrator\\Desktop\\toutiao-media\\${dateStr}\\images\\test-image-1.jpg`;
  
  console.log(`视频: ${windowsVideoPath}`);
  console.log(`封面: ${windowsCoverPath}`);
  
  const pagesData = await new Promise((resolve, reject) => {
    http.get(`http://${WINDOWS_IP}:${CDP_PORT}/json`, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  const page = pagesData.find(p => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(resolve => ws.on('open', resolve));

  let msgId = 0;
  const send = (method, params = {}) => {
    return new Promise(resolve => {
      const id = ++msgId;
      const handler = (data) => {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.off('message', handler);
          resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  try {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('DOM.enable');
    await send('Input.enable');

    // 导航
    console.log('\n步骤 1: 导航到视频发布页面...');
    await send('Page.navigate', {
      url: 'https://mp.toutiao.com/profile_v4/xigua/upload-video'
    });
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 步骤 2: 上传视频
    console.log('步骤 2: 上传视频文件...');
    const videoInputNode = await send('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"][accept*="video"]\');',
      returnByValue: false
    });

    if (!videoInputNode.result.objectId) {
      throw new Error('未找到视频上传 input');
    }

    await send('DOM.setFileInputFiles', {
      objectId: videoInputNode.result.objectId,
      files: [windowsVideoPath]
    });

    // 触发 change
    await send('Runtime.evaluate', {
      expression: `
        const input = document.querySelector('input[type="file"][accept*="video"]');
        input.dispatchEvent(new Event('change', { bubbles: true }));
      `
    });

    console.log('⏳ 等待视频上传（20 秒）...');
    await new Promise(resolve => setTimeout(resolve, 20000));

    // 步骤 3: 填写标题
    console.log('步骤 3: 填写标题...');
    const titleResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const inputs = document.querySelectorAll('input[type="text"]');
          for (let input of inputs) {
            if (!input.value || input.placeholder.includes('标题')) {
              input.focus();
              input.value = '${config.title}';
              input.dispatchEvent(new Event('input', { bubbles: true }));
              return '标题已填写: ' + input.value;
            }
          }
          return '未找到标题输入框';
        })()
      `,
      returnByValue: true
    });
    console.log(titleResult.result.value);

    // 步骤 4: 上传封面
    console.log('步骤 4: 查找并点击上传封面...');
    
    // 先查找"上传封面"相关的文件input或按钮
    const coverUploadResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          // 查找所有包含"封面"或"上传"的元素
          const elements = Array.from(document.querySelectorAll('*'));
          const coverElements = elements.filter(el => 
            el.textContent && (
              el.textContent.includes('上传封面') ||
              el.textContent.includes('本地上传') ||
              el.textContent.includes('选择封面')
            )
          );
          
          if (coverElements.length > 0) {
            // 尝试点击第一个
            coverElements[0].click();
            return '已点击: ' + coverElements[0].textContent.trim().substring(0, 20);
          }
          
          // 或者直接查找封面上传的 file input
          const coverInput = document.querySelector('input[type="file"][accept*="image"]');
          if (coverInput) {
            return '找到封面 input';
          }
          
          return '未找到封面上传入口';
        })()
      `,
      returnByValue: true
    });
    console.log(coverUploadResult.result.value);

    await new Promise(resolve => setTimeout(resolve, 2000));

    // 上传封面图片
    console.log('步骤 5: 上传封面图片...');
    const coverInputNode = await send('Runtime.evaluate', {
      expression: 'document.querySelector(\'input[type="file"][accept*="image"]\');',
      returnByValue: false
    });

    if (coverInputNode.result.objectId) {
      await send('DOM.setFileInputFiles', {
        objectId: coverInputNode.result.objectId,
        files: [windowsCoverPath]
      });

      await send('Runtime.evaluate', {
        expression: `
          const input = document.querySelector('input[type="file"][accept*="image"]');
          input.dispatchEvent(new Event('change', { bubbles: true }));
        `
      });

      console.log('⏳ 等待封面上传（5 秒）...');
      await new Promise(resolve => setTimeout(resolve, 5000));

      // 点击"完成裁剪"和"确定"
      console.log('步骤 6: 完成裁剪...');
      await send('Runtime.evaluate', {
        expression: `
          (function() {
            const buttons = Array.from(document.querySelectorAll('button'));
            const cropBtn = buttons.find(b => b.textContent.includes('完成裁剪') || b.textContent.includes('确定'));
            if (cropBtn) {
              cropBtn.click();
              setTimeout(() => {
                const confirmBtn = buttons.find(b => b.textContent.includes('确定'));
                if (confirmBtn) confirmBtn.click();
              }, 1000);
              return '已完成裁剪';
            }
            return '未找到裁剪按钮';
          })()
        `
      });

      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('⚠️  未找到封面 input，可能需要先点击上传按钮');
    }

    // 步骤 7: 填写视频简介
    console.log('步骤 7: 填写视频简介...');
    const descResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const textareas = document.querySelectorAll('textarea');
          for (let textarea of textareas) {
            if (textarea.placeholder.includes('简介') || textarea.placeholder.includes('文案')) {
              textarea.focus();
              textarea.value = '${config.description}';
              textarea.dispatchEvent(new Event('input', { bubbles: true }));
              return '简介已填写';
            }
          }
          return '未找到简介输入框';
        })()
      `,
      returnByValue: true
    });
    console.log(descResult.result.value);

    // 步骤 8: 点击发布
    console.log('步骤 8: 查找发布按钮...');
    const publishResult = await send('Runtime.evaluate', {
      expression: `
        (function() {
          const buttons = Array.from(document.querySelectorAll('button'));
          console.log('找到按钮:', buttons.map(b => b.textContent.trim()));
          
          const publishBtn = buttons.find(b => 
            b.textContent.includes('发布') && 
            !b.textContent.includes('预览') &&
            !b.disabled
          );
          
          if (publishBtn) {
            publishBtn.click();
            return '已点击发布: ' + publishBtn.textContent;
          }
          return '未找到发布按钮';
        })()
      `,
      returnByValue: true
    });
    console.log(publishResult.result.value);

    await new Promise(resolve => setTimeout(resolve, 5000));

    const finalUrl = await send('Runtime.evaluate', {
      expression: 'window.location.href',
      returnByValue: true
    });

    console.log('\n✅ 视频发布完成！');
    console.log('最终页面:', finalUrl.result.value);

    ws.close();
    return { success: true, url: finalUrl.result.value };

  } catch (error) {
    console.error('❌ 失败:', error.message);
    ws.close();
    throw error;
  }
}

const configPath = process.argv[2];
if (!configPath) {
  console.error('用法: node publish-video.cjs <config.json>');
  process.exit(1);
}

publishVideo(configPath)
  .then(result => {
    console.log('\n🎉 成功!', result);
    process.exit(0);
  })
  .catch(error => {
    console.error('\n❌ 失败:', error);
    process.exit(1);
  });
