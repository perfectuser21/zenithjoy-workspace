// notify-bark.js —— 触达告警通道（mmv 上跑）。只测纯函数 + 失败静默约束，不出网。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const require_ = createRequire(import.meta.url);
const { buildBarkUrl, parseBarkToken } = require_("../notify-bark.js");
const SCRIPT = fileURLToPath(new URL("../notify-bark.js", import.meta.url));

test("buildBarkUrl: 标题正文 encodeURIComponent，默认 level=timeSensitive，group=leadgen", () => {
  const u = buildBarkUrl("TOK123", "获客触达熔断", "账号legacy已熔断");
  assert.equal(u, `https://api.day.app/TOK123/${encodeURIComponent("获客触达熔断")}/${encodeURIComponent("账号legacy已熔断")}?group=leadgen&level=timeSensitive`);
});

test("buildBarkUrl: 特殊字符（/ ? & # 空格 %）被编码，不会破坏路径与查询串", () => {
  const u = buildBarkUrl("TOK", "a/b?c", "x&y=1 #z 100%");
  const [path, query] = u.split("?");
  assert.equal(query, "group=leadgen&level=timeSensitive");
  assert.equal(path, "https://api.day.app/TOK/a%2Fb%3Fc/x%26y%3D1%20%23z%20100%25");
  assert.equal(path.split("/").length, 6, "路径段数不对——标题/正文里的 / 没被编码");
});

test("buildBarkUrl: level 可指定；空串/undefined 回落到默认", () => {
  assert.match(buildBarkUrl("T", "t", "b", "active"), /level=active$/);
  assert.match(buildBarkUrl("T", "t", "b", ""), /level=timeSensitive$/);
  assert.match(buildBarkUrl("T", "t", "b", undefined), /level=timeSensitive$/);
});

test("parseBarkToken: export BARK_TOKEN=x / 无 export / 带引号 / 带注释与空行", () => {
  assert.equal(parseBarkToken("export BARK_TOKEN=abc123\n"), "abc123");
  assert.equal(parseBarkToken("BARK_TOKEN=abc123"), "abc123");
  assert.equal(parseBarkToken('export BARK_TOKEN="abc123"\n'), "abc123");
  assert.equal(parseBarkToken("export BARK_TOKEN='abc123'\n"), "abc123");
  assert.equal(parseBarkToken("# c\nexport OTHER=1\n\nexport BARK_TOKEN=tok_9-Z\nexport X=2\n"), "tok_9-Z");
});

test("parseBarkToken: 缺失/空值/非字符串 → null", () => {
  assert.equal(parseBarkToken(""), null);
  assert.equal(parseBarkToken("export OTHER=1\n"), null);
  assert.equal(parseBarkToken("export BARK_TOKEN=\n"), null);
  assert.equal(parseBarkToken('export BARK_TOKEN=""\n'), null);
  assert.equal(parseBarkToken(undefined), null);
  assert.equal(parseBarkToken(null), null);
});

test("CLI: 没有 bark.env 时只在 stderr 写一行原因、退出码 0、不输出 BARK_OK", () => {
  const home = mkdtempSync(join(tmpdir(), "bark-"));
  const b64 = (s) => Buffer.from(s).toString("base64");
  const r = spawnSync(process.execPath, [SCRIPT, b64("标题"), b64("正文"), "active"], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 20000 });
  assert.equal(r.status, 0);
  assert.ok(!r.stdout.includes("BARK_OK"));
  assert.ok(r.stderr.trim().length > 0, "失败原因应打到 stderr");
  assert.equal(r.stderr.trim().split("\n").length, 1, "只应一行原因");
});

test("CLI: 缺参数同样静默退出 0；token 不会被打印", () => {
  const home = mkdtempSync(join(tmpdir(), "bark-"));
  mkdirSync(join(home, ".credentials"), { recursive: true });
  writeFileSync(join(home, ".credentials", "bark.env"), "export BARK_TOKEN=SECRET_TOKEN_VALUE\n");
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env: { ...process.env, HOME: home }, timeout: 20000 });
  assert.equal(r.status, 0);
  assert.ok(!(r.stdout + r.stderr).includes("SECRET_TOKEN_VALUE"), "token 泄漏到输出");
});
