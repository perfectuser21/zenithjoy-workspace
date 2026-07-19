/**
 * 计算一轮语音对话（用户说完 → AI 识别 → AI 开始回复 → TTS 首包 → 回复结束）
 * 的三段耗时。纯函数，不做 I/O，方便单测；调用方负责传入各阶段的
 * Date.now() 时间戳（缺失的阶段传 null）。
 */
export function computeTurnLatency({ lastAsrAt, chatStartAt, firstTtsAt, chatEndedAt }) {
  if (chatEndedAt == null) {
    throw new Error('chatEndedAt is required');
  }

  // If lastAsrAt is missing, all metrics are null since they're all relative to ASR completion
  if (lastAsrAt == null) {
    return { asrToChatMs: null, chatToTtsMs: null, totalMs: null };
  }

  const asrToChatMs = chatStartAt != null ? chatStartAt - lastAsrAt : null;
  const chatToTtsMs = chatStartAt != null && firstTtsAt != null ? firstTtsAt - chatStartAt : null;
  const totalMs = chatEndedAt - lastAsrAt;

  return { asrToChatMs, chatToTtsMs, totalMs };
}
