import { execFileSync } from 'node:child_process';
import { BILIBILI_APPROVED } from './bilibili-verify-release.mjs';
import { assertPreflightPng } from './preflight-phone-driver.mjs';

const pkg = 'tv.danmaku.bili';
const main = pkg + '/tv.danmaku.bili.MainActivityV2';
const profile = pkg + '/tv.danmaku.bili.ui.personinfo.PersonInfoActivity';
const details = pkg + '/com.bilibili.ship.theseus.detail.UnitedBizDetailsActivity';
const space = pkg + '/com.bilibili.app.authorspace.local.LocalAuthorSpaceActivity';
const manager = pkg + '/com.bilibili.lib.ui.GeneralActivity';
const manuscript = pkg + '/com.bilibili.upper.module.contribute.up.ui.ManuscriptEditActivityV5';
const limits = { width: BILIBILI_APPROVED.width, height: BILIBILI_APPROVED.height };

function need(value, reason) {
  if (!value) throw Error('BILIBILI_NATIVE_' + reason);
}

const xmlReader = String.raw`
import json,sys,xml.etree.ElementTree as ET
root=ET.fromstring(sys.stdin.buffer.read())
if root.tag!='hierarchy': raise ValueError('hierarchy')
all_nodes=list(root.iter('node'))
parents={child:node for node in all_nodes for child in node}
keys={'package','resource-id','text','content-desc','bounds','enabled','clickable','checked'}
print(json.dumps([
    dict({k:value for k,value in node.attrib.items() if k in keys},
        parent_resource_id=parents[node].get('resource-id','') if node in parents else '',
        children=[{k:value for k,value in child.attrib.items() if k in keys} for child in node])
    for node in all_nodes if node.get('package')=='tv.danmaku.bili'
]))
`;

function readNativeTree(snapshot) {
  const { xml, png } = snapshot;
  need(Buffer.isBuffer(xml) && xml.length > 0 && xml.length <= 1024 * 1024
    && !/<!(?:DOCTYPE|ENTITY)/i.test(xml.toString('utf8')), 'TREE');
  assertPreflightPng(png, limits);
  const value = execFileSync('/usr/bin/python3', ['-I', '-B', '-S', '-c', xmlReader], {
    input: xml, timeout: 3000, maxBuffer: 3 * 1024 * 1024, encoding: 'utf8', env: {},
  });
  return JSON.parse(value);
}
function byId(nodes, id) {
  return nodes.filter(node => node['resource-id'] === pkg + ':id/' + id);
}
function one(rows, reason) {
  need(rows.length === 1, reason);
  return rows[0];
}
function text(nodes, id) {
  return one(byId(nodes, id), id).text;
}
function point(node, { requireClickable = true } = {}) {
  need(node.enabled === 'true' && (!requireClickable || node.clickable === 'true'), 'TAP_ANCHOR');
  const box = /^(?:\[(\d+),(\d+)\])(?:\[(\d+),(\d+)\])$/.exec(node.bounds || '');
  need(box, 'TAP_BOUNDS');
  const [left, top, right, bottom] = box.slice(1).map(Number);
  need(left < right && top < bottom && right <= limits.width && bottom <= limits.height, 'TAP_BOUNDS');
  return [Math.floor((left + right) / 2), Math.floor((top + bottom) / 2)];
}

function ocrRows(rows) {
  need(Array.isArray(rows) && rows.length <= 1500, 'OCR');
  return rows.map(row => {
    need(typeof row?.text === 'string' && typeof row.confidence === 'number' && Array.isArray(row.box)
      && row.box.length === 4 && row.box.every(value => Number.isFinite(value) && value >= 0 && value <= 1), 'OCR_ROW');
    const [x, y, w, h] = row.box;
    need(w > 0 && h > 0 && x + w <= 1 && y + h <= 1, 'OCR_ROW');
    return { text: row.text.trim(), confidence: row.confidence, x, y, w, h };
  });
}
function ocrPoint({ x, y, w, h }) {
  return [Math.floor((x + w / 2) * limits.width), Math.floor((y + h / 2) * limits.height)];
}
export function findBilibiliOwnEditor(rows) {
  const items = ocrRows(rows);
  one(items.filter(row => row.text === '稿件管理' && row.y < 0.13), 'MANAGER');
  const title = one(items.filter(row => row.text === BILIBILI_APPROVED.title
    && row.confidence >= 0.8 && row.x > 0.4 && row.y > 0.21 && row.y < 0.8), 'WORK_TITLE');
  const editor = one(items.filter(row => row.text === '编辑' && row.confidence >= 0.8
    && row.x > 0.62 && row.x < 0.78 && row.y > title.y + 0.12 && row.y < title.y + 0.22), 'WORK_EDIT');
  one(items.filter(row => row.text === '数据' && row.x > 0.45 && row.x < 0.65
    && Math.abs(row.y - editor.y) < 0.012), 'WORK_CONTROLS');
  one(items.filter(row => row.text === '更多' && row.x > 0.80 && row.x < 0.95
    && Math.abs(row.y - editor.y) < 0.012), 'WORK_CONTROLS');
  return ocrPoint(editor);
}
export function findBilibiliAuthorEditor(rows) {
  const items = ocrRows(rows);
  one(items.filter(row => row.text === '企业Ai员工智能体' && row.x < 0.36 && row.y > 0.25 && row.y < 0.39), 'AUTHOR');
  return ocrPoint(one(items.filter(row => row.text === '编辑资料' && row.confidence >= 0.8
    && row.x > 0.42 && row.y > 0.22 && row.y < 0.34), 'AUTHOR_EDIT'));
}

