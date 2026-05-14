#!/usr/bin/env node
/**
 * Notion sync on PR merge.
 *
 * 触发: GitHub Actions, PR closed + merged to main.
 * 行为:
 *   - 解析 PR body 里 `Notion-Sprint: <name>` 和 `Notion-Components: <a>, <b>` trailer
 *   - PATCH Sprint Registry 行: Status=done + PRs append `#<n> <url>`
 *   - PATCH Component Registry 行: Last Changed Sprint = <sprint name>
 * 铁律: 永远 exit 0。PR 已 merge, hook 不能阻塞。
 */

const SPRINT_DB = '35ec40c2-ba63-8113-9016-dd4acad35c5c';
const COMPONENT_DB = '35ec40c2-ba63-815a-b75b-deb3c45d717b';
const NOTION_VERSION = '2022-06-28';

const DRY_RUN = process.argv.includes('--dry-run');
const {
  NOTION_API_KEY,
  PR_NUMBER = '?',
  PR_TITLE = '',
  PR_BODY = '',
  PR_URL = '',
} = process.env;

function log(...args) { console.log('[notion-sync]', ...args); }
function warn(...args) { console.log('[notion-sync] WARN:', ...args); }

if (!NOTION_API_KEY) {
  warn('NOTION_API_KEY missing — skipping');
  process.exit(0);
}

async function notion(method, path, body) {
  const res = await fetch(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Notion ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function parseTrailers(body) {
  const sprintMatch = body.match(/^Notion-Sprint:\s*(.+?)\s*$/m);
  const compsMatch = body.match(/^Notion-Components:\s*(.+?)\s*$/m);
  return {
    sprint: sprintMatch ? sprintMatch[1].trim() : null,
    components: compsMatch
      ? compsMatch[1].split(',').map(s => s.trim()).filter(Boolean)
      : [],
  };
}

async function findPageByName(dbId, name) {
  const data = await notion('POST', `/databases/${dbId}/query`, {
    filter: { property: 'Name', title: { equals: name } },
    page_size: 5,
  });
  if (!data.results || data.results.length === 0) return null;
  if (data.results.length > 1) {
    warn(`name "${name}" matches ${data.results.length} rows in ${dbId}; taking first`);
  }
  return data.results[0];
}

function readRichText(prop) {
  if (!prop || !prop.rich_text) return '';
  return prop.rich_text.map(r => r.plain_text || '').join('');
}

async function patchSprintDone(page, prRef) {
  const existingPRs = readRichText(page.properties.PRs);
  const newPRs = existingPRs ? `${existingPRs}\n${prRef}` : prRef;
  const body = {
    properties: {
      Status: { select: { name: 'done' } },
      PRs: { rich_text: [{ type: 'text', text: { content: newPRs.slice(0, 2000) } }] },
    },
  };
  if (DRY_RUN) {
    log('DRY-RUN: would PATCH sprint', page.id, '→ Status=done, PRs:', JSON.stringify(newPRs));
    return;
  }
  await notion('PATCH', `/pages/${page.id}`, body);
  log('patched sprint', page.id, '→ Status=done, PRs appended', prRef);
}

async function patchComponentLastSprint(page, sprintName) {
  const body = {
    properties: {
      'Last Changed Sprint': { rich_text: [{ type: 'text', text: { content: sprintName } }] },
    },
  };
  if (DRY_RUN) {
    log('DRY-RUN: would PATCH component', page.id, '→ Last Changed Sprint=', sprintName);
    return;
  }
  await notion('PATCH', `/pages/${page.id}`, body);
  log('patched component', page.id, '→ Last Changed Sprint =', sprintName);
}

async function main() {
  log(`PR #${PR_NUMBER}: ${PR_TITLE}`);
  if (DRY_RUN) log('DRY-RUN mode');

  const { sprint, components } = parseTrailers(PR_BODY);

  if (!sprint) {
    log('no Notion-Sprint trailer in PR body — nothing to sync');
    return;
  }

  const prRef = `#${PR_NUMBER} ${PR_URL}`;

  // Sprint
  try {
    const sprintPage = await findPageByName(SPRINT_DB, sprint);
    if (!sprintPage) {
      warn(`sprint not found in Notion: "${sprint}" — leaving untouched`);
    } else {
      log('found sprint:', sprint, '→', sprintPage.id);
      await patchSprintDone(sprintPage, prRef);
    }
  } catch (e) {
    warn('sprint sync failed:', e.message);
  }

  // Components
  for (const comp of components) {
    try {
      const compPage = await findPageByName(COMPONENT_DB, comp);
      if (!compPage) {
        warn(`component not found: "${comp}" — leaving untouched`);
        continue;
      }
      log('found component:', comp, '→', compPage.id);
      await patchComponentLastSprint(compPage, sprint);
    } catch (e) {
      warn(`component "${comp}" sync failed:`, e.message);
    }
  }

  log('done');
}

main().catch(e => {
  warn('unexpected error:', e.message);
}).finally(() => process.exit(0));
