// own-accounts-lib.js —— 自有账号名单判定(纯函数,CJS)
"use strict";

function loadOwnAccounts(configPath) {
  const fs = require("fs");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return {
    nicknames: new Set(raw.nicknames || []),
    ids: new Set(raw.ids || []),
  };
}

function isOwnAccount(nick, id, config) {
  const n = String(nick || "").trim();
  const i = String(id || "").trim();
  if (n && config.nicknames.has(n)) return true;
  if (i && config.ids.has(i)) return true;
  return false;
}

module.exports = { loadOwnAccounts, isOwnAccount };
