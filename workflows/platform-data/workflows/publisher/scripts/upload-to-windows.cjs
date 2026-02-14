#!/usr/bin/env node
/**
 * 上传文件到 Windows file receiver
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const WINDOWS_IP = '100.97.242.124';  // Tailscale IP
const UPLOAD_PORT = 3001;

async function uploadFile(filePath, targetDir) {
  const form = new FormData();
  const fileName = path.basename(filePath);
  
  form.append('file', fs.createReadStream(filePath), {
    filename: fileName,
    contentType: 'application/octet-stream'
  });
  
  form.append('targetDir', targetDir);

  return new Promise((resolve, reject) => {
    const req = http.request({
      host: WINDOWS_IP,
      port: UPLOAD_PORT,
      path: '/upload',
      method: 'POST',
      headers: form.getHeaders()
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: data });
        }
      });
    });

    req.on('error', reject);
    form.pipe(req);
  });
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('用法: upload-to-windows.cjs <file1> [file2] ...');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('上传文件到 Windows');
  console.log('========================================\n');
  console.log(`目标: ${WINDOWS_IP}:${UPLOAD_PORT}\n`);

  for (const filePath of args) {
    if (!fs.existsSync(filePath)) {
      console.log(`❌ 文件不存在: ${filePath}\n`);
      continue;
    }

    const fileName = path.basename(filePath);
    const fileSize = fs.statSync(filePath).size;

    console.log(`📤 ${fileName} (${(fileSize / 1024).toFixed(1)} KB)`);

    try {
      const result = await uploadFile(filePath, 'toutiao-media');
      if (result.success) {
        console.log(`   ✓ 上传成功\n`);
      } else {
        console.log(`   ❌ 失败: ${result.error}\n`);
      }
    } catch (err) {
      console.log(`   ❌ 错误: ${err.message}\n`);
    }
  }
}

main().catch(console.error);
