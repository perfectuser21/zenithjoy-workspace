#!/usr/bin/env node
// dm-daily-cap.js <profile> —— 输出该profile此刻允许发送的当日上限条数
// 供 outreach-tick.sh 调用: 无该profile配置时不限量(输出一个很大的数)。
const path = require("path");
const { loadRampConfig, computeDailyCap } = require("./dm-rate-ramp-lib.js");
const [, , profile] = process.argv;
const configPath = path.join(__dirname, "config", "dm-rate-ramp.json");
const all = loadRampConfig(configPath);
const cfg = all[profile];
if (!cfg) {
  console.log("999999");
  process.exit(0);
}
console.log(String(computeDailyCap(cfg, new Date())));
