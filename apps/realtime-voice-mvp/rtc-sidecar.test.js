// TDD Red: rtc-sidecar 合同测试（先红后绿）
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRtcSidecar } from './rtc-sidecar.js';

describe('RTC Sidecar (contract tests)', () => {
  let sidecar;

  afterEach(async () => {
    if (sidecar) await sidecar.stop();
  });

  describe('Step 2: WS:8765 + OnUserJoined 事件协议', () => {
    it('should start WebSocket server on port 8765', async () => {
      sidecar = createRtcSidecar({ port: 8765 });
      await sidecar.start();
      expect(sidecar.isListening()).toBe(true);
    });

    it('should emit OnUserJoined event within 5s after start', async () => {
      sidecar = createRtcSidecar({ port: 8766, autoJoinDelay: 100 });
      await sidecar.start();
      const event = await sidecar.waitForEvent('OnUserJoined', 5000);
      expect(event).toBeDefined();
      expect(event.type).toBe('OnUserJoined');
    });

    it('should reject connection on format mismatch (I-12)', async () => {
      sidecar = createRtcSidecar({ port: 8767, requireSampleRate: 16000 });
      await sidecar.start();
      const result = await sidecar.handleHandshake({ sample_rate: 8000, encoding: 'pcm', frame_ms: 20 });
      expect(result.status).toBe('format_mismatch');
    });

    it('should accept connection on valid handshake', async () => {
      sidecar = createRtcSidecar({ port: 8768, requireSampleRate: 16000 });
      await sidecar.start();
      const result = await sidecar.handleHandshake({ sample_rate: 16000, encoding: 'pcm', frame_ms: 20 });
      expect(result.status).toBe('ok');
    });
  });
});
