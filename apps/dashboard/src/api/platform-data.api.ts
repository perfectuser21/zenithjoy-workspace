/**
 * Platform Data API - 获取各平台采集的原始数据
 *
 * 连接 TimescaleDB PostgreSQL 数据库，读取 raw_data views
 */

// ============ 类型定义 ============

export type Platform = 'douyin' | 'kuaishou' | 'xiaohongshu' | 'toutiao' | 'weibo' | 'zhihu' | 'channels';

// 抖音数据结构
export interface DouyinData {
  scraped_at: string;
  aweme_id: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  publishTime: string;
}

// 微博数据结构
export interface WeiboData {
  scraped_at: string;
  weibo_id: string;
  content: string;
  views: number;
  likes: number;
  comments: number;
  reposts: number;
  publishTime: string;
}

// 小红书数据结构
export interface XiaohongshuData {
  scraped_at: string;
  note_id: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  exposure: number;
  publishTime: string;
}

// 快手数据结构
export interface KuaishouData {
  scraped_at: string;
  photo_id: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  publishTime: string;
}

// 今日头条数据结构
export interface ToutiaoData {
  scraped_at: string;
  article_id: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  publishTime: string;
}

// 知乎数据结构
export interface ZhihuData {
  scraped_at: string;
  question_id: string;
  title: string;
  views: number;
  voteup_count: number;
  comments: number;
  favorites: number;
  publishTime: string;
}

// 视频号数据结构
export interface ChannelsData {
  scraped_at: string;
  title: string;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  favorites: number;
  publishTime: string;
}

// 联合类型
export type PlatformData = DouyinData | WeiboData | XiaohongshuData | KuaishouData | ToutiaoData | ZhihuData | ChannelsData;

// API 响应
export interface PlatformDataResponse {
  success: boolean;
  platform: string;
  count: number;
  data: PlatformData[];
  error?: string;
}

// ============ API 函数 ============

/**
 * 获取指定平台的原始数据
 */
export async function fetchPlatformData(platform: Platform): Promise<PlatformDataResponse> {
  try {
    const response = await fetch(`/api/snapshots/${platform}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Failed to fetch ${platform} data:`, error);
    return {
      success: false,
      platform,
      count: 0,
      data: [],
      error: error instanceof Error ? error.message : '网络错误',
    };
  }
}

/**
 * 获取所有平台数据
 */
export async function fetchAllPlatformData(): Promise<Record<Platform, PlatformDataResponse>> {
  const platforms: Platform[] = ['douyin', 'kuaishou', 'xiaohongshu', 'toutiao', 'weibo', 'zhihu', 'channels'];

  const results = await Promise.all(
    platforms.map(platform => fetchPlatformData(platform))
  );

  return platforms.reduce((acc, platform, index) => {
    acc[platform] = results[index];
    return acc;
  }, {} as Record<Platform, PlatformDataResponse>);
}

// ============ 导出 ============

export const platformDataApi = {
  fetchPlatformData,
  fetchAllPlatformData,
};
