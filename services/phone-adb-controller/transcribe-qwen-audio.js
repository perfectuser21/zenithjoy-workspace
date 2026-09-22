// transcribe-qwen-audio.js —— 视频音频转写(DashScope qwen-audio-3.0-asr-flash)
//
// 0911真机实证(memory: handoff_0911_leadgen_realmachine_probe_gate8_gate11_shipped):
// 用TTS合成已知文案做ground truth,对比转写结果——业务关键词9/9全对,6.3分钟长稿字级
// 准确率89.8%,3倍速直接送不降速不分片(降速慢2.9倍、计费贵3倍,准确率跟3x一样)。
// DashScope调用**必须传parameters.format**,否则报UNSUPPORTED_FORMAT: format is empty。
//
// ⚠️ response解析基于memory笔记里描述的字段形状(output.sentence[].text,words[]带
// punctuation/时间戳)转述,本PR未连真实DashScope接口验证过——真机验证前请先跑一次
// 真实调用核对response shape,如有出入以真机为准调整parseTranscript。
"use strict";
const fs = require("fs");

const ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const MODEL = "qwen-audio-3.0-asr-flash";

function resolveApiKey(env = process.env) {
  if (env.DASHSCOPE_API_KEY) return env.DASHSCOPE_API_KEY;
  const keyfile = env.DASHSCOPE_API_KEY_FILE || `${env.HOME || ""}/.config/openclaw/dashscope-api-key`;
  try {
    return fs.readFileSync(keyfile, "utf8").trim();
  } catch {
    return "";
  }
}

// 从DashScope响应里把句子文本拼出来——sentence.text标点完整,优先用它;
// 只有words[]没有sentence时才退回逐词拼接(会丢标点,仅兜底)。
function parseTranscript(resp) {
  const output = resp && resp.output;
  if (!output) return "";
  const sentences = output.sentence || output.sentences;
  if (Array.isArray(sentences) && sentences.length > 0) {
    return sentences.map((s) => (s && s.text) || "").join("");
  }
  if (typeof output.text === "string") return output.text;
  if (Array.isArray(output.words)) {
    return output.words.map((w) => (w && w.text) || "").join("");
  }
  return "";
}

async function defaultHttpPost(url, body, apiKey) {
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

// audioPath: 本地音频文件路径(harvest-keyword.sh配合douyin-phone-adb的
// record-start/record-stop/record-extract-audio产出,3倍速录屏后提取的16k音频,
// 本文件不负责录制这一步,只负责把已提取好的音频文件转写成文字)。
async function transcribeAudio(audioPath, { format = "wav", httpPost = defaultHttpPost, apiKey, env } = {}) {
  const key = apiKey || resolveApiKey(env);
  if (!key) throw new Error("transcribeAudio: 找不到DASHSCOPE_API_KEY(env或~/.config/openclaw/dashscope-api-key)");
  const audioB64 = fs.readFileSync(audioPath).toString("base64");
  const body = { model: MODEL, input: { audio: audioB64 }, parameters: { format } };
  const resp = await httpPost(ENDPOINT, body, key);
  const text = parseTranscript(resp);
  if (!text) throw new Error("transcribeAudio: DashScope返回空转写,raw=" + JSON.stringify(resp).slice(0, 200));
  return text;
}

module.exports = { transcribeAudio, parseTranscript, resolveApiKey, MODEL, ENDPOINT };
