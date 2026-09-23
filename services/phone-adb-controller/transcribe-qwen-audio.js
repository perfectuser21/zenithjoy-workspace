// transcribe-qwen-audio.js —— 视频音频转写(DashScope qwen-audio-3.0-asr-flash)
//
// 0911真机实证(memory: handoff_0911_leadgen_realmachine_probe_gate8_gate11_shipped):
// 用TTS合成已知文案做ground truth,对比转写结果——业务关键词9/9全对,6.3分钟长稿字级
// 准确率89.8%,3倍速直接送不降速不分片(降速慢2.9倍、计费贵3倍,准确率跟3x一样)。
//
// 0923修正: 本文件早前(PR#1944)按自己猜的接口写(专用ASR端点/api/v1/services/audio/
// asr/transcription,直传裸base64)——真机实测报错"url error"(该端点要真实URL,不接受
// 内联音频数据)。真正跑通过的实现其实早就存在:0911那次真机验证用的是
// ~/.local/asr-tools/transcribe-gemini.mjs(在xian-m4上,从没进过这个仓库的git),
// 走的是**多模态生成端点**(aigc/multimodal-generation/generation),音频以
// data:audio/<format>;base64,<data> 的URI形式塞进messages.content,不是专用ASR端点、
// 也不需要任何对象存储中转。0923用真实TTS音频重新验证过一遍,转写100%准确。
// 本次把这份已验证的正确实现搬进本仓库(此前它只活在M4本地,从没进过版本控制)。
"use strict";
const fs = require("fs");

const ENDPOINT = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";
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

// 响应形状是双层output嵌套(output.output.sentence.text),0923真实调用实测确认。
// sentence.text标点完整,优先用它;没有sentence时退回output.output.text。
function parseTranscript(resp) {
  const outer = resp && resp.output;
  const inner = outer && outer.output;
  if (!inner) return "";
  const sentence = inner.sentence;
  if (sentence && typeof sentence.text === "string" && sentence.text) return sentence.text;
  if (typeof inner.text === "string") return inner.text;
  return "";
}

// words[]时间戳(begin_time/end_time,毫秒),供未来钩子定位用——当前judge-video.js
// 只需要纯文本,这里保留原始结构以防后续需要,不在transcribeAudio的返回值里强解析。
function parseWords(resp) {
  const inner = resp && resp.output && resp.output.output;
  const sentence = inner && inner.sentence;
  return Array.isArray(sentence && sentence.words) ? sentence.words : [];
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
  const body = {
    model: MODEL,
    input: { messages: [{ role: "user", content: [{ audio: `data:audio/${format};base64,${audioB64}` }] }] },
    parameters: { format }, // 必填,缺了报UNSUPPORTED_FORMAT: format is empty
  };
  const resp = await httpPost(ENDPOINT, body, key);
  const text = parseTranscript(resp);
  if (!text) throw new Error("transcribeAudio: DashScope返回空转写,raw=" + JSON.stringify(resp).slice(0, 200));
  return text;
}

module.exports = { transcribeAudio, parseTranscript, parseWords, resolveApiKey, MODEL, ENDPOINT };
