import { test } from "node:test";
import assert from "node:assert/strict";
import { isOwnAccount } from "../own-accounts-lib.js";

const CONFIG = { nicknames: new Set(["躺赢AI学姐"]), ids: new Set(["langzi63485"]) };

test("isOwnAccount: 昵称命中", () => {
  assert.equal(isOwnAccount("躺赢AI学姐", "someid", CONFIG), true);
});
test("isOwnAccount: 抖音号命中", () => {
  assert.equal(isOwnAccount("随便昵称", "langzi63485", CONFIG), true);
});
test("isOwnAccount: 都不命中", () => {
  assert.equal(isOwnAccount("路人甲", "999999", CONFIG), false);
});
test("isOwnAccount: 空值不误判为命中", () => {
  assert.equal(isOwnAccount("", "", CONFIG), false);
});
