import axios from 'axios';

/**
 * Bug C 修复：抖音搜索结果无障碍节点树没有 ≥10 位真实 video_id，agent 造假 id 导致
 * Stage2 深链打不开。改由 agent 经 share-intent 拿 v.douyin.com 短链上报 share_url，
 * 服务端在这里手动跟随 302 拿到真实 (kind,id) 才登记。
 *
 * 安全：只跟随抖音自家域名（白名单），防 SSRF 打内网元数据服务。
 */

export type MediaKind = 'video' | 'note';
export interface Media {
  kind: MediaKind;
  id: string;
}

// 注入式 HTTP HEAD：返回该 URL 的状态码与 Location（不真发网络时用于测试）
export type HttpHead = (url: string) => Promise<{ status: number; location: string | null }>;

const DOUYIN_HOST_WHITELIST = new Set([
  'v.douyin.com',
  'douyin.com',
  'www.douyin.com',
  'iesdouyin.com',
  'www.iesdouyin.com',
]);

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

function isDouyinHost(url: string): boolean {
  const h = hostOf(url);
  return h != null && DOUYIN_HOST_WHITELIST.has(h);
}

function isDouyinShortUrl(url: string): boolean {
  return hostOf(url) === 'v.douyin.com';
}

/** 从分享面板文案（含中文/emoji + 短链）里抽出第一个 v.douyin.com 短链，无则 null */
export function extractShareUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/v\.douyin\.com\/(?:i\/)?[A-Za-z0-9]+\/?/);
  return m ? m[0] : null;
}

/** 从最终 URL 抽 (kind,id)；只认 ≥10 位数字 id，登录/验证页等无 /video|/note 结构返回 null */
export function parseMediaFromUrl(url: string | null | undefined): Media | null {
  if (!url) return null;
  const m = url.match(/\/(video|note)\/(\d{10,})/);
  if (!m) return null;
  return { kind: m[1] as MediaKind, id: m[2] };
}

/**
 * 手动跟随 302，最多 maxHops 跳，拿到真实 media。
 * - 输入必须是 v.douyin.com 短链，否则直接 null
 * - 跳出抖音白名单域名（SSRF）→ 停止返回 null
 * - 超 maxHops 仍未命中 → null
 * - 网络异常 → 吞掉返回 null（不崩）
 */
export async function resolveShareUrl(
  shortUrl: string,
  opts: { httpGet: HttpHead; maxHops?: number },
): Promise<Media | null> {
  const { httpGet, maxHops = 3 } = opts;
  if (!isDouyinShortUrl(shortUrl)) return null;
  let currentUrl = shortUrl;
  try {
    for (let hop = 0; hop < maxHops; hop++) {
      const { status, location } = await httpGet(currentUrl);
      if (status >= 300 && status < 400 && location) {
        if (!isDouyinHost(location)) return null; // SSRF 防护
        const media = parseMediaFromUrl(location);
        if (media) return media;
        currentUrl = location;
        continue;
      }
      // 非重定向：尝试从当前 URL 抽，抽不到即 null
      return parseMediaFromUrl(currentUrl);
    }
    return null; // 跳数耗尽仍未命中
  } catch {
    return null;
  }
}

// 真实 HTTP HEAD：axios 不自动跟随，手动读 Location（5s 超时）
const axiosHead: HttpHead = async (url: string) => {
  const resp = await axios.request({
    url,
    method: 'HEAD',
    maxRedirects: 0,
    timeout: 5000,
    validateStatus: () => true,
  });
  const loc = resp.headers?.location;
  return { status: resp.status, location: typeof loc === 'string' ? loc : null };
};

/**
 * 路由层入口：接受 agent 上报的 share_url（干净短链或原始分享文案均可），
 * 解析成真实 (kind,id)，失败返回 null（调用方据此跳过该卡片，不造假）。
 */
export async function resolveShareToMedia(shareUrlOrText: string): Promise<Media | null> {
  const shortUrl = extractShareUrl(shareUrlOrText);
  if (!shortUrl) return null;
  return resolveShareUrl(shortUrl, { httpGet: axiosHead });
}

/** 真实 video_id 判据：≥10 位纯数字。用于兼容旧路径 / 防造假 id 混入。 */
export function isLikelyRealVideoId(id: string | null | undefined): boolean {
  return /^\d{10,}$/.test(id ?? '');
}
