'use strict';
/**
 * 小红书发布器 - 工具函数
 *
 * 纯函数，可单元测试，供 publish-xhs-image.cjs 和 batch 脚本使用
 */

const path = require('path');
const fs = require('fs');

/**
 * 扫描目录中所有图片文件，按文件名排序返回绝对路径数组
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
 * 读取 title.txt 标题文本
 */
function readTitle(contentDir, fsModule) {
  const fsImpl = fsModule || fs;
  const titleFile = path.join(contentDir, 'title.txt');
  if (!fsImpl.existsSync(titleFile)) {
    return '';
  }
  return fsImpl.readFileSync(titleFile, 'utf8').trim();
}

/**
 * 读取 content.txt 正文文本
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
 */
function convertToWindowsPaths(localImages, windowsBaseDir, dateDir, contentDirName) {
  return localImages.map(img => {
    const filename = path.basename(img);
    return path.join(windowsBaseDir, dateDir, contentDirName, filename).replace(/\//g, '\\');
  });
}

/**
 * 转义字符串用于 JavaScript 字符串注入（CDP Runtime.evaluate）
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
 */
function extractDirNames(contentDir) {
  const contentDirName = path.basename(contentDir);
  const dateDir = path.basename(path.dirname(contentDir));
  return { dateDir, contentDirName };
}

module.exports = {
  findImages,
  readTitle,
  readContent,
  convertToWindowsPaths,
  escapeForJS,
  extractDirNames,
};
