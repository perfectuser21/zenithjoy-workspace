import { describe, it, expect } from 'vitest';
import { buildJsonFrame, buildAudioFrame, parseFrame, EventSend, MessageType } from './doubao-protocol.js';

describe('doubao-protocol', () => {
  it('buildJsonFrame 编码 StartConnection', () => {
    const frame = buildJsonFrame(EventSend.StartConnection, null, {});
    expect(frame[0]).toBe(0x11);
    expect(frame[1]).toBe(0x14); // FULL_CLIENT_REQUEST(0001) << 4 | CARRY_EVENT_ID(0100)
    expect(frame[2]).toBe(0x10); // JSON, no compression
    expect(frame.readUInt32BE(4)).toBe(EventSend.StartConnection);
    const jsonLen = frame.readUInt32BE(8);
    expect(jsonLen).toBe(2); // "{}"
    expect(frame.slice(12, 12 + jsonLen).toString('utf8')).toBe('{}');
  });

  it('buildJsonFrame 带 session_id 时正确插入长度前缀字符串', () => {
    const frame = buildJsonFrame(EventSend.ChatTextQuery, 'sess-abc', { content: '你好' });
    const sidLen = frame.readUInt32BE(8);
    expect(sidLen).toBe(8); // 'sess-abc'.length
    expect(frame.slice(12, 12 + sidLen).toString('utf8')).toBe('sess-abc');
  });

  it('buildAudioFrame 编码音频帧', () => {
    const audio = Buffer.from([1, 2, 3, 4]);
    const frame = buildAudioFrame('sess-1', audio);
    expect(frame[1]).toBe((MessageType.AUDIO_ONLY_REQUEST << 4) | 0b0100);
    // header(4) + event(4) + sessionIdLen(4)+'sess-1'(6) + audioLen(4)
    const audioLenOffset = 4 + 4 + 4 + 6;
    expect(frame.readUInt32BE(audioLenOffset)).toBe(4);
    expect(frame.slice(audioLenOffset + 4)).toEqual(audio);
  });

  it('parseFrame 解析真实抓包的 ConnectionStarted 响应（含 connect_id 字段）', () => {
    // 真实连接测试时抓到的原始字节（2026-07-17 实测）
    const hex =
      '11941000000000320000002433396633656636632d323839662d343336382d396436372d363336636437663263393933000000027b7d';
    const buf = Buffer.from(hex, 'hex');
    const parsed = parseFrame(buf);
    expect(parsed.eventName).toBe('ConnectionStarted');
    expect(parsed.connectId).toBe('39f3ef6c-289f-4368-9d67-636cd7f2c993');
    expect(parsed.payload).toEqual({});
  });

  it('parseFrame 解析不带 connect_id 的普通 JSON 响应（如 SessionStarted）', () => {
    const header = Buffer.from([0x11, 0x94, 0x10, 0x00]);
    const eventBuf = Buffer.alloc(4);
    eventBuf.writeUInt32BE(150, 0); // SessionStarted
    const json = Buffer.from(JSON.stringify({ dialog_id: 'abc-123' }), 'utf8');
    const jsonLen = Buffer.alloc(4);
    jsonLen.writeUInt32BE(json.length, 0);
    const buf = Buffer.concat([header, eventBuf, jsonLen, json]);
    const parsed = parseFrame(buf);
    expect(parsed.eventName).toBe('SessionStarted');
    expect(parsed.connectId).toBeUndefined();
    expect(parsed.payload).toEqual({ dialog_id: 'abc-123' });
  });

  it('parseFrame 解析音频响应帧', () => {
    const header = Buffer.from([0x11, 0xb4, 0x10, 0x00]); // AUDIO_ONLY_RESPONSE(1011)<<4 | CARRY_EVENT_ID
    const eventBuf = Buffer.alloc(4);
    eventBuf.writeUInt32BE(352, 0); // TTSResponse
    const audio = Buffer.from([9, 9, 9, 9, 9]);
    const audioLen = Buffer.alloc(4);
    audioLen.writeUInt32BE(audio.length, 0);
    const buf = Buffer.concat([header, eventBuf, audioLen, audio]);
    const parsed = parseFrame(buf);
    expect(parsed.eventName).toBe('TTSResponse');
    expect(parsed.audio).toEqual(audio);
  });
});
