import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const LEDGER = join(dirname(fileURLToPath(import.meta.url)), "..", "ledger.mjs");
function led(dir, ...args) {
  const r = spawnSync(process.execPath, [LEDGER, ...args, "--run-dir", dir], { encoding: "utf8" });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim(), json: r.stdout.trim() ? JSON.parse(r.stdout.trim().split("\n").pop()) : null };
}

test("init: 七阶段 pending，attempt 未分配", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  const r = led(d, "init", "--run-id", "social-keyword-leadgen-crontab-auto1", "--hash", "abc");
  assert.equal(r.code, 0);
  assert.equal(r.json.attempt_id, null);
  const book = JSON.parse(readFileSync(join(d, "ledger.json"), "utf8"));
  assert.deepEqual(Object.keys(book.stages), ["preflight", "discovery", "qualification", "collection", "scoring", "delivery", "cleanup"]);
  assert.equal(book.task_request_hash, "abc");
});

test("set --n --word 写 items 并按 n 覆盖", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  led(d, "init", "--run-id", "r");
  led(d, "set", "--stage", "discovery", "--status", "failed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "1", "--word", "A");
  const book = JSON.parse(readFileSync(join(d, "ledger.json"), "utf8"));
  assert.equal(book.stages.discovery.items.length, 1);
  assert.equal(book.stages.discovery.items[0].status, "completed");
  assert.equal(book.stages.discovery.status, "completed");
});

test("next-attempt: 首次 a1，skip_words 只含 discovery+collection 都 completed 的词", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  led(d, "init", "--run-id", "r");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "collection", "--status", "completed", "--n", "1", "--word", "A");
  led(d, "set", "--stage", "discovery", "--status", "completed", "--n", "2", "--word", "B");
  led(d, "set", "--stage", "collection", "--status", "failed", "--n", "2", "--word", "B");
  const r1 = led(d, "next-attempt");
  assert.equal(r1.json.attempt_id, "a1");
  assert.deepEqual(r1.json.skip_words, ["A"]);
  const r2 = led(d, "next-attempt");
  assert.equal(r2.json.attempt_id, "a2");
});

test("坏账本 fail-open：警告并重建，attempt 从 a1", () => {
  const d = mkdtempSync(join(tmpdir(), "led-"));
  writeFileSync(join(d, "ledger.json"), "{not json");
  const r = led(d, "next-attempt");
  assert.equal(r.code, 0);
  assert.match(r.err, /ledger corrupt/);
  assert.equal(r.json.attempt_id, "a1");
  assert.deepEqual(r.json.skip_words, []);
});
