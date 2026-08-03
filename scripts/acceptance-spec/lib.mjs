/**
 * lib.mjs — Line02 安卓验收规程 SSOT 核心库
 *
 * 导出：
 *   loadAndValidateSpec()   — 读取并校验 acceptance-spec/line02-android.yaml
 *   validateSchema(input)   — 底层 schema 校验（接受对象）
 *   renderHtml(spec)        — 从校验通过的 spec 生成员工验收网页完整 HTML
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml, YAMLParseError } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

const SCHEMA_PATH = resolve(REPO_ROOT, 'acceptance-spec/line02-android.schema.json');
const YAML_PATH = resolve(REPO_ROOT, 'acceptance-spec/line02-android.yaml');

// 每次调用建独立 Ajv 实例再编译：避免多测试并发共享同一实例时，
// 对同一 $id 重复 compile() 触发 "schema already exists"（2026-08-03 实测竞态）。
function getValidate() {
  // strictRequired:false — anyOf 分支各自只 required 一个属性（na 或 t），
  // strict 模式默认要求 required 引用的属性也在同一子 schema 的 properties 里
  // 显式声明，这里属性定义在父级 cell.properties，故关闭这一项严格检查。
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  addFormats(ajv);
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  return ajv.compile(schema);
}

/**
 * 底层 schema 校验：接受任意对象，返回 { errors }
 * errors 为空数组表示通过。
 */
export function validateSchema(input) {
  const validate = getValidate();
  const valid = validate(input);
  if (valid) {
    return { errors: [] };
  }
  const errors = (validate.errors || []).map(e => {
    const path = e.instancePath || '/';
    const params = e.params ? ` (${JSON.stringify(e.params)})` : '';
    return `Schema error at ${path}: ${e.message}${params}`;
  });
  return { errors };
}

/**
 * 读取 acceptance-spec/line02-android.yaml，schema 校验，返回 { spec, errors }
 * 通过时 spec 为解析后的对象，errors 为 []
 * 失败时 spec 为 null，errors 非空
 */
export async function loadAndValidateSpec() {
  const raw = readFileSync(YAML_PATH, 'utf8');
  let parsed;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    if (e instanceof YAMLParseError) {
      const line = e.linePos?.[0]?.line ?? '?';
      return { spec: null, errors: [`FAIL: YAML syntax error at line ${line}: ${e.message}`] };
    }
    throw e;
  }
  const { errors } = validateSchema(parsed);
  if (errors.length > 0) {
    return { spec: null, errors };
  }
  return { spec: parsed, errors: [] };
}

// ─── HTML 模板（除 STEPS 数据外，与手工版逐字节保持一致）──────────────────────

const KNOWN = '（已知问题）';

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/** spec.steps（cells:{c1,c2,c3,c4} 嵌套）→ 客户端 STEPS 数组（c1..c4 直接挂在 step 上，沿用既有前端渲染逻辑）*/
function toClientSteps(spec) {
  return spec.steps.map(st => {
    const flat = { n: st.n, name: st.name, op: st.op, ev: st.ev || [] };
    if (st.fixedNa) flat.fixedNa = true;
    for (const ck of ['c1', 'c2', 'c3', 'c4']) {
      const cell = st.cells[ck];
      const out = {};
      if (cell.na) out.na = true;
      if (cell.t) out.t = cell.t;
      if (cell.hard) out.hard = true;
      if (cell.fails && cell.fails.length) out.fails = cell.fails;
      flat[ck] = out;
    }
    return flat;
  });
}

