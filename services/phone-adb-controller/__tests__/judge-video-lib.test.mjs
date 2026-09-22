import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldSkipCheapGate, resolveTranscriptSource } from "../judge-video-lib.js";

test("shouldSkipCheapGate: 零评论视频跳过", () => {
  assert.equal(shouldSkipCheapGate({ comment_count: 0 }), true);
  assert.equal(shouldSkipCheapGate({ comment_count: "0" }), true);
  assert.equal(shouldSkipCheapGate(null), true);
});

test("shouldSkipCheapGate: 有评论的视频不跳过", () => {
  assert.equal(shouldSkipCheapGate({ comment_count: 5 }), false);
});

test("resolveTranscriptSource: 数据库已有转写文案 → 优先用,不重复花钱转写", () => {
  const r = resolveTranscriptSource({ transcript: "库里的转写" }, { transcript: "manifest里的" });
  assert.equal(r.source, "db");
  assert.equal(r.text, "库里的转写");
});

test("resolveTranscriptSource: 库里没有,manifest带现成transcript → 用manifest的", () => {
  const r = resolveTranscriptSource({ transcript: "" }, { transcript: "manifest提供的转写" });
  assert.equal(r.source, "manifest");
  assert.equal(r.text, "manifest提供的转写");
});

test("resolveTranscriptSource: manifest只带audioPath → 标记需要转写", () => {
  const r = resolveTranscriptSource({}, { audioPath: "/tmp/a.wav" });
  assert.equal(r.source, "needs_transcription");
  assert.equal(r.audioPath, "/tmp/a.wav");
});

test("resolveTranscriptSource: 什么都没有,退回视频标题", () => {
  const r = resolveTranscriptSource({ title: "视频标题文案" }, null);
  assert.equal(r.source, "title_only");
  assert.equal(r.text, "视频标题文案");
});

test("resolveTranscriptSource: 连标题都没有 → source=none", () => {
  const r = resolveTranscriptSource({}, null);
  assert.equal(r.source, "none");
  assert.equal(r.text, "");
});
