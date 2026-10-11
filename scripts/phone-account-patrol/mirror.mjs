import fs from 'node:fs';
import { createHash } from 'node:crypto';
import pool from '/app/src/db.js';
import { getToken, notionReq } from '/app/src/recurring-notion-sync.js';
import { parseExecParams } from '/app/src/routing/exec-params.js';
import { qiumiEnv } from '/app/src/routing/env.js';
import { checkAnchor } from '/app/src/anchor-check.js';

// Display-only mirror: never dispatches, edits task bodies, or changes Brain/Notion task status.
const CACHE = '/tmp/cecelia-phone-task-view-cache-v1.json';
const DEVICE_DB = '3d4c40c2-ba63-816d-b72d-d520f2cd090a';
const text = s => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1800) } }] : [] });
const date = s => ({ date: s && Number.isFinite(Date.parse(s)) ? { start: new Date(s).toISOString() } : null });
const digest = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const valueOf = p => p?.type === 'select' || p?.select !== undefined ? p.select?.name ?? null
  : p?.type === 'relation' || p?.relation !== undefined ? (p.relation ?? []).map(x => x.id.replaceAll('-', '')).sort().join(',')
  : p?.type === 'number' || p?.number !== undefined ? p.number ?? null
  : p?.type === 'date' || p?.date !== undefined ? p.date?.start ? new Date(p.date.start).toISOString() : null
  : (p?.rich_text ?? []).map(x => x.plain_text ?? x.text?.content ?? '').join('');
async function mirrorAccountBody(page,snapshot,token,cache) {
  const rt=s=>[{type:'text',text:{content:String(s??'').slice(0,1700)}}];
  const label=s=>s?new Date(s).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未确认';
  const recent=Date.parse(snapshot.checked_at)>Date.now()-36*3600000;
  const paragraph=`${snapshot.schedule_status==='active'?'中央计划已启用：':'中央计划已注册，当前暂停：'}${snapshot.schedule??'计划时间待核对'}。中央Brain定时、MMV代码启动、M4实机检查；维护负责人：${snapshot.maintenance_owner??'主理人'}。设备在线状态由设备镜子维护；账号登录以此表为准。${recent?'':'⚠ 巡查已超过36小时，请检查维护任务。'}本轮：${label(snapshot.checked_at)}。待确认、检测失败、占用或离线时，保留上次身份，不代表仍在登录。`;
  const cells=[['平台','安装','本次状态','账号（最近确认）','本次检查','身份确认']];
  for(const p of ['抖音','小红书','微信','视频号','快手','今日头条','知乎','微博','B站']){
    const o=snapshot.results?.[p]??{},v=o.last_verified;
    cells.push([p,p==='视频号'?'微信内功能':o.installed===true?'已安装':o.installed===false?'未安装':'未核验',`${o.state??'待确认'}${o.state==='待确认'&&o.reason?.includes('协议')?'（协议页）':o.state==='待确认'&&o.reason?.includes('OCR')?'（身份需复核）':o.state==='待确认'&&o.reason?.includes('微信未登录')?'（微信未登录）':''}`,v?`${v.nickname??'昵称待确认'}${v.account_id?'（'+(v.id_verified_at&&v.id_verified_at!==v.verified_at?'上次ID：':'')+v.account_id+'）':''}${o.state==='已登录'?'':'〔上次身份〕'}`:'尚未确认',label(o.checked_at),label(v?.verified_at)+(v?.id_verified_at&&v.id_verified_at!==v.verified_at?'；ID '+label(v.id_verified_at):'')]);
  }
  const key='account-body:'+page.id;const desired=digest({paragraph,cells});
  if(cache[key]?.digest===desired)return;
  const body=await notionReq(token,`/blocks/${page.id}/children?page_size=100`);
  const blocks=body.results??[];
  const heading=blocks.findIndex(b=>b.type==='heading_2'&&(b.heading_2.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join('')==='账号巡查（自动维护）');
  const rowBlock=row=>({object:'block',type:'table_row',table_row:{cells:row.map(rt)}});
  if(heading<0){
    const intro=blocks.find(b=>b.type==='paragraph'&&(b.paragraph.rich_text??[]).some(t=>(t.plain_text??t.text?.content??'').includes('上方按九个平台')));
    await notionReq(token,`/blocks/${page.id}/children`,'PATCH',{...(intro?{after:intro.id}:{}),children:[{object:'block',type:'heading_2',heading_2:{rich_text:rt('账号巡查（自动维护）')}},{object:'block',type:'paragraph',paragraph:{rich_text:rt(paragraph)}},{object:'block',type:'table',table:{table_width:6,has_column_header:true,has_row_header:false,children:cells.map(rowBlock)}}]});
  }else{
    const paragraphBlock=blocks[heading+1],table=blocks[heading+2];
    if(paragraphBlock?.type!=='paragraph'||table?.type!=='table')throw Error('账号巡查区被编辑，保留人工内容；请检查');
    const tableRows=(await notionReq(token,`/blocks/${table.id}/children?page_size=100`)).results??[];
    const current={paragraph:(paragraphBlock.paragraph.rich_text??[]).map(t=>t.plain_text??t.text?.content??'').join(''),cells:tableRows.map(r=>r.table_row.cells.map(c=>c.map(t=>t.plain_text??t.text?.content??'').join('')))};
    if(cache[key]?.rendered && digest(current)!==digest(cache[key].rendered))throw Error('账号巡查区有人修改，保留人工值');
    if(tableRows.length!==cells.length)throw Error('账号巡查表行数已被编辑，保留人工内容');
    await notionReq(token,`/blocks/${paragraphBlock.id}`,'PATCH',{paragraph:{rich_text:rt(paragraph)}});
    for(let i=0;i<cells.length;i++)if(JSON.stringify(current.cells[i])!==JSON.stringify(cells[i]))await notionReq(token,`/blocks/${tableRows[i].id}`,'PATCH',{table_row:{cells:cells[i].map(rt)}});
  }
  cache[key]={digest:desired,rendered:{paragraph,cells}};
}

const closed = new Set(['completed', 'completed_no_pr', 'cancelled', 'canceled']);
const now = Date.now();
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, 'utf8')); } catch {}

