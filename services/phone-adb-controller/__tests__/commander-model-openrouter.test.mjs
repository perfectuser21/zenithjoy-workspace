// 回归（09-29）：判定复核走 OpenRouter，却用了 TOAPIS 渠道名 gemini-2.5-flash-official，
// OpenRouter 返回 HTTP 400「not a valid model ID」，补判 230 条积压时 56 条复核失败。
// 规则：发往 openrouter.ai 的复核模型 ID 不得带 TOAPIS 的 -official 渠道后缀，且须带厂商前缀。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

for (const file of ["../judge-jev.js", "../judge-comment.js"]) {
  test(`${file} 复核模型是 OpenRouter 有效 ID`, () => {
    const mod = require(file);
    const src = require("node:fs").readFileSync(new URL(file, import.meta.url), "utf8");
    const m = src.match(/const COMMANDER_MODEL = "([^"]+)"/);
    assert.ok(m, "未找到 COMMANDER_MODEL 常量");
    const model = mod.COMMANDER_MODEL ?? m[1];
    assert.match(src, /openrouter\.ai\/api\/v1\/chat\/completions/, "复核端点应为 OpenRouter");
    assert.ok(!/-official$/.test(model), `${model} 是 TOAPIS 渠道名，OpenRouter 不认`);
    assert.match(model, /^[a-z0-9-]+\/[a-z0-9.-]+$/, `${model} 缺厂商前缀`);
  });
}
