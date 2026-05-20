'use strict';
/**
 * 快手发布器工具函数
 *
 * 纯函数层，与 CDP 无关，可完全单元测试。
 * 架构与 weibo-publisher/utils.cjs、xiaohongshu-publisher/utils.cjs 保持一致。
 */

const fs = require('fs');
const path = require('path');

/**
 * 候选发布 URL（按优先级排序）。
 * 快手 API 改版后 photo-video 页面可能重定向；
 * 脚本会依次尝试直到找到可用 URL。
 */
const PUBLISH_URLS = [
  'https://cp.kuaishou.com/article/publish/photo-video',
  'https://cp.kuaishou.com/article/publish/photo',
];

/**
 * 收集目录中的图片文件（排序后）。
 * @param {string} dir - 内容目录路径
 * @returns {string[]} 图片绝对路径数组
 */
function findImages(dir) {
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const files = fs.readdirSync(dir);
  return files
    .filter(f => imageExts.some(ext => f.toLowerCase().endsWith(ext)))
    .sort()
    .map(f => path.join(dir, f));
}

/**
 * 读取内容目录中的 content.txt 文案。
 * 文件不存在时返回空字符串。
 * @param {string} dir - 内容目录路径
 * @returns {string}
 */
function readContent(dir) {
  const file = path.join(dir, 'content.txt');
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8').trim();
}

/**
 * 将本地图片路径数组转换为 Windows PC 上的绝对路径。
 * @param {string[]} localImages - 本地图片路径数组
 * @param {string} windowsBaseDir - Windows 基础目录（如 C:\Users\xuxia\kuaishou-media）
 * @param {string} dateDir - 日期目录名（如 2026-03-08）
 * @param {string} contentDirName - 内容目录名（如 image-1）
 * @returns {string[]} Windows 路径数组
 */