export function renderHtml(spec) {
  const clientSteps = toClientSteps(spec);
  const stepsJson = JSON.stringify(clientSteps);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>安卓智能获客 · 员工真机验收表</title>
<style>html,body{margin:0}</style></head><body>
<style>
  :root{
    --bg:#f7f8fa; --panel:#ffffff; --ink:#1a2230; --ink-soft:#5a6472;
    --line:#dde2ea; --line-strong:#c3cad6;
    --accent:#2b6cb0; --accent-soft:#e8f0f9;
    --pass:#2f9e6e; --pass-soft:#e6f4ee;
    --fail:#d64545; --fail-soft:#fbe9e9;
    --warn:#946f1f; --warn-soft:#fbf1dd;
    --ni:#7a8494; --ni-soft:#eceff2;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --sans:"PingFang SC","Hiragino Sans GB",system-ui,-apple-system,"Segoe UI",sans-serif;
  }
  @media (prefers-color-scheme:dark){
    :root{ --bg:#0e1420; --panel:#161d2b; --ink:#e6ebf3; --ink-soft:#9aa7ba;
      --line:#2a3444; --line-strong:#3a4658; --accent:#5b9bd8; --accent-soft:#17263a;
      --pass:#48c493; --pass-soft:#13271f; --fail:#e97b7b; --fail-soft:#2a1717;
      --warn:#d9a441; --warn-soft:#2a2113; --ni:#93a0b3; --ni-soft:#1c222c; }
  }
  :root[data-theme="dark"]{ --bg:#0e1420; --panel:#161d2b; --ink:#e6ebf3; --ink-soft:#9aa7ba;
      --line:#2a3444; --line-strong:#3a4658; --accent:#5b9bd8; --accent-soft:#17263a;
      --pass:#48c493; --pass-soft:#13271f; --fail:#e97b7b; --fail-soft:#2a1717;
      --warn:#d9a441; --warn-soft:#2a2113; --ni:#93a0b3; --ni-soft:#1c222c; }
  :root[data-theme="light"]{ --bg:#f7f8fa; --panel:#ffffff; --ink:#1a2230; --ink-soft:#5a6472;
      --line:#dde2ea; --line-strong:#c3cad6; --accent:#2b6cb0; --accent-soft:#e8f0f9;
      --pass:#2f9e6e; --pass-soft:#e6f4ee; --fail:#d64545; --fail-soft:#fbe9e9;
      --warn:#946f1f; --warn-soft:#fbf1dd; --ni:#7a8494; --ni-soft:#eceff2; }

  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.6}
  .wrap{max-width:1360px;margin:0 auto;padding:0 20px}

  header{padding:26px 0 18px;border-bottom:2px solid var(--line-strong)}
  h1{font-size:23px;margin:0 0 8px;font-weight:800}
  .sub{color:var(--ink-soft);font-size:14.5px;margin:0 0 12px;max-width:96ch}
  .pills{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .pill{font-size:13px;background:var(--accent-soft);color:var(--accent);border-radius:6px;padding:4px 10px;font-weight:600}
  .rulebox{background:var(--fail-soft);border:1px solid var(--fail);border-radius:8px;padding:12px 14px;font-size:13.5px;margin-top:10px}
  .rulebox b{color:var(--fail)}
  .rulebox ul{margin:6px 0 0;padding-left:1.3em}
  .rulebox li{margin:3px 0}
  .knownbox{background:var(--warn-soft);border:1px solid var(--warn);border-radius:8px;padding:12px 14px;font-size:13.5px;margin-top:8px}
  .knownbox b{color:var(--warn)}

  #bar{position:sticky;top:0;z-index:30;background:var(--panel);border-bottom:1px solid var(--line-strong);padding:9px 0}
  #bar .wrap{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
  #bar .counts{font-size:13px;display:flex;gap:7px;flex-wrap:wrap}
  #bar .c{padding:3px 9px;border-radius:5px;font-weight:700}
  #bar .c.pass{background:var(--pass-soft);color:var(--pass)}
  #bar .c.fail{background:var(--fail-soft);color:var(--fail)}
  #bar .c.pend{background:var(--line);color:var(--ink-soft)}
  #bar .c.ni{background:var(--ni-soft);color:var(--ni)}
  #bar .nextTip{font-size:13.5px;font-weight:700;color:var(--accent);cursor:pointer;
    background:var(--accent-soft);border-radius:6px;padding:5px 11px;border:1px solid transparent}
  #bar .nextTip:hover{border-color:var(--accent)}
  #bar .spacer{flex:1}
  .btn{font-size:13px;font-weight:600;border:1px solid var(--line-strong);background:var(--panel);
    color:var(--ink);border-radius:6px;padding:6px 12px;cursor:pointer;font-family:var(--sans)}
  .btn:hover{border-color:var(--accent);color:var(--accent)}
  .btn.primary{background:var(--accent);color:#fff;border-color:var(--accent)}

  .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:12.5px;color:var(--ink-soft);margin:14px 0 4px;
    background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:10px 14px}
  .legend b{color:var(--ink)}
  .legend .li{display:inline-flex;align-items:center;gap:6px}
  .ldot{width:10px;height:10px;border-radius:50%;display:inline-block}
  .ldot.g{background:var(--pass)} .ldot.r{background:var(--fail)} .ldot.p{background:var(--ni-soft);border:1.5px solid var(--line-strong)}

  .tbl-scroll{overflow-x:auto;margin:14px 0;border:1px solid var(--line-strong);border-radius:8px}
  table{border-collapse:collapse;width:100%;min-width:1280px;background:var(--panel)}
  thead th{background:var(--accent-soft);color:var(--ink);font-size:13px;font-weight:700;text-align:left;
    padding:9px 11px;border-bottom:2px solid var(--line-strong);border-right:1px solid var(--line)}
  thead th .th-sub{display:block;font-size:11px;font-weight:500;color:var(--ink-soft)}
  tbody td{padding:9px 10px;border-bottom:1px solid var(--line);border-right:1px solid var(--line);
    vertical-align:top;font-size:13px}
  tbody tr.cur{background:var(--accent-soft) !important;transition:background .3s}
  tbody tr:nth-child(even):not(.cur){background:color-mix(in srgb, var(--panel) 96%, var(--ink) 4%)}
  td.stepcol{width:66px;text-align:center;vertical-align:middle}
  .dot{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;
    font-weight:800;font-size:14px;background:var(--ni-soft);color:var(--ink-soft)}
  .dot.ok{background:var(--pass);color:#fff}
  .dot.no{background:var(--fail);color:#fff}
  .dot.na{background:var(--ni);color:#fff}
  td.opcol{width:200px}
  td.opcol .stname{font-weight:700;margin-bottom:3px}
  td.opcol .stop{font-size:12.5px;color:var(--ink-soft)}
  td.ck{min-width:200px}
  td.ck .crit{font-size:12.3px;color:var(--ink);margin-bottom:6px;line-height:1.5}
  td.ck .crit.na-text{color:var(--ink-soft)}
  td.ck .crit .hard{color:var(--fail);font-weight:600}
  .tri{display:flex;gap:4px;flex-wrap:wrap}
  .tbtn{font-size:11.5px;font-weight:700;border-radius:5px;padding:3px 8px;cursor:pointer;
    border:1.3px solid var(--line-strong);background:var(--bg);color:var(--ink-soft);font-family:var(--sans)}
  .tbtn[data-v="ok"].active{background:var(--pass);border-color:var(--pass);color:#fff}
  .tbtn[data-v="no"].active{background:var(--fail);border-color:var(--fail);color:#fff}
  .tbtn[data-v="na"].active{background:var(--ni);border-color:var(--ni);color:#fff}

  .failbox{display:none;margin-top:7px;background:var(--fail-soft);border:1px dashed var(--fail);
    border-radius:7px;padding:7px 8px}
  .failbox.open{display:block}
  .failbox .fb-t{font-size:11px;font-weight:700;color:var(--fail);margin-bottom:5px}
  .fchip{display:inline-block;font-size:11px;border:1px solid var(--line-strong);background:var(--panel);
    color:var(--ink);border-radius:5px;padding:2px 8px;margin:0 4px 4px 0;cursor:pointer;font-family:var(--sans)}
  .fchip.sel{background:var(--fail);border-color:var(--fail);color:#fff}
  .fchip .kn{font-size:10px;opacity:.75}
  .fother{width:100%;font-size:11.5px;border:1px solid var(--line);border-radius:5px;padding:3px 6px;
    background:var(--panel);color:var(--ink);font-family:var(--sans);margin-top:2px}

  td.cmt{min-width:180px}
  .comment-in{width:100%;font-family:var(--sans);font-size:12.5px;border:1px solid var(--line);
    border-radius:5px;padding:5px 7px;background:var(--bg);color:var(--ink);min-height:48px;resize:vertical}
  .evchips{margin-top:5px}
  .evchip{display:inline-block;font-size:10.5px;border:1px solid var(--line);background:var(--accent-soft);
    color:var(--accent);border-radius:5px;padding:1px 7px;margin:0 4px 3px 0;cursor:pointer;font-family:var(--sans)}
  .evchip:hover{border-color:var(--accent)}
  .fixed-na{font-size:12px;font-weight:700;background:var(--ni-soft);color:var(--ni);padding:4px 9px;border-radius:5px;display:inline-block}

  details{border:1px solid var(--line);border-radius:8px;margin:14px 0;background:var(--panel)}
  details>summary{cursor:pointer;padding:11px 14px;font-weight:700;font-size:14px;list-style:none}
  details>summary::-webkit-details-marker{display:none}
  details>summary::before{content:"▸ ";color:var(--accent)}
  details[open]>summary::before{content:"▾ "}
  .details-body{padding:0 16px 16px;font-size:13.5px;color:var(--ink-soft)}
  .details-body table{width:100%;font-size:13px;min-width:0}
  .details-body td,.details-body th{padding:6px 9px;border:1px solid var(--line)}
  .details-body th{background:var(--accent-soft);color:var(--ink)}

  .cover{display:grid;grid-template-columns:repeat(4,1fr);gap:9px 14px;margin:14px 0}
  @media(max-width:900px){.cover{grid-template-columns:repeat(2,1fr)}}
  .cover .f{display:flex;flex-direction:column;gap:3px}
  .cover label{font-size:12px;color:var(--ink-soft);font-weight:600}
  .cover input{font-size:13.5px;padding:6px 8px;border:1px solid var(--line);border-radius:5px;background:var(--panel);color:var(--ink);font-family:var(--sans)}

  #reportOut{width:100%;min-height:220px;font-family:var(--mono);font-size:12px;line-height:1.55;
    border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--bg);color:var(--ink);white-space:pre-wrap;margin-top:10px}

  footer{padding:24px 0 50px;font-size:12.5px;color:var(--ink-soft)}
  code{font-family:var(--mono);font-size:.88em;background:var(--accent-soft);color:var(--accent);padding:.05em .35em;border-radius:4px}
</style>

<header><div class="wrap">
  <h1>安卓智能获客 · 员工真机验收表</h1>
  <p class="sub">一行是一步，共 14 步。每步分四格检查：<b>①功能对不对 ②时限与频控 ③环境与数据 ④红线踩没踩</b>，四格各自判定，步骤红绿灯自动汇总。<b>判「不通过」时不用写作文</b>——会弹出这一格的常见情况选择题，点选看到的现象即可；只有清单里没有的情况才需要在「其他」里写一句。某格本来没要求的已预标「不适用」。</p>
  <div class="pills">
    <span class="pill">当前测试版本：${esc(spec.version)}</span>
    <span class="pill">测试环境：${esc(spec.environment)}</span>
  </div>
  <div class="rulebox">
    <b>开工前必读的红线，违反任何一条，该步作废重做：</b>
    <ul>
      <li>真实发送/关注/点赞只能在预发环境做；生产环境只能看，不能做任何动作</li>
      <li>只能用公司自己的测试账号；不能让人替手机点抖音，一旦人工接管，该步从头重做</li>
      <li>每一轮换一句新的暗号话术，不能拿旧截图充当证据。格式：<code>【暗号-年月日-时分-姓名缩写】这是一条智能获客验收消息，请勿回复。</code></li>
      <li>截图录屏不能裁掉时间、账号、暗号；授权码之类要打码。遇到「受阻做不下去」，把原因写进该步备注，格子先不判</li>
    </ul>
  </div>
  <div class="knownbox">
    <b>已知问题（选择题里带「已知」标记的就是），遇到照实点选即可，不用重新排查：</b>
    第14步这个版本没做，整行固定「不适用」；某款华为测试机采集失败报笼统错误；安装包下载偶发失败。
  </div>
</div></header>

<div id="bar"><div class="wrap">
  <div class="counts">
    <span class="c pass">步骤全绿 <span id="c-OK">0</span></span>
    <span class="c fail">有问题 <span id="c-NO">0</span></span>
    <span class="c pend">未完成 <span id="c-PEND">13</span></span>
    <span class="c ni">固定不适用 1</span>
  </div>
  <div class="nextTip" id="nextTip">下一步：第1步</div>
  <div class="spacer"></div>
  <button class="btn" id="btnReset">换一轮（清空重来）</button>
  <button class="btn primary" id="btnReport">生成结论文字</button>
</div></div>

<div class="wrap">

<details><summary>验收单信息（先填这些，方便对照）</summary>
  <div class="details-body">
    <div class="cover" id="coverFields">
      <div class="f"><label>测试日期</label><input type="date" data-f="date"></div>
      <div class="f"><label>测试人</label><input type="text" data-f="tester"></div>
      <div class="f"><label>复核人</label><input type="text" data-f="reviewer"></div>
      <div class="f"><label>手机型号 / 系统版本</label><input type="text" data-f="phone"></div>
      <div class="f"><label>客户端编号</label><input type="text" data-f="agentid" placeholder="客户端状态页里能看到"></div>
      <div class="f"><label>测试用客户账号</label><input type="text" data-f="tenant"></div>
      <div class="f"><label>本轮采集任务编号</label><input type="text" data-f="taskid"></div>
      <div class="f"><label>本轮暗号话术</label><input type="text" data-f="watermark" placeholder="【暗号-年月日-时分-缩写】…"></div>
    </div>
  </div>
</details>

<div class="legend">
  <span class="li"><b>每格三选一：</b>通过 / 不通过 / 不适用</span>
  <span class="li"><span class="ldot g"></span>步骤圆点绿 = 四格判完且无不通过</span>
  <span class="li"><span class="ldot r"></span>红 = 任何一格不通过</span>
  <span class="li"><span class="ldot p"></span>灰 = 还有格子没判</span>
  <span class="li"><b>备注栏下的蓝色小标签：</b>点一下自动填入证据文件名，不用打字</span>
</div>

<div class="tbl-scroll">
<table>
<thead><tr>
  <th style="width:66px">第几步</th>
  <th style="width:200px">这一步做什么</th>
  <th style="min-width:200px">① 功能对不对<span class="th-sub">这一步该做到的事做到了吗</span></th>
  <th style="min-width:200px">② 时限与频控<span class="th-sub">速度、次数限制守住了吗</span></th>
  <th style="min-width:200px">③ 环境与数据<span class="th-sub">环境没串、数据是本轮的吗</span></th>
  <th style="min-width:200px">④ 红线踩没踩<span class="th-sub">绝对禁止的事发生了吗</span></th>
  <th style="min-width:180px">备注 / 证据文件名</th>
</tr></thead>
<tbody id="tbody"></tbody>
</table>
</div>

<details><summary>红线全文（表格里"红线"格标的编号，这里查完整定义）</summary>
  <div class="details-body">
    <table>
      <tr><th style="width:64px">编号</th><th>内容</th></tr>
      <tr><td>红线1</td><td>环境不能串，一切以客户端里实际显示的地址为准，不能靠猜</td></tr>
      <tr><td>红线2</td><td>客户账号、任务、线索、派单必须是同一条真实链，不能中间换掉</td></tr>
      <tr><td>红线3</td><td>任务不能读取、修改或碰到其他客户的数据</td></tr>
      <tr><td>红线4</td><td>视频编号必须是抖音真实编号，不能是随手生成的假编号</td></tr>
      <tr><td>红线5</td><td>目标账号必须精确匹配，进主页核对不上必须立刻停止，不能继续发</td></tr>
      <tr><td>红线6</td><td>点了发送不算成功；没看到提交回执、收信端没确认收到，不能算发出去</td></tr>
      <tr><td>红线7</td><td>同一条暗号话术不能重复发送，出现重复消息立刻算不通过</td></tr>
      <tr><td>红线8</td><td>「被频控限制了」不能同时显示成「已经私信过了」</td></tr>
      <tr><td>红线9</td><td>账号或小号掉线、登录过期时，不能强行给它派任务</td></tr>
      <tr><td>红线10</td><td>一个小号出问题，不能连带停用同一台手机上其它正常小号</td></tr>
      <tr><td>红线11</td><td>旧的扫描结果或旧评论数据，不能覆盖更新的数据</td></tr>
      <tr><td>红线12</td><td>人工帮手机操作过的结果，不能当成程序自动完成的证据</td></tr>
      <tr><td>红线13</td><td>员工手工去公开评论区回复，也不能把第14步改判成通过</td></tr>
      <tr><td>红线14</td><td>生产环境不能产生任何新的采集、关注、点赞、回评、私信或线索数据</td></tr>
    </table>
    <p style="margin-top:10px">任何一条红线被踩，这一轮整体立刻判不通过，不能用其它步骤全绿来抵消。</p>
  </div>
</details>

<details><summary>补充检查（不算在14步里，每轮建议也做一遍）</summary>
  <div class="details-body">
    <table>
      <tr><th style="width:150px">检查项</th><th>怎么做 / 怎么算通过</th></tr>
      <tr><td>断网重启后能不能恢复</td><td>挑一个场景（断网 / 客户端重启 / 登录过期）触发后观察：期间不能真的发生任何发送/关注/点赞；恢复后状态与手机实际一致，后台不能误显示「可用」。证据：断网重启恢复过程录屏</td></tr>
      <tr><td>生产环境只看不动</td><td>切到生产环境只看状态页（版本、地址、注册、在线），<span style="color:var(--fail);font-weight:600">严禁发起任何真实动作</span>（红线14）。证据：生产环境状态页截图</td></tr>
    </table>
  </div>
</details>

<details><summary>怎么留证据（每步备注栏点蓝色标签自动填文件名）</summary>
  <div class="details-body">
    每轮建一个文件夹，名字「日期时间_测试人_手机型号」，按顺序存：
    <table>
      <tr><th>存什么</th><th>对应第几步</th></tr>
      <tr><td>客户端状态页截图</td><td>第1、2、3、4步 + 生产环境检查</td></tr>
      <tr><td>账号扫描结果截图</td><td>第5步</td></tr>
      <tr><td>采集开始的录屏</td><td>第6、7步</td></tr>
      <tr><td>视频和判定结果截图</td><td>第8、9步</td></tr>
      <tr><td>线索截图</td><td>第10步</td></tr>
      <tr><td>私信执行全程录屏（从抖音首页开始，连续不剪辑）</td><td>第11、12步</td></tr>
      <tr><td>发送端截图 / 收信端截图</td><td>第12、13步</td></tr>
      <tr><td>问题记录（选择题点选的现象会自动进结论，补充细节写这里）</td><td>所有判了不通过的格子</td></tr>
    </table>
    <p style="margin-top:10px">问题严重程度四档：<b>最严重</b>＝串环境/串客户/发错人/重复发送/生产环境写入；<b>严重</b>＝流程断了或假装成功；<b>一般</b>＝能恢复的失败或状态误导；<b>轻微</b>＝提示文字不清楚。最严重和严重一旦出现，本轮立刻停，保留现场证据找负责人。</p>
  </div>
</details>

<div style="margin:18px 0">
  <strong>最终结论怎么算（固定规则，不能人工改）：</strong>
  第1步到第13步全部亮绿灯，才算这条获客链路真正打通。第14步这个版本没做，固定不适用，所以完整功能验收目前必然「不通过」，只能报「前13步全部打通」。
  <textarea id="reportOut" readonly placeholder="点右上角「生成结论文字」…"></textarea>
</div>

</div>

<footer><div class="wrap">
  结构对齐 0715 四级下钻账本原型：步骤 × 要素逐格打分；不通过走「症状选择题」，对齐专业测试用例执行规范（预期结果内联 + 结构化缺陷记录）。机器托管的七项（不变量、保质期、死亡告警、失败语义、效果确认、输入对抗、账本保鲜）由系统侧另行验证，不在本表。判据来源：仓库里一份唯一的验收规程文件（改判据只改那一份，不再改这个网页），本页由脚本自动生成，请勿手工编辑。当前测试版本：${esc(spec.version)}。勾选只存在你自己的浏览器里，正式证据按上面规范整理外发。
</div></footer>

<script>
(function(){
  var CKEYS = ['c1','c2','c3','c4'];
  var NA_TEXT = '本步无此项要求';
  var STEPS = ${stepsJson};

  var KEY = 'p2sop-grid-v5';
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}'); }catch(e){ return {}; } }
  function save(){ localStorage.setItem(KEY, JSON.stringify(state)); }
  var state = load();
  if(!state.rows) state.rows = {};
  if(!state.cover) state.cover = {};

  function row(n){ state.rows[n] = state.rows[n] || {}; return state.rows[n]; }
  function getCell(n, ck){
    var st = STEPS[n-1];
    if(st.fixedNa) return 'na';
    var r = state.rows[n] || {};
    if(r[ck] !== undefined && r[ck] !== '') return r[ck];
    if(st[ck] && st[ck].na) return 'na';
    return '';
  }
  function getSyms(n, ck){
    var r = state.rows[n] || {};
    return (r['sym_'+ck] || []);
  }
  function stepAgg(n){
    var st = STEPS[n-1];
    if(st.fixedNa) return 'na';
    var anyNo=false, anyPend=false;
    CKEYS.forEach(function(ck){
      var v = getCell(n, ck);
      if(v==='no') anyNo=true;
      if(v==='') anyPend=true;
    });
    if(anyNo) return 'no';
    if(anyPend) return 'pend';
    return 'ok';
  }

  var STATE_LABEL = {ok:'通过', no:'不通过', na:'不适用', '':'未判'};
  var CK_LABEL = {c1:'功能', c2:'时限频控', c3:'环境数据', c4:'红线'};

  function cellHtml(st, ck){
    var cfg = st[ck] || {};
    var critText = cfg.t || NA_TEXT;
    var critCls = cfg.t ? '' : ' na-text';
    var crit = cfg.hard ? '<span class="hard">'+critText+'</span>' : critText;
    if(st.fixedNa && ck==='c1'){
      return '<div class="crit">'+crit+'</div><span class="fixed-na">固定：不适用</span>';
    }
    if(st.fixedNa){
      return '<div class="crit na-text">'+NA_TEXT+'</div>';
    }
    var btns = ['ok','no','na'].map(function(v){
      var label = v==='ok'?'通过':(v==='no'?'不通过':'不适用');
      return '<button type="button" class="tbtn" data-step="'+st.n+'" data-ck="'+ck+'" data-v="'+v+'">'+label+'</button>';
    }).join('');
    var fb = '';
    if(cfg.fails && cfg.fails.length){
      var chips = cfg.fails.map(function(f,i){
        return '<button type="button" class="fchip" data-step="'+st.n+'" data-ck="'+ck+'" data-i="'+i+'">'+f+'</button>';
      }).join('');
      fb = '<div class="failbox" id="fb-'+st.n+'-'+ck+'">'+
        '<div class="fb-t">看到的是哪种情况？（可多选）</div>'+chips+
        '<input type="text" class="fother" data-step="'+st.n+'" data-ck="'+ck+'" placeholder="清单里没有？写一句其他情况">'+
        '</div>';
    }
    return '<div class="crit'+critCls+'">'+crit+'</div><div class="tri">'+btns+'</div>'+fb;
  }

  var tbody = document.getElementById('tbody');
  tbody.innerHTML = STEPS.map(function(st){
    var cells = CKEYS.map(function(ck){ return '<td class="ck">'+cellHtml(st, ck)+'</td>'; }).join('');
    var evc = (st.ev||[]).map(function(e){
      return '<button type="button" class="evchip" data-step="'+st.n+'" data-ev="'+e+'">＋'+e+'</button>';
    }).join('');
    var cmt = st.fixedNa ? '<td class="cmt"></td>'
      : '<td class="cmt"><textarea class="comment-in" data-step="'+st.n+'" placeholder="补充细节 / 受阻原因（选填）"></textarea>'+
        (evc?'<div class="evchips">'+evc+'</div>':'')+'</td>';
    return '<tr data-step="'+st.n+'">'+
      '<td class="stepcol"><span class="dot" id="dot-'+st.n+'">'+st.n+'</span></td>'+
      '<td class="opcol"><div class="stname">'+st.name+'</div><div class="stop">'+st.op+'</div></td>'+
      cells + cmt + '</tr>';
  }).join('');

  tbody.addEventListener('click', function(e){
    var b = e.target.closest('.tbtn');
    if(b){
      var n = b.getAttribute('data-step'), ck = b.getAttribute('data-ck'), v = b.getAttribute('data-v');
      row(n)[ck] = (getCell(+n, ck) === v) ? '' : v;
      save(); render(); return;
    }
    var f = e.target.closest('.fchip');
    if(f){
      var n2 = f.getAttribute('data-step'), ck2 = f.getAttribute('data-ck'), i = +f.getAttribute('data-i');
      var key = 'sym_'+ck2;
      var arr = row(n2)[key] || [];
      var pos = arr.indexOf(i);
      if(pos>=0) arr.splice(pos,1); else arr.push(i);
      row(n2)[key] = arr;
      save(); render(); return;
    }
    var ev = e.target.closest('.evchip');
    if(ev){
      var n3 = ev.getAttribute('data-step'), name = ev.getAttribute('data-ev');
      var ta = document.querySelector('.comment-in[data-step="'+n3+'"]');
      if(ta){
        ta.value = ta.value ? (ta.value.indexOf(name)>=0 ? ta.value : ta.value+'；'+name) : name;
        row(n3).cmt = ta.value;
        save();
      }
      return;
    }
  });
  tbody.querySelectorAll('.comment-in').forEach(function(ta){
    var n = ta.getAttribute('data-step');
    ta.value = (state.rows[n] && state.rows[n].cmt) || '';
    ta.addEventListener('input', function(){ row(n).cmt = ta.value; save(); });
  });
  tbody.querySelectorAll('.fother').forEach(function(inp){
    var n = inp.getAttribute('data-step'), ck = inp.getAttribute('data-ck');
    inp.value = (state.rows[n] && state.rows[n]['oth_'+ck]) || '';
    inp.addEventListener('input', function(){ row(n)['oth_'+ck] = inp.value; save(); });
  });
  document.querySelectorAll('#coverFields input').forEach(function(inp){
    var k = inp.getAttribute('data-f');
    inp.value = state.cover[k] || '';
    inp.addEventListener('input', function(){ state.cover[k] = inp.value; save(); });
  });

  function render(){
    var ok=0, no=0, pend=0, firstPend=null;
    STEPS.forEach(function(st){
      var n = st.n;
      CKEYS.forEach(function(ck){
        var v = getCell(n, ck);
        document.querySelectorAll('.tbtn[data-step="'+n+'"][data-ck="'+ck+'"]').forEach(function(b){
          b.classList.toggle('active', v === b.getAttribute('data-v'));
        });
        var fb = document.getElementById('fb-'+n+'-'+ck);
        if(fb){
          fb.classList.toggle('open', v==='no');
          var syms = getSyms(n, ck);
          fb.querySelectorAll('.fchip').forEach(function(c){
            c.classList.toggle('sel', syms.indexOf(+c.getAttribute('data-i'))>=0);
          });
        }
      });
      var agg = stepAgg(n);
      var dot = document.getElementById('dot-'+n);
      dot.className = 'dot' + (agg==='ok'?' ok':agg==='no'?' no':agg==='na'?' na':'');
      if(st.fixedNa) return;
      if(agg==='ok') ok++;
      else if(agg==='no') no++;
      else { pend++; if(firstPend===null) firstPend=n; }
    });
    document.getElementById('c-OK').textContent = ok;
    document.getElementById('c-NO').textContent = no;
    document.getElementById('c-PEND').textContent = pend;
    var tip = document.getElementById('nextTip');
    if(firstPend===null){
      tip.textContent = no>0 ? '13步都判完了，有'+no+'步不通过，可以生成结论' : '13步全部绿灯，可以生成结论了';
    } else {
      tip.textContent = '下一步：第'+firstPend+'步 — '+STEPS[firstPend-1].name+'（点这里跳过去）';
    }
    tip.onclick = function(){
      var target = firstPend || 1;
      var tr = document.querySelector('tr[data-step="'+target+'"]');
      if(!tr) return;
      tr.scrollIntoView({behavior:'smooth', block:'center'});
      tr.classList.add('cur');
      setTimeout(function(){ tr.classList.remove('cur'); }, 1600);
    };
  }
  render();

  document.getElementById('btnReset').addEventListener('click', function(){
    if(!confirm('清空本页所有打勾和填写内容，开始新一轮？')) return;
    localStorage.removeItem(KEY); location.reload();
  });

  document.getElementById('btnReport').addEventListener('click', function(){
    var c = state.cover;
    var NL = String.fromCharCode(10);
    var lines = [];
    lines.push('安卓智能获客验收结论（按步×四格明细） — ' + new Date().toISOString());
    lines.push('测试人：'+(c.tester||'—')+'　复核人：'+(c.reviewer||'—')+'　机型：'+(c.phone||'—'));
    lines.push('客户端编号：'+(c.agentid||'—')+'　测试账号：'+(c.tenant||'—')+'　任务编号：'+(c.taskid||'—'));
    lines.push('');
    var chainPass = true;
    STEPS.forEach(function(st){
      var n = st.n;
      var agg = stepAgg(n);
      var aggLabel = st.fixedNa ? '不适用（固定）' : (agg==='ok'?'绿灯':agg==='no'?'不通过':'未完成');
      var parts = [];
      if(!st.fixedNa){
        CKEYS.forEach(function(ck){
          var v = getCell(n, ck);
          var piece = CK_LABEL[ck]+'='+STATE_LABEL[v];
          if(v==='no'){
            var cfg = st[ck]||{};
            var syms = getSyms(n, ck).map(function(i){ return (cfg.fails||[])[i]; }).filter(Boolean);
            var oth = (state.rows[n] && state.rows[n]['oth_'+ck]) || '';
            if(oth) syms.push('其他：'+oth);
            if(syms.length) piece += '【'+syms.join('；')+'】';
          }
          parts.push(piece);
        });
      }
      var cmt = (state.rows[n] && state.rows[n].cmt) || '';
      lines.push('第'+n+'步 '+st.name+'：'+aggLabel+(parts.length?'（'+parts.join('，')+'）':'')+(cmt?'　备注：'+cmt:''));
      if(!st.fixedNa && agg!=='ok') chainPass = false;
    });
    lines.push('');
    lines.push('第1~13步结论：' + (chainPass ? '全部绿灯，获客链路打通' : '未全部通过（存在不通过或未完成的步骤）'));
    lines.push('完整功能验收结论：不通过 —— 第14步公开回评这个版本没做，固定不适用');
    document.getElementById('reportOut').value = lines.join(NL);
  });
})();
</script>

</body></html>
`;
}
