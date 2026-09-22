import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcribeAudio, parseTranscript, resolveApiKey } from "../transcribe-qwen-audio.js";

test("parseTranscript: sentence[].text 优先(带标点)", () => {
  const resp = { output: { sentence: [{ text: "你好," }, { text: "在吗?" }] } };
  assert.equal(parseTranscript(resp), "你好,在吗?");
});

test("parseTranscript: 没有sentence时退回output.text", () => {
  assert.equal(parseTranscript({ output: { text: "整段文字" } }), "整段文字");
});

test("parseTranscript: 都没有时退回words[]逐词拼接(兜底,可能丢标点)", () => {
  const resp = { output: { words: [{ text: "你" }, { text: "好" }] } };
  assert.equal(parseTranscript(resp), "你好");
});

test("parseTranscript: 空响应返回空字符串,不抛错", () => {
  assert.equal(parseTranscript({}), "");
  assert.equal(parseTranscript(null), "");
});

test("resolveApiKey: 优先env.DASHSCOPE_API_KEY", () => {
  assert.equal(resolveApiKey({ DASHSCOPE_API_KEY: "sk-test-123" }), "sk-test-123");
});

test("resolveApiKey: env没有时读keyfile(注入路径,不碰真实~/.config)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dashscope-test-"));
  const keyfile = path.join(dir, "dashscope-api-key");
  fs.writeFileSync(keyfile, "sk-from-file\n");
  assert.equal(resolveApiKey({ DASHSCOPE_API_KEY_FILE: keyfile }), "sk-from-file");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("resolveApiKey: 哪里都读不到时返回空字符串(不抛错)", () => {
  assert.equal(resolveApiKey({ DASHSCOPE_API_KEY_FILE: "/tmp/definitely-not-exist-xyz" }), "");
});

test("transcribeAudio: 必传parameters.format(0911真机实证:不传会UNSUPPORTED_FORMAT)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const audioPath = path.join(dir, "a.wav");
  fs.writeFileSync(audioPath, Buffer.from("fake-audio-bytes"));
  let capturedBody = null;
  const httpPost = async (url, body) => {
    capturedBody = body;
    return { output: { sentence: [{ text: "转写结果" }] } };
  };
  const text = await transcribeAudio(audioPath, { format: "wav", httpPost, apiKey: "sk-test" });
  assert.equal(text, "转写结果");
  assert.equal(capturedBody.parameters.format, "wav");
  assert.equal(capturedBody.model, "qwen-audio-3.0-asr-flash");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("transcribeAudio: 转写结果为空时抛错,不静默返回空字符串", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const audioPath = path.join(dir, "a.wav");
  fs.writeFileSync(audioPath, Buffer.from("x"));
  const httpPost = async () => ({ output: {} });
  await assert.rejects(() => transcribeAudio(audioPath, { httpPost, apiKey: "sk-test" }), /返回空转写/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("transcribeAudio: 找不到apiKey时抛错,不发请求", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const audioPath = path.join(dir, "a.wav");
  fs.writeFileSync(audioPath, Buffer.from("x"));
  let called = false;
  const httpPost = async () => { called = true; return {}; };
  await assert.rejects(
    () => transcribeAudio(audioPath, { httpPost, env: { DASHSCOPE_API_KEY_FILE: "/tmp/nope-xyz" } }),
    /找不到DASHSCOPE_API_KEY/
  );
  assert.equal(called, false);
  fs.rmSync(dir, { recursive: true, force: true });
});
