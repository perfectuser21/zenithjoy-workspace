#!/usr/bin/env node
// 一次性：建飞书 Bitable app「发布编排台」+ 表 + 预置 options + 管理员协作者。
// 用法：FEISHU_APP_ID=... FEISHU_APP_SECRET=... [ADMIN_FEISHU_OPENIDS=ou_x,ou_y] \
//        node create-feishu-orchestrator-table.mjs
// 输出 app_token/table_id → 填进 staging env 的 FEISHU_ORCH_APP_TOKEN / FEISHU_ORCH_TABLE_ID。
//
// 字段类型号（飞书 Bitable 官方枚举，写死不查表）：
//   文本=1  单选=3（options 走 property.options）  多选=4（options 走 property.options）  超链接=15

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const FEISHU_BASE = process.env.FEISHU_API_BASE || 'https://open.feishu.cn';
const ADMIN_OPENIDS = (process.env.ADMIN_FEISHU_OPENIDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!APP_ID || !APP_SECRET) {
  console.error('缺 FEISHU_APP_ID / FEISHU_APP_SECRET');
  process.exit(1);
}

// 与 Notion 版 create-notion-orchestrator-db.mjs 同源（镜像对象），值集须保持一致
const PLATFORMS = [
  'douyin', 'xiaohongshu', 'kuaishou', 'toutiao', 'weibo',
  'bilibili', 'shipinhao', 'zhihu', 'wechat',
];
const STATUSES = ['草稿', '发', '排队中', '已发', '部分失败', '派发失败'];
const FORMS = ['image', 'video', 'article'];

async function getTenantToken() {
  const resp = await fetch(`${FEISHU_BASE}/open-apis/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0 || !data.tenant_access_token) {
    console.error('获取 token 失败:', resp.status, JSON.stringify(data));
    process.exit(1);
  }
  return data.tenant_access_token;
}

async function createApp(token) {
  const resp = await fetch(`${FEISHU_BASE}/open-apis/bitable/v1/apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '发布编排台' }),
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0 || !data.data?.app?.app_token) {
    console.error('建 app 失败:', resp.status, JSON.stringify(data));
    process.exit(1);
  }
  return data.data.app.app_token;
}

async function createTable(token, appToken) {
  const fields = [
    { field_name: '标题', type: 1 },
    { field_name: '文案', type: 1 },
    { field_name: '素材', type: 1 },
    { field_name: '回执', type: 1 },
    { field_name: 'content_id', type: 1 },
    { field_name: '状态', type: 3, property: { options: STATUSES.map((name) => ({ name })) } },
    { field_name: '形态', type: 3, property: { options: FORMS.map((name) => ({ name })) } },
    { field_name: '平台', type: 4, property: { options: PLATFORMS.map((name) => ({ name })) } },
    { field_name: '预览', type: 15 },
  ];
  const resp = await fetch(`${FEISHU_BASE}/open-apis/bitable/v1/apps/${appToken}/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      table: { name: '发布编排台', default_view_name: '默认视图', fields },
    }),
  });
  const data = await resp.json();
  if (!resp.ok || data.code !== 0 || !data.data?.table_id) {
    console.error('建表失败:', resp.status, JSON.stringify(data));
    process.exit(1);
  }
  return data.data.table_id;
}

async function addCollaborator(token, appToken, openId) {
  const resp = await fetch(
    `${FEISHU_BASE}/open-apis/drive/v1/permissions/${appToken}/members?type=bitable`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_type: 'openid', member_id: openId, perm: 'full_access' }),
    }
  );
  const data = await resp.json();
  if (!resp.ok || data.code !== 0) {
    // 单个协作者加失败不阻断整体建表流程（主理人可事后手动加）
    console.error(`协作者 ${openId} 添加失败(忽略继续):`, resp.status, JSON.stringify(data));
    return;
  }
  console.log(`协作者 ${openId} 已加 full_access`);
}

const token = await getTenantToken();
const appToken = await createApp(token);
const tableId = await createTable(token, appToken);

for (const openId of ADMIN_OPENIDS) {
  await addCollaborator(token, appToken, openId);
}
if (ADMIN_OPENIDS.length === 0) {
  console.warn('ADMIN_FEISHU_OPENIDS 未配置，跳过协作者添加（主理人需手动加自己为协作者才能在飞书里看到这张表）');
}

console.log('发布编排台已创建');
console.log('FEISHU_ORCH_APP_TOKEN=' + appToken);
console.log('FEISHU_ORCH_TABLE_ID=' + tableId);
