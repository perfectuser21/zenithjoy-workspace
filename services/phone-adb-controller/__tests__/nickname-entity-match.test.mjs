// services/phone-adb-controller/__tests__/nickname-entity-match.test.mjs
//
// 「点进主页了，人也进对了，却判成进错人」——昵称比对两边编码不一致。
//
// ## 0923 悦升夜批实证（auto09232300）
//
// 一条评论要变成线索，得知道是谁写的：在评论区点头像 → 进他主页 → 读抖音号。
// 怎么确认进对了人？拿主页上的昵称跟评论区那条评论的昵称比，一样才算数。
//
// 比对的两边是这么来的：
//   expected —— 调用方从评论区 XML 里读到的 content-desc，原样 base64 传进来
//   observed —— 用 xmllint 从主页 XML 里 xpath 取的 @text
//
// **xmllint 会把 XML 里的字符实体解码，而调用方传来的那份没有解码。**
// 同一个文件、同一个人，两条路读出两个字符串：
//
//   xmllint 取:  '小辣椒🌶️'          ← &#127798; 被解成了真 emoji
//   原始字节:    '小辣椒&#127798;️'   ← 未解码
//
// 字面一比不相等 → die "nickname mismatch" → 退回去重试 → 三次全一样 → 放弃这个人。
// 证据：同一个人的 t2/t3 两次重试，主页昵称都读到「小辣椒🌶️」、抖音号都是
// 87784291536 —— **每次都进对了，每次都被判失败**。
//
// ## 代价
//
// 那批评论区去重后 801 人，68 人昵称带实体（8.5%）。这 68 个人**每一个**都会走完
// 三轮重试再放弃，每个约 3~4 分钟 ≈ 合计 4 小时。这批总共跑了 8.5 小时，
// 跑到早上 7 点还没完，把 03:00 那批整个挤掉（12 个词全「锁被占」，LEAD=0）。
//
// ## 契约
//
// 比对前把两边**归一到同一种形式**再比。名字里有没有 emoji、装饰符号，
// 都不该影响「这是不是同一个人」的判断。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameNickname, decodeXmlEntities } from '../nickname-match-lib.js';

// ── 真机样本（取自 auto09232300-w12-v1-u13 的两份 XML）──────────────────

test('实体形式 vs 解码后形式 → 同一个人（0923 那 68 人被误杀的原样）', () => {
  assert.equal(sameNickname('小辣椒&#127798;️', '小辣椒🌶️'), true);
});

test('反过来也认（谁在左谁在右都一样）', () => {
  assert.equal(sameNickname('小辣椒🌶️', '小辣椒&#127798;️'), true);
});

test('多个 emoji 的也认（真机样本：陈骆猪🐷🐷）', () => {
  assert.equal(sameNickname('陈骆猪&#128055;&#128055;', '陈骆猪🐷🐷'), true);
});

test('十六进制实体也认（&#x1F335; 这种写法）', () => {
  assert.equal(sameNickname('仙人掌&#x1F335;', '仙人掌🌵'), true);
});

// ── 不能放过真正不同的人 ────────────────────────────────────────────────
//
// 这一步防的是「点歪了进错人主页，把 A 的评论配上 B 的抖音号」——
// 将来就会给错的人发私信。归一化只能抹平编码差异，绝不能把两个人抹成一个。

test('不同的人还是不同（这一步的全部意义所在）', () => {
  assert.equal(sameNickname('小辣椒🌶️', '大蒜头🧄'), false);
  assert.equal(sameNickname('垫底辣条', '峥嵘岁月'), false);
});

test('只差一个字也算不同', () => {
  assert.equal(sameNickname('叫我二姐姐', '叫我二姐'), false);
});

test('emoji 不同 → 不同的人（别归一化过头把 emoji 整个扔掉）', () => {
  // 如果实现偷懒把所有 emoji 剥掉再比，这两个会被当成同一人 —— 那就从
  // 「误杀」滑到了「误认」，比原 bug 更危险：会把私信发给另一个人。
  assert.equal(sameNickname('辣条&#127798;', '辣条&#128055;'), false);
});

test('空昵称永远不算匹配（读不到就是读不到，别当成功）', () => {
  assert.equal(sameNickname('', ''), false);
  assert.equal(sameNickname('', '小辣椒🌶️'), false);
  assert.equal(sameNickname('小辣椒🌶️', ''), false);
  assert.equal(sameNickname(null, undefined), false);
});

// ── 首尾空白与变体选择符 ────────────────────────────────────────────────

test('首尾空白不影响判定（XML 属性里常带空格）', () => {
  assert.equal(sameNickname('  小辣椒🌶️  ', '小辣椒🌶️'), true);
});

test('变体选择符 U+FE0F 有无都算同一个人', () => {
  // 真机样本里 '小辣椒&#127798;️' 末尾就带一个 U+FE0F（️），
  // 而有些路径读出来不带 —— 它只影响 emoji 显示成彩色还是黑白，不是另一个人。
  assert.equal(sameNickname('小辣椒🌶️', '小辣椒🌶'), true);
});

// ── 解码函数本身 ──────────────────────────────────────────────────────

test('decodeXmlEntities：十进制、十六进制、命名实体都认', () => {
  assert.equal(decodeXmlEntities('小辣椒&#127798;'), '小辣椒🌶');
  assert.equal(decodeXmlEntities('仙人掌&#x1F335;'), '仙人掌🌵');
  assert.equal(decodeXmlEntities('A&amp;B'), 'A&B');
  assert.equal(decodeXmlEntities('&lt;tag&gt;'), '<tag>');
});

test('decodeXmlEntities：没有实体的原样返回，不乱动', () => {
  assert.equal(decodeXmlEntities('垫底辣条'), '垫底辣条');
  assert.equal(decodeXmlEntities('小辣椒🌶️'), '小辣椒🌶️');
});

test('decodeXmlEntities：残缺实体不崩也不瞎猜', () => {
  // 昵称里真有人写 "&#" 开头的字符串，别把它当实体解坏了
  assert.equal(decodeXmlEntities('价格&#'), '价格&#');
  assert.equal(decodeXmlEntities('&#abc;'), '&#abc;');
});

test('纯函数文件：在空目录里 require 得干干净净', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const sandbox = mkdtempSync(`${tmpdir()}/nickmatch-`);
  const lib = new URL('../nickname-match-lib.js', import.meta.url).pathname;
  execFileSync(process.execPath,
    ['-e', `const m=require(${JSON.stringify(lib)}); if(typeof m.sameNickname!=='function') process.exit(9);`],
    { cwd: sandbox, env: { PATH: process.env.PATH, HOME: sandbox }, stdio: 'pipe' });
});
