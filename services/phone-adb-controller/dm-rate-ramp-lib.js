// dm-rate-ramp-lib.js —— 私信触达日发送上限阶梯计算(纯函数,CJS)
// 0920 主理人拍板: 现有19条/天是拍脑袋压低值,从未测过真实平台限流阈值。
// 两个号各测一种升量方式: daily_step(逐日阶梯) / intraday_step(单日内快速阶梯)。
"use strict";

const DAY_MS = 24 * 3600 * 1000;

function daysSince(startDate, now) {
  const start = new Date(startDate + "T00:00:00+08:00").getTime();
  const diff = Math.floor((now.getTime() - start) / DAY_MS);
  return diff > 0 ? diff : 0;
}

function hourOfDayShanghai(now) {
  // 用 Intl 取 Asia/Shanghai 本地小时,不依赖运行机器自身时区设置
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai", hour: "numeric", hourCycle: "h23",
  }).formatToParts(now);
  const h = parts.find((p) => p.type === "hour");
  return h ? Number(h.value) : now.getHours();
}

function computeDailyCap(config, now) {
  const cfg = config || {};
  const ceiling = Number(cfg.ceiling_per_day) || Infinity;
  if (cfg.mode === "daily_step") {
    const d = daysSince(cfg.start_date, now);
    const cap = Number(cfg.base_per_day || 0) + Number(cfg.step_per_day || 0) * d;
    return Math.min(cap, ceiling);
  }
  if (cfg.mode === "intraday_step") {
    const hour = hourOfDayShanghai(now);
    const steps = Math.floor(hour / Number(cfg.step_every_hours || 1));
    const cap = Number(cfg.base_per_day || 0) + Number(cfg.step_amount || 0) * steps;
    return Math.min(cap, ceiling);
  }
  return Number(cfg.base_per_day || 0);
}

function loadRampConfig(configPath) {
  const fs = require("fs");
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

const shanghaiTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** Use the same business-line mapping as the frozen company configuration. */
async function readOutreachSettings(pool, lineKey, { companyId = null, tenantId = null } = {}) {
  const { rows } = await pool.query(`
    SELECT p.company_id, p.tenant_id, s.daily_cap, s.paused, s.revision,
           to_char(s.start_local, 'HH24:MI') AS start_local, to_char(s.end_local, 'HH24:MI') AS end_local
    FROM zenithjoy.tenant_company_profiles p
    LEFT JOIN zenithjoy.company_outreach_settings s ON s.tenant_id=p.tenant_id AND s.company_id=p.company_id
    WHERE p.runtime_config->'routing'->>'line_key'=$1
      AND ($2::uuid IS NULL OR p.company_id=$2)
      AND ($3::uuid IS NULL OR p.tenant_id=$3)
  `, [lineKey, companyId, tenantId]);
  if (rows.length !== 1) throw Error('OUTREACH_SETTINGS_COMPANY_MAPPING_INVALID');
  return rows[0].daily_cap == null ? null : rows[0];
}

function assertOutreachWindow(settings, now = new Date()) {
  if (!settings) return;
  if (settings.paused) throw Error('OUTREACH_PAUSED');
  const { start_local: start, end_local: end } = settings;
  const local = shanghaiTime.format(now);
  const within = start === end || (start < end ? local >= start && local < end : local >= start || local < end);
  if (!within) throw Error('OUTREACH_WINDOW_CLOSED');
}

module.exports = { computeDailyCap, loadRampConfig, readOutreachSettings, assertOutreachWindow };
