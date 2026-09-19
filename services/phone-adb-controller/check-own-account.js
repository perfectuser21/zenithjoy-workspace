#!/usr/bin/env node
// check-own-account.js <nick> <id> —— 供 harvest-keyword.sh 调用
// stdout: own / not_own；退出码 0=own(命中,应跳过) 1=not_own
const path = require("path");
const { loadOwnAccounts, isOwnAccount } = require("./own-accounts-lib.js");
const [, , nick, id] = process.argv;
const configPath = path.join(__dirname, "config", "own-accounts.json");
const config = loadOwnAccounts(configPath);
if (isOwnAccount(nick, id, config)) {
  console.log("own");
  process.exit(0);
} else {
  console.log("not_own");
  process.exit(1);
}
