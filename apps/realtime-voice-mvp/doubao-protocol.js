// 豆包 Realtime Dialogue 二进制协议编解码
// 协议细节已用真实连接验证（连接/会话建立/文字对话/流式回复/TTS音频全链路测通）

export const MessageType = {
  FULL_CLIENT_REQUEST: 0b0001,
  AUDIO_ONLY_REQUEST: 0b0010,
  FULL_SERVER_RESPONSE: 0b1001,
  AUDIO_ONLY_RESPONSE: 0b1011,
  ERROR_INFORMATION: 0b1111,
};

const PROTOCOL_VERSION = 0b0001;
const HEADER_SIZE_4 = 0b0001;
const CARRY_EVENT_ID = 0b0100;

export const EventSend = {
  StartConnection: 1,
  FinishConnection: 2,
  StartSession: 100,
  FinishSession: 102,
  TaskRequest: 200,
  ChatTextQuery: 501,
};

export const EventReceive = {
  50: 'ConnectionStarted',
  51: 'ConnectionFailed',
  52: 'ConnectionFinished',
  150: 'SessionStarted',
  151: 'SessionCanceled',
  152: 'SessionFinished',
  153: 'SessionFailed',
  350: 'TTSSentenceStart',
  351: 'TTSSentenceEnd',
  352: 'TTSResponse',
  359: 'TTSEnded',
  450: 'ASRInfo',
  451: 'ASRResponse',
  459: 'ASREnded',
  550: 'ChatResponse',
  553: 'ChatTextQueryConfirmed',
  559: 'ChatEnded',
  599: 'DialogCommonError',
};

function buildHeader(messageType) {
  return Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE_4,
    (messageType << 4) | CARRY_EVENT_ID,
    0b00010000, // JSON serialization, no compression
    0x00,
  ]);
}

function lengthPrefixed(buf) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(buf.length, 0);
  return [len, buf];
}

/** 建立文本类事件帧（StartConnection/StartSession/ChatTextQuery/FinishSession） */
export function buildJsonFrame(event, sessionId, jsonPayload) {
  const parts = [buildHeader(MessageType.FULL_CLIENT_REQUEST)];
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeUInt32BE(event, 0);
  parts.push(eventBuf);
  if (sessionId) {
    parts.push(...lengthPrefixed(Buffer.from(sessionId, 'utf8')));
  }
  parts.push(...lengthPrefixed(Buffer.from(JSON.stringify(jsonPayload || {}), 'utf8')));
  return Buffer.concat(parts);
}

/** 建立音频帧（TaskRequest，上传麦克风 PCM 音频） */
export function buildAudioFrame(sessionId, audioBuffer) {
  const header = Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE_4,
    (MessageType.AUDIO_ONLY_REQUEST << 4) | CARRY_EVENT_ID,
    0b00010000,
    0x00,
  ]);
  const eventBuf = Buffer.alloc(4);
  eventBuf.writeUInt32BE(EventSend.TaskRequest, 0);
  const parts = [header, eventBuf, ...lengthPrefixed(Buffer.from(sessionId, 'utf8')), ...lengthPrefixed(audioBuffer)];
  return Buffer.concat(parts);
}

function readLengthPrefixed(buf, offset) {
  const len = buf.readUInt32BE(offset);
  return { bytes: buf.slice(offset + 4, offset + 4 + len), next: offset + 4 + len };
}

/**
 * 解析服务端响应帧。
 * ConnectionStarted 等少数事件在 event 之后会多带一个 connect_id 字符串字段，
 * 用"首字节是否像 JSON/剩余长度是否吻合"判断是否需要跳过这个字段——
 * 已用真实响应验证：ConnectionStarted 带该字段，SessionStarted/ChatResponse/TTSResponse 等不带。
 */
export function parseFrame(buf) {
  const headerSizeWords = buf[0] & 0x0f;
  const messageType = buf[1] >> 4;
  const flags = buf[1] & 0x0f;
  let offset = headerSizeWords * 4;
  const result = { messageType };

  if (flags & CARRY_EVENT_ID) {
    const event = buf.readUInt32BE(offset);
    offset += 4;
    result.event = event;
    result.eventName = EventReceive[event] || `unknown(${event})`;
  }

  if (messageType === MessageType.FULL_SERVER_RESPONSE) {
    let { bytes, next } = readLengthPrefixed(buf, offset);
    const looksLikeJson = bytes.length > 0 && (bytes[0] === 0x7b || bytes[0] === 0x5b);
    if (!looksLikeJson && next !== buf.length) {
      result.connectId = bytes.toString('utf8');
      ({ bytes } = readLengthPrefixed(buf, next));
    }
    result.payload = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
  } else if (messageType === MessageType.AUDIO_ONLY_RESPONSE) {
    let { bytes, next } = readLengthPrefixed(buf, offset);
    if (next !== buf.length) {
      result.connectId = bytes.toString('latin1');
      ({ bytes } = readLengthPrefixed(buf, next));
    }
    result.audio = bytes;
  } else if (messageType === MessageType.ERROR_INFORMATION) {
    result.code = buf.readUInt32BE(offset);
    offset += 4;
    const { bytes } = readLengthPrefixed(buf, offset);
    result.payload = bytes.length ? JSON.parse(bytes.toString('utf8')) : {};
  }
  return result;
}
