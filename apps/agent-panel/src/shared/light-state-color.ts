import type { LightState } from './types';

// 用户拍板（解PrepPRD Golden Path Step4/Step5表述矛盾：Step4隐含work=黄，
// Step5明说task_started灯变绿）：绿=工作中/黄=等待/红=卡住/灰=空闲。
const LIGHT_STATE_COLORS: Record<LightState, string> = {
  work: '#22c55e',
  wait: '#eab308',
  stuck: '#ef4444',
  idle: '#9ca3af',
};

export function lightStateColor(state: LightState): string {
  return LIGHT_STATE_COLORS[state];
}
