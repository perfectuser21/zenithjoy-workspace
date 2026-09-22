// comment-tier-lib.js —— 评论采集"大户分级"纯逻辑(0922拍板,供harvest-keyword.sh的
// 翻屏累积循环调用其决策部分;去重key跟push-raw-comments.js现有rid逻辑保持一致)
"use strict";

// 分档:
//   ≤10条  → small,不特殊处理,一屏基本够
//   10-100条 → medium,翻屏抓到exhausted为止(数量不大,直接抓完问题不大)
//   >100条 → large(大户),翻屏抓到封顶条数或exhausted两者先到为止,不追求抓完
const LARGE_ACCOUNT_THRESHOLD = 100;
const SMALL_ACCOUNT_THRESHOLD = 10;
const DEFAULT_LARGE_ACCOUNT_CAP = 50;

function commentTier(commentCount, largeCap = DEFAULT_LARGE_ACCOUNT_CAP) {
  const n = Number(commentCount) || 0;
  if (n <= SMALL_ACCOUNT_THRESHOLD) return { tier: "small", cap: null };
  if (n <= LARGE_ACCOUNT_THRESHOLD) return { tier: "medium", cap: null };
  return { tier: "large", cap: largeCap };
}

// 翻屏去重key,跟push-raw-comments.js现有的rid逻辑保持一致(昵称+抖音号+评论前20字)。
function commentDedupKey(nick, douyinId, commentBody) {
  return `${nick || ""}|${douyinId || "noid"}|${(commentBody || "").slice(0, 20)}`;
}

// 决定"这一屏读完之后,还要不要再滑一屏":
//   - exhausted(真到底了) → 停
//   - 有cap且已经攒够cap条 → 停(大户封顶)
//   - 连续2次滑动新增数量都是0(可能卡住了,swipe没生效或一直停在同一批) → 停,防死循环
//   - 否则 → 继续滑
function shouldKeepScrolling({ exhausted, totalCollected, cap, consecutiveEmptyRounds }) {
  if (exhausted) return false;
  if (cap != null && totalCollected >= cap) return false;
  if ((consecutiveEmptyRounds || 0) >= 2) return false;
  return true;
}

module.exports = {
  commentTier,
  commentDedupKey,
  shouldKeepScrolling,
  LARGE_ACCOUNT_THRESHOLD,
  SMALL_ACCOUNT_THRESHOLD,
  DEFAULT_LARGE_ACCOUNT_CAP,
};