export function createBilibiliNativeReader(device) {
  const pause = ms => device.pause(ms);
  async function frame(expected) {
    const image = await device.capture();
    need(image.focus === expected, 'FOREGROUND');
    return Object.assign(image, { nodes: readNativeTree(image) });
  }
  async function scopedTap(image, node, options) {
    const [x, y] = point(node, options);
    await device.navigationTap({ image, x, y });
  }
  async function ownMenu() {
    const image = await frame(main);
    const label = one(image.nodes.filter(node => node['content-desc'] === '我的,5之5,标签'), 'MY_TAB');
    await scopedTap(image, label);
    await pause(650);
    const mine = await frame(main);
    need(text(mine.nodes, 'nick_name') === '企业Ai员工智能体', 'ACCOUNT_NAME');
    return mine;
  }
  function uid(image) {
    const value = one(byId(image.nodes, 'uid'), 'UID');
    need(value.parent_resource_id === pkg + ':id/uid_layout'
      && value.text === BILIBILI_APPROVED.owner_uid, 'UID');
    return image.xml;
  }
  function verifyDetail(image) {
    need(text(image.nodes, 'avid') === BILIBILI_APPROVED.bvid
      && text(image.nodes, 'author_name') === '企业Ai员工智能体'
      && text(image.nodes, 'tvTitle') === '本稿件已被设置为仅自己可见'
      && byId(image.nodes, 'title').some(node => node.text === BILIBILI_APPROVED.title), 'WORK');
  }
  return async function readOwnVideo(request) {
    need(request?.operation === 'read_own_existing_video'
      && request.profile === BILIBILI_APPROVED.profile && request.serial === BILIBILI_APPROVED.serial
      && request.bvid === BILIBILI_APPROVED.bvid && request.ownerUid === BILIBILI_APPROVED.owner_uid
      && request.owner === request.runId, 'SCOPE');
    await device.launchBilibili();
    await pause(2000);
    for (let count = 0; count < 3; count++) {
      const focus = await device.foreground();
      if (focus === main) break;
      need([profile, details, space, manager].includes(focus), 'START_FOREGROUND');
      await device.navigateBack(focus);
      await pause(550);
    }
    const mine = await ownMenu();
    await scopedTap(mine, one(byId(mine.nodes, 'edit_information'), 'PROFILE_ENTRY'));
    await pause(550);
    const account = uid(await frame(profile));
    await device.openApprovedVideo();
    await pause(12000);
    let work = await frame(details);
    verifyDetail(work);
    if (!byId(work.nodes, 'gemini_halfscreen_progress_text').length) {
      await scopedTap(work, one(byId(work.nodes, 'control_container'), 'PLAYER_ANCHOR'), { requireClickable: false });
      work = await frame(details);
      verifyDetail(work);
    }
    need(text(work.nodes, 'gemini_halfscreen_progress_text') === '00:10/00:10', 'PLAYBACK');
    const authorLink = one(byId(work.nodes, 'author_layout'), 'AUTHOR_LINK');
    need(authorLink['content-desc']?.endsWith('点击进入空间页'), 'AUTHOR_LINK');
    await scopedTap(work, authorLink);
    await pause(1800);
    const authorSpace = await frame(space);
    const native = authorSpace.nodes.filter(node => node.text === '编辑资料' && node.clickable === 'true');
    if (native.length === 1) await scopedTap(authorSpace, native[0]);
    else {
      need(!native.length, 'AUTHOR_EDIT');
      const [x, y] = findBilibiliAuthorEditor(await device.ocr(authorSpace.png));
      await device.navigationTap({ image: authorSpace, x, y, requireSamePixels: true });
    }
    await pause(600);
    const author = uid(await frame(profile));
    for (const screen of [profile, space, details, profile]) {
      const present = await device.foreground();
      if (present === main) break;
      need(present === screen, 'AUTHOR_EXIT');
      await device.navigateBack(screen);
      await pause(550);
    }
    const home = await ownMenu();
    const manage = one(home.nodes.filter(node => node['content-desc'] === '稿件管理'), 'MANAGE_ENTRY');
    await scopedTap(home, manage);
    await pause(1800);
    const list = await frame(manager);
    const [x, y] = findBilibiliOwnEditor(await device.ocr(list.png));
    await device.navigationTap({ image: list, x, y, requireSamePixels: true });
    await pause(650);
    const editor = await frame(manuscript);
    need(text(editor.nodes, 'et_title') === BILIBILI_APPROVED.title && text(editor.nodes, 'tv_title') === '编辑稿件', 'EDITOR');
    const more = one(byId(editor.nodes, 'layout_setting'), 'SETTINGS');
    need(more.children.some(node => node.text === '更多设置'), 'SETTINGS');
    await scopedTap(editor, more);
    await pause(650);
    const settings = await frame(manuscript);
    need(one(byId(settings.nodes, 'scSelfVisible'), 'PRIVATE_SWITCH').checked === 'true', 'PRIVATE_SWITCH');
    await device.navigateBack(manuscript);
    const unchanged = await frame(manuscript);
    need(text(unchanged.nodes, 'et_title') === BILIBILI_APPROVED.title, 'EDITOR_EXIT');
    await device.navigateBack(manuscript);
    need(await device.foreground() === manager, 'EDITOR_EXIT');
    return {
      ...request, package: pkg, account, author, detail: work.xml, player: work.png,
      editor: editor.xml, settings: settings.xml, sideEffects: { publish: 0, share: 0, visibilityChanges: 0 },
    };
  };
}

