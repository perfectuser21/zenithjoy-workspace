// 两种已核策略的消费合同；未知能力保持pending，不能据此判断视频内容。
export function assertCaptureStrategy(p){
 const fail=()=>{throw Error('RECORD_CAPTURE_STRATEGY_UNVERIFIED');};
 if(!p||!Number.isSafeInteger(p.capture_audio_sdk)||p.capture_audio_required!==true||p.capture_audio_sdk_evidence_file!==p.evidence_id+'.capture-sdk.txt'||!/^[a-f0-9]{64}$/.test(p.capture_audio_sdk_evidence_sha256||''))fail();
 const e=p.capture_audio_end;
 if(!e||e.mode!==p.capture_audio_mode||e.sdk!==p.capture_audio_sdk||e.required!==true||e.sdk_evidence_file!==p.capture_audio_sdk_evidence_file||e.sdk_evidence_sha256!==p.capture_audio_sdk_evidence_sha256)fail();
 if(!Number.isSafeInteger(p.audio_streams)||p.audio_streams<1)throw Error('RECORD_AUDIO_TRACK_UNVERIFIED');
 const r=p.capture_runtime,t=p.capture_runtime_end;
 const sdk33=p.capture_audio_mode==='playback_dup'&&p.capture_audio_sdk>=33;
 const client=sdk33?'d474146594d6f42ec04eede0049391a647ab27cdcf30c627ac30b281cf5069d7':'2823f8e89c3cdb014457d47cb5d9a08d067bd5a1e9e6c9e784a6a6e0f5b8e258';
 const server=sdk33?'8588238c9a5a00aa542906b6ec7e6d5541d9ffb9b5d0f6e1bc0e365e2303079e':'764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536';
 if(!r||!t||r.client_sha256!==client||r.server_sha256!==server||r.evidence_file!==p.evidence_id+'.capture-runtime.json'||!/^[a-f0-9]{64}$/.test(r.evidence_sha256||'')||Object.keys(r).length!==4||Object.keys(t).length!==4||Object.keys(r).some(k=>r[k]!==t[k]))fail();
 if(sdk33)return;
 if(p.capture_audio_mode!=='output_pcm_sdk31'||p.capture_audio_sdk!==31||p.video_streams!==0||p.audio_streams!==1||p.audio_codec!=='pcm_s16le')fail();
 const d=p.decoded_audio;
 if(!d||d.verified!==true||d.decoder_exit_code!==0||d.sample_rate!==16000||!Number.isSafeInteger(d.samples)||d.samples<=0||d.seconds!==d.samples/d.sample_rate||!Number.isSafeInteger(d.requested_seconds)||d.requested_seconds<5||d.requested_seconds>320||d.seconds<d.requested_seconds*.8||d.seconds>d.requested_seconds+3||d.evidence_file!==p.evidence_id+'.decode.json'||!/^[a-f0-9]{64}$/.test(d.evidence_sha256||''))fail();
}
