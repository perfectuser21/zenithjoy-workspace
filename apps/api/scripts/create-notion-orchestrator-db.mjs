#!/usr/bin/env node
// 一次性：在 AI Hub 根页下创建「发布编排台」database，预置全部 select options。
// 用法：NOTION_INTEGRATION_TOKEN=... node create-notion-orchestrator-db.mjs
// 输出 database id → 填进 staging env 的 NOTION_PUBLISH_ORCH_DB_ID。

const TOKEN = process.env.NOTION_INTEGRATION_TOKEN;
const PARENT_PAGE = process.env.NOTION_ORCH_PARENT_PAGE || 'ae1c40c2-ba63-82ef-a798-8177341c5305';
if (!TOKEN) { console.error('缺 NOTION_INTEGRATION_TOKEN'); process.exit(1); }

const PLATFORMS = ['douyin','xiaohongshu','kuaishou','toutiao','weibo','bilibili','shipinhao','zhihu','wechat'];
const STATUSES = ['草稿','发','排队中','已发','部分失败','派发失败'];

const resp = await fetch('https://api.notion.com/v1/databases', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${TOKEN}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    parent: { type: 'page_id', page_id: PARENT_PAGE },
    title: [{ type: 'text', text: { content: '发布编排台' } }],
    properties: {
      '标题': { title: {} },
      '文案': { rich_text: {} },
      '平台': { multi_select: { options: PLATFORMS.map((name) => ({ name })) } },
      '形态': { select: { options: [{ name: 'image' }, { name: 'video' }, { name: 'article' }] } },
      '状态': { select: { options: STATUSES.map((name) => ({ name })) } },
      '素材': { rich_text: {} },
      '预览': { url: {} },
      '回执': { rich_text: {} },
      'content_id': { rich_text: {} },
    },
  }),
});
const data = await resp.json();
if (!resp.ok) { console.error('建库失败:', resp.status, JSON.stringify(data)); process.exit(1); }
console.log('发布编排台已创建');
console.log('NOTION_PUBLISH_ORCH_DB_ID=' + data.id);
