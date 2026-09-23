import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { transcribeAudio, parseTranscript, parseWords, resolveApiKey } from "../transcribe-qwen-audio.js";

// 0923修正: 响应形状是双层output嵌套(output.output.sentence.text),0923用真实TTS
// 音频对真实DashScope接口实测确认过(此前PR#1944的单层output.sentence[]是猜的,错的)。

test("parseTranscript: output.output.sentence.text 优先(标点完整)", () => {
  const resp = { output: { output: { sentence: { text: "怎么报名这个证书？" } } } };
  assert.equal(parseTranscript(resp), "怎么报名这个证书？");
});

test("parseTranscript: 没有sentence时退回output.output.text", () => {
  assert.equal(parseTranscript({ output: { output: { text: "整段文字" } } }), "整段文字");
});

test("parseTranscript: 空响应返回空字符串,不抛错", () => {
  assert.equal(parseTranscript({}), "");
  assert.equal(parseTranscript(null), "");
  assert.equal(parseTranscript({ output: {} }), "");
});

test("parseWords: 提取sentence.words(带begin_time/end_time毫秒时间戳)", () => {
  const resp = { output: { output: { sentence: { text: "你好", words: [{ text: "你", begin_time: 0, end_time: 200 }] } } } };
  assert.deepEqual(parseWords(resp), [{ text: "你", begin_time: 0, end_time: 200 }]);
});

test("parseWords: 没有words时返回空数组,不抛错", () => {
  assert.deepEqual(parseWords({}), []);
  assert.deepEqual(parseWords({ output: { output: { sentence: {} } } }), []);
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
    return { output: { output: { sentence: { text: "转写结果" } } } };
  };
  const text = await transcribeAudio(audioPath, { format: "wav", httpPost, apiKey: "sk-test" });
  assert.equal(text, "转写结果");
  assert.equal(capturedBody.parameters.format, "wav");
  assert.equal(capturedBody.model, "qwen-audio-3.0-asr-flash");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("transcribeAudio: 音频以data:audio/<format>;base64,<data>形式塞进messages内容(0923真机验证的正确端点/形状,不是专用ASR端点也不是裸base64)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const audioPath = path.join(dir, "a.wav");
  fs.writeFileSync(audioPath, Buffer.from("fake-audio-bytes"));
  let capturedUrl = null, capturedBody = null;
  const httpPost = async (url, body) => {
    capturedUrl = url; capturedBody = body;
    return { output: { output: { sentence: { text: "ok" } } } };
  };
  await transcribeAudio(audioPath, { format: "wav", httpPost, apiKey: "sk-test" });
  assert.match(capturedUrl, /aigc\/multimodal-generation\/generation$/);
  const audioField = capturedBody.input.messages[0].content[0].audio;
  assert.match(audioField, /^data:audio\/wav;base64,/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("transcribeAudio: 转写结果为空时抛错,不静默返回空字符串", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audio-test-"));
  const audioPath = path.join(dir, "a.wav");
  fs.writeFileSync(audioPath, Buffer.from("x"));
  const httpPost = async () => ({ output: { output: {} } });
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