function convertToWindowsPaths(localImages, windowsBaseDir, dateDir, contentDirName) {
  return localImages.map(img => {
    const filename = path.basename(img);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 转义字符串中的特殊字符，使其可安全注入到 CDP Runtime.evaluate JS 表达式。
 * @param {string} text - 原始文本
 * @returns {string} 转义后的文本
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
 * 从内容目录路径提取日期目录名和内容目录名。
 * 路径约定：~/.kuaishou-queue/{dateDir}/{contentDirName}
 * @param {string} contentDir - 内容目录绝对路径
 * @returns {{ dateDir: string, contentDirName: string }}
 */
function extractDirNames(contentDir) {
  const contentDirName = path.basename(contentDir);
  const dateDir = path.basename(path.dirname(contentDir));
  return { dateDir, contentDirName };
}

/**
 * 检测 URL 是否为快手 OAuth 登录重定向。
 * 会话过期时，cp.kuaishou.com 会重定向到 passport.kuaishou.com/pc/account/login/。
 * @param {string} url - 当前页面 URL
 * @returns {boolean}
 */
function isLoginRedirect(url) {
  if (!url || typeof url !== 'string') return false;
  return (
    url.includes('passport.kuaishou.com') ||
    url.includes('/account/login') ||
    url === 'https://cp.kuaishou.com/profile' ||
    (url.startsWith('https://cp.kuaishou.com/profile') && !url.includes('/article'))
  );
}

/**
 * 检测导航后的 URL 是否落在目标发布页面（而非被重定向）。
 * @param {string} url - 导航后实际 URL
 * @param {string} targetUrl - 期望的目标 URL
 * @returns {boolean}
 */
function isPublishPageReached(url, targetUrl) {
  if (!url || !targetUrl) return false;
  const targetPath = new URL(targetUrl).pathname;
  return url.includes('cp.kuaishou.com') && url.includes(targetPath);
}

/**
 * 将会话检查结果格式化为标准化输出对象。
 * 退出码语义：0=OK, 1=错误/超时, 2=过期。
 *
 * @param {'ok' | 'expired' | 'cdp_error' | 'timeout'} status - 会话状态
 * @param {string} [url] - 当前页面 URL（可选，附加上下文）
 * @returns {{ tag: string, message: string, exitCode: number }}
 */
function formatSessionStatus(status, url) {
  const urlInfo = url ? ` (${url})` : '';
  switch (status) {
    case 'ok':
      return {
        tag: '[SESSION_OK]',
        message: `快手会话有效${urlInfo}`,
        exitCode: 0,
      };
    case 'expired':
      return {
        tag: '[SESSION_EXPIRED]',
        message: `快手 OAuth 会话已过期，请重新登录创作者中心${urlInfo}`,
        exitCode: 2,
      };
    case 'cdp_error':
      return {
        tag: '[CDP_ERROR]',
        message: `无法连接 CDP（Windows PC 可能未开机或浏览器未启动）${urlInfo}`,
        exitCode: 1,
      };
    case 'timeout':
      return {
        tag: '[TIMEOUT]',
        message: `页面加载超时${urlInfo}`,
        exitCode: 1,
      };
    default:
      return {
        tag: '[UNKNOWN]',
        message: `未知状态: ${status}`,
        exitCode: 1,
      };
  }
}

/**
 * 从发布成功后的页面 URL 或正文中提取发布 ID。
 *
 * 快手发布成功后 URL 模式（已知）：
 *   - https://cp.kuaishou.com/article/manage/photo-video?photoId=1234567890
 *   - https://cp.kuaishou.com/photo/detail/1234567890
 *
 * 页面正文中可能出现的 ID 模式：
 *   - "photoId":"1234567890"  /  "photo_id":"1234567890"
 *   - "作品ID：1234567890"
 *
 * @param {string} url - 发布成功后的页面 URL
 * @param {string} [bodyText] - 页面正文（可选，用于从 DOM 中提取 ID）
 * @returns {string|null} 发布 ID，无法提取时返回 null
 */
function extractPublishId(url, bodyText) {
  if (url && typeof url === 'string') {
    // 1. 从 URL query 参数提取（photoId、id、photo_id）
    try {
      const parsed = new URL(url);
      for (const param of ['photoId', 'id', 'photo_id']) {
        const val = parsed.searchParams.get(param);
        if (val && /^\d+$/.test(val)) return val;
      }
      // 2. 从 URL 路径片段提取（如 /photo/detail/1234567890）
      const pathMatch = parsed.pathname.match(/\/(\d{8,20})(?:\/|$)/);
      if (pathMatch) return pathMatch[1];
    } catch (_) {
      // URL 解析失败，继续尝试正文
    }
  }

  if (bodyText && typeof bodyText === 'string') {
    // 3. 从 JSON 字段提取（JSON 格式的 photoId / photo_id）
    const jsonMatch = bodyText.match(/"(?:photoId|photo_id|id)"\s*:\s*"(\d{8,20})"/);
    if (jsonMatch) return jsonMatch[1];
    // 4. 从中文提示文本提取（"作品ID：数字" 或 "视频ID：数字"）
    const cnMatch = bodyText.match(/(?:作品|视频|图文)\s*ID[：:]\s*(\d{8,20})/);
    if (cnMatch) return cnMatch[1];
  }

  return null;
}

// ============================================================
// 话题标签截断（快手限制 ≤4 个）
// ============================================================

const MAX_HASHTAGS = 4;
const DEFAULT_MUSIC_QUERY = '热歌';

/**
 * 截断文案中超出限制的话题标签（最多 MAX_HASHTAGS 个）
 */
function truncateHashtags(text) {
  const tags = (text.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g) || []);
  if (tags.length <= MAX_HASHTAGS) return text;
  let remaining = MAX_HASHTAGS;
  return text.replace(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g, tag => {
    if (remaining > 0) { remaining--; return tag; }
    return '';
  }).trim();
}

/**
 * 读取内容目录中的音乐搜索词（music.txt），无则用默认值
 */
function readMusicQuery(contentDir) {
  const musicFile = path.join(contentDir, 'music.txt');
  if (fs.existsSync(musicFile)) {
    const q = fs.readFileSync(musicFile, 'utf8').trim();
    return q || DEFAULT_MUSIC_QUERY;
  }
  return DEFAULT_MUSIC_QUERY;
}

module.exports = {
  PUBLISH_URLS,
  MAX_HASHTAGS,
  DEFAULT_MUSIC_QUERY,
  findImages,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
  isLoginRedirect,
  isPublishPageReached,
  formatSessionStatus,
  extractPublishId,
  truncateHashtags,
  readMusicQuery,
};
