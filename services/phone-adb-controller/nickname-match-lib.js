// nickname-match-lib.js —— 判断「主页上这个人」和「评论区那条评论的人」是不是同一个
//
// ## 为什么需要这个
//
// 采到评论后要知道是谁写的：点头像 → 进主页 → 读抖音号。进去之后得确认没点歪，
// 办法是比对两边的昵称。**这一步防的是把 A 的评论配上 B 的抖音号——将来会给
// 错的人发私信**，所以不能去掉，也不能放松。
//
// ## 0923 悦升夜批的误判
//
// 比对的两边编码不一致：
//   expected —— 调用方从评论区 XML 读的 content-desc，原样 base64 传入（未解码）
//   observed —— xmllint 从主页 XML xpath 取的 @text（xmllint 会解码字符实体）
//
// 同一个文件、同一个人，两条路读出两个字符串：
//   xmllint 取:  '小辣椒🌶️'
//   原始字节:    '小辣椒&#127798;️'
//
// 字面比不等 → 判 mismatch → 退回重试 → 三次全一样 → 放弃这个人。
// 证据：同一人 t2/t3 两次重试，主页昵称都读到「小辣椒🌶️」、抖音号都是
// 87784291536——每次都进对了，每次都判失败。
//
// 代价：那批 801 人里 68 人昵称带实体（8.5%），每人白跑三轮约 3~4 分钟，
// 合计 ≈4 小时。这批跑了 8.5 小时到早上 7 点，把 03:00 那批整个挤掉。
//
// ## 边界（比修 bug 本身更要紧）
//
// 归一化只能抹平**编码形式**，绝不能抹平**人的区别**。emoji 不同就是不同的人，
// 少一个字也是不同的人。从「误杀」滑到「误认」比原 bug 危险得多——
// 误杀只是少一条线索，误认是把私信发给陌生人。

'use strict';

/** XML 命名实体（昵称里能遇到的就这几个） */
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * 把 XML 字符实体解成真字符。
 * xmllint 取 @text 时会自动做这件事，而调用方从原始字节里拿到的没做——
 * 两边要比，就得先站到同一侧。
 */
function decodeXmlEntities(s) {
  if (typeof s !== 'string' || !s) return '';
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body) => {
    try {
      if (body[0] === '#') {
        const cp = body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
        // 码点非法就原样留着——昵称里真有人写 "&#" 开头的字符串，别解坏了
        if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return whole;
        return String.fromCodePoint(cp);
      }
      const named = NAMED[body.toLowerCase()];
      return named === undefined ? whole : named;
    } catch {
      return whole; // 解不出就原样留着，不猜
    }
  });
}

/**
 * 归一：解实体 → 去首尾空白 → 去掉变体选择符。
 *
 * U+FE0F/U+FE0E 只决定 emoji 显示成彩色还是黑白，不是另一个人；
 * 真机样本 '小辣椒&#127798;️' 末尾就带一个 U+FE0F，而有的路径读出来不带。
 * 除此之外一个字符都不动——尤其**不剥 emoji 本身**，那会把不同的人抹成同一个。
 */
function normalizeNickname(s) {
  if (typeof s !== 'string') return '';
  return decodeXmlEntities(s).trim().replace(/[︎️]/g, '');
}

/**
 * 两个昵称是不是同一个人。
 *
 * 空昵称永远不算匹配：读不到就是读不到，当成功等于放弃了这道检查
 * （企业号读不到昵称的情形由调用方的第三条回退路处理，不在这里放水）。
 */
function sameNickname(a, b) {
  const na = normalizeNickname(a);
  const nb = normalizeNickname(b);
  if (!na || !nb) return false;
  return na === nb;
}

module.exports = { sameNickname, normalizeNickname, decodeXmlEntities };