try {
  const phones = (await pool.query('SELECT serial,nickname,profile,host,douyin_accounts,wechat FROM phone_registry WHERE enabled=true')).rows;
  const policy = (await pool.query("SELECT value_json FROM working_memory WHERE key='phone_rpa_dispatch'")).rows[0]?.value_json;
  const env = qiumiEnv();
  const tasks = (await pool.query(`SELECT * FROM tasks WHERE task_type='qiumi_task'
    AND payload->>'notion_zh_page_id' IS NOT NULL
    AND (status IN ('queued','in_progress','blocked') OR updated_at > NOW()-INTERVAL '24 hours')
    ORDER BY created_at ASC`)).rows;
  const rows = [];
  for (const t of tasks) {
    const params = parseExecParams(t.payload?.qiumi_source?.body, env);
    const hint = t.payload?.qiumi_route?.device_hint;
    const exact = phones.filter(p => p.serial === hint?.serial);
    const requested = phones.filter(p => params.device === p.nickname || params.device === p.profile || params.device === p.serial);
    const loose = phones.filter(p => (params.device ?? '').includes(p.nickname));
    const candidates = exact.length ? exact : requested.length ? requested : loose;
    if (candidates.length !== 1 && hint?.is_device !== true && !/手机/.test(params.device ?? '')) continue;
    // A phone request without a unique device stays visible, never silently assigned.
    const phone = candidates.length === 1 ? candidates[0] : { nickname: '待确认', serial: null };
    const page = t.payload.notion_zh_page_id;
    const reasons = [];
    let state;
    const humanHold = Object.hasOwn(t.notion_props ?? {}, 'qiumi_human_hold');
    const anchor = checkAnchor(t);
    const eligible = !humanHold && params.present && !params.errors.length && params.agent === 'skill-factory'
      && params.device === phone.nickname && policy?.enabled === true && policy.devices?.includes(phone.nickname)
      && Date.parse(t.created_at) >= Date.parse(policy.since) && !env.deviceDelegationEnabled
      && t.payload?.source === 'notion_gtd' && t.payload?.headed_manual !== true
      && (!t.lane || t.lane === 'AI') && (!t.payload?.lane || t.payload.lane === 'AI')
      && !anchor.blocked;
    if (t.status === 'in_progress') {
      state = '执行中'; reasons.push('执行代理已启动；设备锁是否取得以执行回执为准。');
    } else if (closed.has(t.status)) {
      state = t.status.startsWith('completed') ? '已完成' : '阻塞';
      reasons.push(t.status.startsWith('completed') ? '执行结果已收割。' : '任务已取消，不进入队列。');
    } else if (t.status === 'failed') {
      state = '执行失败'; reasons.push(t.error_message || t.blocked_reason || '查看 OpenClaw结果。');
    } else if (t.status === 'blocked' || humanHold) {
      state = '阻塞'; reasons.push(t.blocked_detail?.message || t.blocked_reason || '人工保留，等待处理。');
    } else if (!eligible) {
      state = '待校验';
      if (phone.serial === null) reasons.push('请求设备未唯一匹配，请明确填写小彩、小黄、小蓝或小白。');
      else if (params.device !== phone.nickname) reasons.push(`设备参数需精确填写「${phone.nickname}」，当前为「${params.device ?? '未填写'}」。`);
      if (!params.present || params.errors.length) reasons.push(`执行参数待校验：${params.errors.join('、') || '缺参数块'}。`);
      if (params.agent !== 'skill-factory') reasons.push('独立手机通道仅接 skill-factory。');
      if (policy?.enabled !== true || !policy.devices?.includes(phone.nickname)) reasons.push('设备自动派发授权未生效。');
      if (Date.parse(t.created_at) < Date.parse(policy?.since)) reasons.push('早于自动派发授权起点，不自动补跑。');
      if (anchor.blocked) reasons.push(anchor.detail || anchor.reason);
      if (!reasons.length) reasons.push('不符合当前自动派发通道条件，等待核查。');
    } else if (t.payload?.device_busy) {
      state = '等待设备'; reasons.push(`设备占用回执：${t.payload.device_busy.owner ?? '其他任务'}；按下次调度时间重试，非实时锁状态。`);
    } else if (Date.parse(t.payload?.next_run_at) > now) {
      state = '排期等待'; reasons.push('尚未到最早调度时间。');
    } else {
      state = '等待执行'; reasons.push(t.claimed_by ? '任务已认领，等待启动。' : '等待独立手机调度器选取。');
    }
    reasons.push(phone.serial === null ? '尚未分配手机。' : exact.length ? `Brain 已路由到 ${phone.nickname}。` : `请求设备为 ${phone.nickname}，尚未正式路由。`);
    if (!closed.has(t.status) && t.status !== 'failed') reasons.push('调度器尚无可靠耗时估算；预计执行时间可填写人工计划，超时上限不是预计耗时。');
    rows.push({ t, phone, params, page, state, eligible, reasons, position: null });
  }
  for (const phone of phones) {
    // Matches this channel's created_at ordering; blocked/invalid tasks never get a queue rank.
    rows.filter(r => r.phone.serial === phone.serial && r.t.status === 'queued' && r.eligible)
      .forEach((r, i) => { r.position = i + 1; });
  }
  const token = getToken();
  const devicePages = new Map();
  const allDevices = [];
  let cursor;
  do {
    const response = await notionReq(token, `/databases/${DEVICE_DB}/query`, 'POST', {
      page_size: 100, 
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    for (const p of response.results ?? []) {
      if (p.archived || p.in_trash) continue;
      allDevices.push(p);
      const serial = valueOf(p.properties?.['序列号']);
      if (serial) devicePages.set(serial, devicePages.has(serial) ? null : p.id);
    }
    cursor = response.has_more ? response.next_cursor : null;
  } while (cursor);

  // Account identities only: read the first two columns, never copy phone/password cells.
  const platforms = ['抖音','小红书','微信','视频号','快手','今日头条','知乎','微博','B站'];
  const accountSources = {'小黄':'3d8c40c2ba6380ddb4b9d9363c97d683','小白':'3d8c40c2ba6380739e97e02ebfbcc0b3','小彩':'3d8c40c2ba638065a580f653f99fddbb','小蓝':'3d8c40c2ba63808385b9cea11200e3cf'};
  const deviceStats = {updated:0, unchanged:0, errors:[], conflicts:[]};
  for (const page of allDevices) {
    const oldType = valueOf(page.properties?.['技术类型']);
    const classification = {Mac:['电脑','Mac'],Windows:['电脑','Windows'],'安卓手机':['手机','安卓'],VPS:['服务器','待核验'],NAS:['NAS','待核验']}[oldType];
    if (!classification) continue;
    const props = {'类型':{select:{name:classification[0]}},'系统分类':{select:{name:classification[1]}}};
    const phone = phones.find(p=>p.serial===valueOf(page.properties?.['序列号']));
    const key = 'device:'+page.id;
    try {
      if (phone) {
        const hostSerial = {'xian-m4':'mac-mini-m4-xian','xian-m1':'xian-m1'}[phone.host] ?? phone.host;
        const parent = devicePages.get(hostSerial);
        props['连接设备'] = {relation:parent?[{id:parent}]:[]};
        let history = cache['accounts:'+phone.serial];
        if (!history || now-history.at>3600000) {
          const identities = {};
          const sourceId = accountSources[phone.nickname];
          if (sourceId) {
            const blocks = await notionReq(token, `/blocks/${sourceId}/children?page_size=100`);
            for (const table of (blocks.results??[]).filter(b=>b.type==='table')) {
              const entries = await notionReq(token, `/blocks/${table.id}/children?page_size=100`);
              for (const entry of entries.results??[]) {
                const cells = entry.table_row?.cells;
                if (!cells) continue;
                const name = (cells[0]??[]).map(x=>x.plain_text??x.text?.content??'').join('');
                const platform = name==='b站'?'B站':name;
                if (!platforms.includes(platform)) continue;
                identities[platform] = (cells[1]??[]).map(x=>x.plain_text??x.text?.content??'').join('');
              }
            }
          }
          history = cache['accounts:'+phone.serial] = {at:now,identities};
        }
        for (const platform of platforms) props[platform+'账号'] = text(history.identities[platform] ? history.identities[platform]+'（旧登记，待核验）' : '未登记');
        const douyin = phone.douyin_accounts ?? [];
        if (douyin.length) props['抖音账号'] = text(douyin.map(a=>`${a.nickname??''}${a.id?'（'+a.id+'）':''}${a.current?'【登记当前】':'【副号】'}`).join('；')+'；登录待核验');
        if (phone.wechat) props['微信账号'] = text(`${phone.wechat.nickname??''}（${phone.wechat.id??''}）；登录待核验`);
        else if (phone.nickname==='小蓝') props['微信账号'] = text('未登录（最近核验；需现场重登）');
        const registered = valueOf(page.properties?.['账号']);
        const video = registered.match(/视频号\s*([^｜]+)/)?.[1]?.trim();
        if (video) props['视频号账号'] = text(video+'（已登记，登录待核验）');
        // Verified account ledger wins over legacy registrations; values are identities/status only.
        const accountSourceId = accountSources[phone.nickname];
        if (accountSourceId) {
          const sourcePage = await notionReq(token, `/pages/${accountSourceId}`);
          const snapshotText=valueOf(sourcePage.properties?.['账号巡查快照']);
          if(snapshotText) await mirrorAccountBody(page,JSON.parse(snapshotText),token,cache);
          for (const platform of platforms) {
            const identity = valueOf(sourcePage.properties?.[platform+'账号']);
            if (identity) props[platform+'账号'] = text(identity);
          }
        }
      }
      const previous = cache[key]?.values ?? {};
      const writable = {};
      for (const [name,value] of Object.entries(props)) {
        const current = valueOf(page.properties?.[name]);
        const desired = valueOf(value);
        if (current===desired) continue;
        if (Object.hasOwn(previous,name) && current!==previous[name]) {
          deviceStats.conflicts.push({page:page.id,property:name,human_value:current,machine_value:desired});continue;
        }
        writable[name]=value;
      }
      if (Object.keys(writable).length) {
        await notionReq(token, `/pages/${page.id}`, 'PATCH', {properties:writable}); deviceStats.updated++;
      } else deviceStats.unchanged++;
      cache[key] = {values:Object.fromEntries(Object.entries(props).map(([k,v])=>[k,valueOf(v)]))};
    } catch(e) {deviceStats.errors.push({page:page.id,message:String(e.message).slice(0,200)});}
  }

  const stats = { devices:deviceStats, observed_at: new Date(now).toISOString(), mapped: rows.length, updated: 0, unchanged: 0, skipped: 0, errors: [], conflicts: [], groups: {} };
  for (const r of rows) {
    const account = r.t.payload?.qiumi_route?.device_hint?.account;
    const props = {
      '设备': { relation: devicePages.get(r.phone.serial) ? [{ id: devicePages.get(r.phone.serial) }] : [] },
      '派发状态': { select: { name: r.state } },
      '使用账号': text(account ? `${account.nickname ?? account.id ?? ''}（任务路由绑定，登录状态以执行核验为准）` : '待确认'),
      '排期说明': text(r.reasons.join(' ')),
      '队列顺序': { number: r.position },
      '下次调度时间': date(r.t.status === 'queued' && r.eligible ? r.t.payload?.next_run_at : null),
    };
    stats.groups[r.phone.nickname] ??= {};
    stats.groups[r.phone.nickname][r.state] = (stats.groups[r.phone.nickname][r.state] ?? 0) + 1;
    const fingerprint = digest(props);
    if (cache[r.page]?.fingerprint === fingerprint) { stats.unchanged++; continue; }
    try {
      const page = await notionReq(token, `/pages/${r.page}`);
      if (page.archived || page.in_trash) { stats.skipped++; continue; }
      const writable = { ...props };
      const previous = cache[r.page]?.values ?? {};
      // Preserve edits to display columns; log the displaced machine value instead of overwriting it.
      for (const [name, priorValue] of Object.entries(previous)) {
        // Authorized select-to-relation migration: the old cached nickname belonged to the renamed tag.
        if (name === '设备' && props[name]?.relation && !/^[0-9a-f]{32}(,|$)/i.test(priorValue ?? '')) continue;
        const humanValue = valueOf(page.properties?.[name]);
        if (humanValue !== priorValue && humanValue !== valueOf(props[name])) {
          delete writable[name];
          stats.conflicts.push({ task_id: r.t.id, page: r.page, property: name, human_value: humanValue, machine_value: valueOf(props[name]), actor: 'phone-task-view-mirror' });
        }
      }
      // This mirror only touches its newly added display columns. It preserves human task status/body/dates.
      await notionReq(token, `/pages/${r.page}`, 'PATCH', {
        properties: { ...writable, '排期更新时间': date(new Date(now).toISOString()) },
      });
      cache[r.page] = { fingerprint: stats.conflicts.some(c => c.page === r.page) ? null : fingerprint, values: Object.fromEntries(Object.entries(props).map(([k,v]) => [k, valueOf(v)])), task_id: r.t.id, at: new Date(now).toISOString() };
      stats.updated++;
    } catch (e) { stats.errors.push({ page: r.page, status: e.status ?? null, message: String(e.message).slice(0, 250) }); }
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache), { mode: 0o600 });
  console.log(JSON.stringify(stats));
  if (stats.errors.length || deviceStats.errors.length) process.exitCode = 1;
} finally { await pool.end(); }
