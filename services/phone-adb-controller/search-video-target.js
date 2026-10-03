'use strict';
// 仅Discovery点击前的同帧身份定位；标题+时长只标记队列目标，不能证明video_id。
const fs = require('node:fs');
const APP = 'com.ss.android.ugc.aweme';
// XML 1.0 Char；UI dump仅接受ASCII属性名子集，不替换非法字节。
const invalidXmlChar = /[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/u;
function decodeXml(text) {
  const parts = text.split('&');
  return parts[0] + parts.slice(1).map(part => {
    const separator = part.indexOf(';');
    if (separator < 0) throw Error('unterminated XML entity');
    const entity = part.slice(0, separator), tail = part.slice(separator + 1);
    const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (Object.hasOwn(named, entity)) return named[entity] + tail;
    const number = /^#x[0-9a-f]+$/i.test(entity) ? parseInt(entity.slice(2), 16)
      : /^#[0-9]+$/.test(entity) ? Number(entity.slice(1)) : NaN;
    if (!Number.isSafeInteger(number) || number <= 0 || number > 0x10ffff || number >= 0xd800 && number <= 0xdfff) throw Error('invalid XML entity');
    const character = String.fromCodePoint(number);
    if (invalidXmlChar.test(character)) throw Error('invalid XML character entity');
    return character + tail;
  }).join('');
}
function nodesOf(xml) {
  if (xml.length > 4 * 1024 * 1024 || invalidXmlChar.test(xml) || /<!|&(?!amp;|quot;|apos;|lt;|gt;|#\d+;|#x[0-9a-f]+;)/i.test(xml)) throw Error('invalid XML frame');
  const nodes = [], stack = []; let end = 0, hierarchy = 0;
  function* tokens() {
    let cursor = 0;
    while (cursor < xml.length) {
      const index = xml.indexOf('<', cursor); if (index < 0) return;
      const close = xml.indexOf('>', index); if (close < 0) throw Error('unterminated XML tag');
      yield { 0: xml.slice(index, close + 1), index }; cursor = close + 1;
    }
  }
  for (const token of tokens()) {
    if (xml.slice(end, token.index).trim()) throw Error('unexpected XML text');
    end = token.index + token[0].length;
    const tag = token[0];
    if (/^<\?xml\s[^>]*\?>$/.test(tag) && token.index === 0) continue;
    const closing = /^<\/(node|hierarchy)>$/.exec(tag);
    if (closing) { if (stack.pop()?.kind !== closing[1]) throw Error('mismatched XML close'); continue; }
    const open = /^<(node|hierarchy)\b([^>]*?)(\/?)>$/.exec(tag);
    if (!open || open[1] === 'hierarchy' && (stack.length || ++hierarchy !== 1) || open[1] === 'node' && !stack.length) throw Error('invalid XML structure');
    const attrs = {}; let cursor = 0;
    const attribute = /([A-Za-z_][A-Za-z0-9_.:-]*)="([^"<]*)"/y;
    while (cursor < open[2].length) {
      // XML属性必须以空白分隔，属性值不能含未转义的<。
      if (!/[ \t\r\n]/.test(open[2][cursor])) throw Error('missing XML attribute separator');
      while (/[ \t\r\n]/.test(open[2][cursor] || '') && cursor < open[2].length) cursor++;
      if (cursor === open[2].length) break;
      attribute.lastIndex = cursor; const attr = attribute.exec(open[2]);
      if (!attr || Object.hasOwn(attrs, attr[1])) throw Error('invalid XML attributes');
      attrs[attr[1]] = decodeXml(attr[2]); cursor = attribute.lastIndex;
    }
    const node = { kind: open[1], attrs, parent: stack.at(-1) || null };
    if (node.kind === 'node') nodes.push(node);
    if (nodes.length > 20000 || stack.length > 128) throw Error('oversized XML structure');
    if (!open[3]) stack.push(node);
  }
  if (stack.length || hierarchy !== 1 || xml.slice(end).trim()) throw Error('incomplete XML frame');
  return nodes;
}
function bounds(node, width, height) {
  const match = /^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$/.exec(node.attrs.bounds || '');
  if (!match) throw Error('invalid target bounds');
  const [x1, y1, x2, y2] = match.slice(1).map(Number);
  if (![x1,y1,x2,y2,width,height].every(Number.isSafeInteger) || width <= 0 || height <= 0 || x2 <= x1 || y2 <= y1 || x2 > width || y2 > height) throw Error('unsafe target bounds');
  return [x1,y1,x2,y2];
}
function locateTarget(xml, { keyword, title, duration, width, height }) {
  if (!keyword || !title || !/^\d{1,2}:[0-5]\d$/.test(duration)) throw Error('invalid target identity');
  const nodes = nodesOf(xml);
  if (nodes.some(n => ['加载中','正在加载','搜索结果为空'].includes(n.attrs.text) || n.attrs['content-desc'] === '加载中')) throw Error('unsettled search frame');
  const app = nodes.filter(n => n.attrs.package === APP && n.attrs.enabled === 'true');
  const fields = app.filter(n => n.attrs['resource-id'] === APP + ':id/et_search_kw');
  const tabs = app.filter(n => n.attrs.text === '视频' && n.attrs.selected === 'true');
  if (fields.length !== 1 || fields[0].attrs.text !== keyword || tabs.length !== 1) throw Error('search context unconfirmed');
  const fieldBounds = bounds(fields[0], width, height), tab = bounds(tabs[0], width, height);
  if (tabs[0].attrs.class !== 'android.widget.Button' || tab[1] < fieldBounds[3] || tab[3] > height / 4) throw Error('video tab structure unconfirmed');
  const matches = app.filter(n => n.attrs.text === title);
  if (matches.length !== 1) throw Error('target missing or ambiguous');
  const target = matches[0], b = bounds(target, width, height);
  if (target.attrs.class !== 'android.widget.TextView' || b[1] <= tab[3]) throw Error('not a video title');
  let card = target.parent;
  while (card?.kind === 'node' && card.attrs.clickable !== 'true') card = card.parent;
  if (!card || card.kind !== 'node' || card.attrs.package !== APP) throw Error('missing clickable card structure');
  const cb = bounds(card, width, height);
  if (b[0] < cb[0] || b[1] < cb[1] || b[2] > cb[2] || b[3] > cb[3]) throw Error('title outside card');
  const inside = n => { for (let p = n.parent; p; p = p.parent) if (p === card) return true; return false; };
  const likes = app.filter(n => inside(n) && /喜欢.+，按钮$/.test(n.attrs['content-desc'] || '')).filter(n => {
    const l = bounds(n,width,height); return l[1] >= b[3] && l[1]-b[3] <= 80 && l[0] >= b[0] && l[2] <= b[2];
  });
  const durations = app.filter(n => inside(n) && n.attrs.text === duration).filter(n => {
    const d = bounds(n,width,height); return b[1] >= d[3] && b[1]-d[3] <= 100 && d[0] >= b[0] && d[2] <= b[2];
  });
  if (likes.length !== 1 || durations.length !== 1) throw Error('video card evidence unconfirmed');
  return { x: Math.floor((b[0]+b[2])/2), y: Math.floor((b[1]+b[3])/2) };
}
function decodeBase64(value) {
  if (!value || value.length > 8192 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw Error('invalid target base64');
  const bytes = Buffer.from(value,'base64');
  if (bytes.toString('base64') !== value) throw Error('noncanonical target base64');
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
module.exports = { locateTarget, decodeXml };
if (require.main === module) {
  try {
    const [file,keyword,title,duration,width,height] = process.argv.slice(2);
    const target = locateTarget(fs.readFileSync(file,'utf8'), { keyword:decodeBase64(keyword), title:decodeBase64(title), duration, width:Number(width), height:Number(height) });
    console.log(target.x+' '+target.y);
  } catch { console.error('DISCOVERY_TARGET_UNCONFIRMED'); process.exitCode = 2; }
}