export function createBilibiliNativeDevice({ adb, ocr, contentHash, pause, now = Date.now }) {
  const images = new WeakMap();
  let captureSequence = 0;
  const output = async (...args) => {
    const value = await adb(args);
    need(Buffer.isBuffer(value), 'TRANSPORT');
    return value;
  };
  const foreground = async () => {
    const response = await output('shell', 'dumpsys', 'window');
    const rows = [...response.toString('utf8').matchAll(/^[ \t]*mCurrentFocus=Window\{[^\n]*[ \t]([\w.]+)\/([\w.$]+)\}[ \t]*$/gm)];
    const match = one(rows, 'FOREGROUND');
    return match[1] + '/' + match[2];
  };
  async function capture() {
    const focus = await foreground();
    need(focus.startsWith(pkg + '/'), 'FOREGROUND');
    const png = await output('exec-out', 'screencap', '-p');
    const dump = await output('exec-out', 'uiautomator', 'dump', '/dev/tty');
    const begin = dump.indexOf('<?xml');
    const end = dump.lastIndexOf('</hierarchy>');
    need(begin >= 0 && end > begin && await foreground() === focus, 'CAPTURE_DRIFT');
    const image = { focus, xml: dump.subarray(begin, end + '</hierarchy>'.length), png };
    images.set(image, { captureSequence: ++captureSequence, at: now() });
    return image;
  }
  async function navigationTap({ image, x, y, requireSamePixels = false }) {
    const registered = images.get(image);
    need(registered && registered.captureSequence === captureSequence && now() - registered.at < 30000, 'TAP_STALE');
    need(Number.isInteger(x) && Number.isInteger(y) && x > 0 && x < limits.width
      && y > 100 && y < limits.height - 45, 'TAP_BOUNDS');
    images.delete(image);
    need(await foreground() === image.focus, 'TAP_DRIFT');
    if (requireSamePixels) {
      const current = await output('exec-out', 'screencap', '-p');
      need(await contentHash(current) === await contentHash(image.png), 'TAP_PIXELS');
    }
    await output('shell', 'input', 'tap', String(x), String(y));
  }
  async function navigateBack(expected) {
    need([profile, details, space, manager, manuscript].includes(expected) && await foreground() === expected, 'BACK_DRIFT');
    await output('shell', 'input', 'keyevent', '4');
  }
  async function launchBilibili() {
    const result = await output('shell', 'cmd', 'package', 'resolve-activity', '--brief', '-a',
      'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', pkg);
    const components = result.toString('utf8').split(/\r?\n/).filter(row => /^tv\.danmaku\.bili\/[\w.$]+$/.test(row));
    const component = one(components, 'LAUNCHER');
    await output('shell', 'am', 'start', '-a', 'android.intent.action.MAIN', '-c', 'android.intent.category.LAUNCHER', '-n', component);
  }
  async function openApprovedVideo() {
    need(await foreground() === profile, 'VIDEO_ROUTE');
    await output('shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d',
      'https://www.bilibili.com/video/' + BILIBILI_APPROVED.bvid, '-p', pkg);
  }
  return { foreground, capture, navigationTap, navigateBack, launchBilibili, openApprovedVideo, ocr, pause };
}
