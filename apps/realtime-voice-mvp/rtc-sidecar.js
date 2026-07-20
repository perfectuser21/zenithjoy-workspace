/**
 * RTC Sidecar stub — GP-A 语音引擎迁移（thin 骨架）
 *
 * 合同: Step 2 (I-10/I-11/I-12)
 * - 本地 WS:8765 接入，作为 Python audio_bridge.py 的 ws_url 目标
 * - 实现 OnUserJoined 事件协议（stub，5s 内自动触发）
 * - 实现格式握手校验（sample_rate/encoding/frame_ms）
 *
 * NFR N-5: thin 阶段允许 stub（真实 Volcengine RTC SDK 接入在 medium 阶段）
 */

import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';

const REQUIRED_SAMPLE_RATE = 16000;
const REQUIRED_ENCODING = 'pcm';
const REQUIRED_FRAME_MS = 20;
const ON_USER_JOINED_DELAY_MS = 500; // stub: 500ms 后自动触发

export function createRtcSidecar(opts = {}) {
  const {
    port = 8765,
    requireSampleRate = REQUIRED_SAMPLE_RATE,
    autoJoinDelay = ON_USER_JOINED_DELAY_MS,
  } = opts;

  const emitter = new EventEmitter();
  let wss = null;
  let _listening = false;
  let _onUserJoinedTimer = null;

  async function start() {
    return new Promise((resolve, reject) => {
      wss = new WebSocketServer({ port });
      wss.on('listening', () => {
        _listening = true;
        // stub: 自动延迟发出 OnUserJoined
        _onUserJoinedTimer = setTimeout(() => {
          emitter.emit('OnUserJoined', { type: 'OnUserJoined', user_id: 'ai-agent-stub' });
        }, autoJoinDelay);
        resolve();
      });
      wss.on('error', reject);
      wss.on('connection', (ws) => {
        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'handshake') {
              const result = handleHandshake(msg.params || {});
              ws.send(JSON.stringify(result));
            }
          } catch { /* ignore */ }
        });
      });
    });
  }

  async function stop() {
    clearTimeout(_onUserJoinedTimer);
    _listening = false;
    if (wss) {
      await new Promise((resolve) => wss.close(resolve));
      wss = null;
    }
  }

  function isListening() {
    return _listening;
  }

  function handleHandshake(params = {}) {
    const { sample_rate, encoding, frame_ms } = params;
    if (sample_rate !== requireSampleRate || encoding !== REQUIRED_ENCODING || frame_ms !== REQUIRED_FRAME_MS) {
      return {
        status: 'format_mismatch',
        expected: { sample_rate: requireSampleRate, encoding: REQUIRED_ENCODING, frame_ms: REQUIRED_FRAME_MS },
        got: { sample_rate, encoding, frame_ms },
      };
    }
    return { status: 'ok' };
  }

  function waitForEvent(eventName, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${eventName}`)), timeoutMs);
      emitter.once(eventName, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  return { start, stop, isListening, handleHandshake, waitForEvent };
}
