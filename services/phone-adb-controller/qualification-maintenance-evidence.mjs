// 维护只读取旧证据；本模块不执行手机、队列或租约动作。
export const SUPPORTED_QUALIFICATION_SOURCE = '353b910f11ce3852b2ef69c8ead5c37e97850b4a';
const tagPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/;
const videoPattern = /^\d{16,24}$/;
function invalid() { throw Error('MAINTENANCE_FAILURE_EVIDENCE'); }

export function parseQualificationFailure(raw, scope) {
  if (typeof raw !== 'string' || !scope || !tagPattern.test(scope.run || '')
      || !videoPattern.test(scope.video_id || '') || typeof scope.evidence_root !== 'string'
      || !/^\/private\/tmp\/openclaw-phone\/evidence\/[A-Za-z0-9_.-]+$/.test(scope.evidence_root)) invalid();
  const audio = `${scope.evidence_root}/${scope.run}-v${scope.video_id}-qualification-record.16k.wav`;
  // 353的AUDIO用print -r，保留literal \\t；QUAL用print，产生真实TAB。
  // 不通用归一化，不接受额外结论、旁视频或judged分支。
  const expected = `AUDIO\\t${scope.video_id}\\t${audio}\nQUAL\t${scope.video_id}\tpending\taudio_upload_failed\n`;
  if (raw !== expected) invalid();
  return {video_id: scope.video_id, audio_path: audio, reason: 'audio_upload_failed'};
}
