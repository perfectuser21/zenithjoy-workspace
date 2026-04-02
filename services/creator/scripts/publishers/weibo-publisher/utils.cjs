#!/usr/bin/env node
/**
 * 微博发布器 - 工具函数
 *
 * 纯函数，可单元测试，供 publish-weibo-image.cjs 和 batch 脚本使用
 */

'use strict';

const path = require('path');
const fs = require('fs');

/**
 * 扫描目录中所有图片文件，按文件名排序返回绝对路径数组
 *
 * @param {string} dir - 目录路径
 * @param {object} [fsModule] - fs 模块（可注入用于测试）
 * @returns {string[]} 图片文件绝对路径数组
 */
function findImages(dir, fsModule) {
  const fsImpl = fsModule || fs;
  const files = fsImpl.readdirSync(dir);
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  return files
    .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * 读取内容目录中的文案文本
 *
 * @param {string} contentDir - 内容目录路径
 * @param {object} [fsModule] - fs 模块（可注入用于测试）
 * @returns {string} 文案内容（修剪空白），文件不存在时返回空字符串
 */
function readContent(contentDir, fsModule) {
  const fsImpl = fsModule || fs;
  const contentFile = path.join(contentDir, 'content.txt');
  if (!fsImpl.existsSync(contentFile)) {
    return '';
  }
  return fsImpl.readFileSync(contentFile, 'utf8').trim();
}

/**
 * 将本地图片路径数组转换为 Windows 绝对路径数组
 *
 * 目录结构：{windowsBaseDir}/{dateDir}/{contentDirName}/{filename}
 *
 * @param {string[]} localImages - 本地图片路径数组
 * @param {string} windowsBaseDir - Windows 基础目录（如 C:\Users\xuxia\weibo-media）
 * @param {string} dateDir - 日期目录名（如 2026-03-07）
 * @param {string} contentDirName - 内容目录名（如 image-1）
 * @returns {string[]} Windows 路径数组（反斜杠分隔）
 */
function convertToWindowsPaths(localImages, windowsBaseDir, dateDir, contentDirName) {
  return localImages.map(img => {
    const filename = path.basename(img);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 转义字符串用于 JavaScript 字符串注入（CDP Runtime.evaluate）
 *
 * @param {string} text - 原始文本
 * @returns {string} 安全转义后的字符串
 */
function escapeForJS(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * 从内容目录路径提取日期目录名和内容目录名
 *
 * 期望结构：.../{dateDir}/{contentDirName}/
 *
 * @param {string} contentDir - 内容目录绝对路径
 * @returns {{ dateDir: string, contentDirName: string }}
 */
function extractDirNames(contentDir) {
  const contentDirName = path.basename(contentDir);
  const dateDir = path.basename(path.dirname(contentDir));
  return { dateDir, contentDirName };
}

/**
 * 微博发布页 URL（首页 + 点击"写微博"按钮）
 * 旧 URL weibo.com/p/publish/ 已失效（404），改用首页 compose 流程
 */
const PUBLISH_URL = 'https://weibo.com/';

/**
 * 限频重试默认参数
 */
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 2000;

/**
 * 指数退避重试包装器
 *
 * @param {function} fn - 返回 Promise 的异步函数
 * @param {number} [maxAttempts=3] - 最大尝试次数
 * @param {number} [baseDelayMs=2000] - 基础延迟毫秒（每次翻倍：2s、4s、8s）
 * @param {function} [isRetryable] - 判断错误是否可重试，默认全部重试
 * @returns {Promise<any>}
 */
async function withRetry(fn, maxAttempts, baseDelayMs, isRetryable) {
  const attempts = typeof maxAttempts === 'number' ? maxAttempts : MAX_RETRY_ATTEMPTS;
  const delay = typeof baseDelayMs === 'number' ? baseDelayMs : RETRY_BASE_DELAY_MS;
  const retryCheck = typeof isRetryable === 'function' ? isRetryable : () => true;

  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts && retryCheck(err)) {
        const waitMs = delay * Math.pow(2, i - 1);
        await new Promise(r => setTimeout(r, waitMs));
      } else {
        break;
      }
    }
  }
  throw lastError;
}

/**
 * 检测 URL 是否为微博登录跳转页（会话失效时触发）。
 *
 * 微博会话过期后，导航到 weibo.com/p/publish/ 会被重定向到登录页。
 *
 * @param {string} url - 当前页面 URL
 * @returns {boolean}
 */
function isLoginRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('passport.weibo.com') ||
    url.includes('login.weibo.com') ||
    url.includes('weibo.com/login') ||
    url.includes('/signin') ||
    url.includes('weibo.com/signup/signup')
  );
}

/**
 * 检测导航后是否真正到达微博发布页（而非被重定向）。
 *
 * @param {string} url - 导航后实际 URL
 * @returns {boolean}
 */
function isPublishPageReached(url) {
  if (!url || typeof url !== 'string') return false;
  // 旧 URL weibo.com/p/publish/ 已失效，现在在首页通过"写微博"按钮发布
  return url.includes('weibo.com') && !url.includes('sorry') && !url.includes('login') && !url.includes('passport');
}

module.exports = {
  PUBLISH_URL,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY_MS,
  withRetry,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
};
