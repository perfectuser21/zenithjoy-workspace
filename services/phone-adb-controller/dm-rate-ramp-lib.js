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

module.exports = { computeDailyCap, loadRampConfig };
