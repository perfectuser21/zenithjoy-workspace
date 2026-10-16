// 两种已核策略的消费合同；未知能力保持pending，不能据此判断视频内容。
export function assertCaptureStrategy(p){
 const fail=()=>{throw Error('RECORD_CAPTURE_STRATEGY_UNVERIFIED');};
 if(!p||!Number.isSafeInteger(p.capture_audio_sdk)||p.capture_audio_required!==true||p.capture_audio_sdk_evidence_file!==p.evidence_id+'.capture-sdk.txt'||!/^[a-f0-9]{64}$/.test(p.capture_audio_sdk_evidence_sha256||''))fail();
 const e=p.capture_audio_end;
 if(!e||e.mode!==p.capture_audio_mode||e.sdk!==p.capture_audio_sdk||e.required!==true||e.sdk_evidence_file!==p.capture_audio_sdk_evidence_file||e.sdk_evidence_sha256!==p.capture_audio_sdk_evidence_sha256)fail();
 if(!Number.isSafeInteger(p.audio_streams)||p.audio_streams<1)throw Error('RECORD_AUDIO_TRACK_UNVERIFIED');
 if(p.capture_audio_mode==='playback_dup'&&p.capture_audio_sdk>=33)return;
 if(p.capture_audio_mode!=='output_pcm_sdk31'||p.capture_audio_sdk!==31||p.video_streams!==0||p.audio_streams!==1||p.audio_codec!=='pcm_s16le')fail();
 const d=p.decoded_audio;
 if(!d||d.verified!==true||d.decoder_exit_code!==0||d.sample_rate!==16000||!Number.isSafeInteger(d.samples)||d.samples<=0||d.seconds!==d.samples/d.sample_rate||!Number.isSafeInteger(d.requested_seconds)||d.requested_seconds<5||d.requested_seconds>320||d.seconds<d.requested_seconds*.8||d.seconds>d.requested_seconds+3||d.evidence_file!==p.evidence_id+'.decode.json'||!/^[a-f0-9]{64}$/.test(d.evidence_sha256||''))fail();
 const r=p.capture_runtime,t=p.capture_runtime_end;
 if(!r||!t||r.client_sha256!=='7c15cbe29c58495b329fcd0737feeb3d10ddbf9d27ff1f6c6438b3c49dc2edb2'||r.server_sha256!=='764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536'||r.evidence_file!==p.evidence_id+'.capture-runtime.json'||!/^[a-f0-9]{64}$/.test(r.evidence_sha256||'')||Object.keys(r).length!==4||Object.keys(t).length!==4||Object.keys(r).some(k=>r[k]!==t[k]))fail();
}
