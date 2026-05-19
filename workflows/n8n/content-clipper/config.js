/**
 * content-clipper 机器配置
 * 部署时按实际环境修改此文件
 */
module.exports = {
  // 本机服务端口
  PORT: parseInt(process.env.CLIPPER_PORT) || 7788,

  // 日志文件路径
  LOG_FILE: process.env.CLIPPER_LOG_FILE || 'C:/automation/v5-live.log',

  // 临时文件目录
  TEMP_DIR: process.env.CLIPPER_TEMP_DIR || 'C:/automation/temp',

  // Cookie 文件（抖音）
  COOKIES_FILE: process.env.CLIPPER_COOKIES_FILE || 'C:/automation/douyin_cookies.txt',

  // ffmpeg 可执行路径
  FFMPEG_PATH: process.env.CLIPPER_FFMPEG_PATH ||
    'C:/automation/node_modules/@ffmpeg-installer/win32-x64/ffmpeg.exe',

  // Gemini relay 地址
  RELAY_HOST: process.env.CLIPPER_RELAY_HOST || '38.23.47.81',
  RELAY_PORT: parseInt(process.env.CLIPPER_RELAY_PORT) || 7789,

  // CDP：抖音 Chrome
  CDP_HOST: process.env.CLIPPER_CDP_HOST || '127.0.0.1',
  CDP_PORT: parseInt(process.env.CLIPPER_CDP_PORT) || 19222,

  // CDP：小红书 Chrome（IPv6 本地）
  CDP_XHS_HOST: process.env.CLIPPER_CDP_XHS_HOST || '::1',
  CDP_XHS_PORT: parseInt(process.env.CLIPPER_CDP_XHS_PORT) || 19223,
};
