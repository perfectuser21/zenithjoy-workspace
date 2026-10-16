#!/usr/bin/env python3
"""Verify captured samples using a real, successful decoder; metadata cannot substitute."""
import argparse,hashlib,json,math,os,re,stat,subprocess,sys

def main():
 p=argparse.ArgumentParser();p.add_argument('--media',required=True);p.add_argument('--ffmpeg',required=True);p.add_argument('--requested-seconds',required=True,type=int);p.add_argument('--evidence-file',required=True);a=p.parse_args()
 if not 5<=a.requested_seconds<=320:raise ValueError('invalid capture budget')
 evidence={'verified':False,'requested_seconds':a.requested_seconds,'decoded_sample_rate':16000,'decoded_samples':0,'decoded_seconds':0,'decoder_exit_code':None,'mean_volume_db':None}
 # Reserve private immutable evidence before launching any decoder.
 fd=os.open(a.evidence_file,os.O_CREAT|os.O_EXCL|os.O_WRONLY|os.O_NOFOLLOW,0o600)
 try:
  if not stat.S_ISREG(os.lstat(a.media).st_mode):raise ValueError('media must be a regular file')
  cmd=[a.ffmpeg,'-hide_banner','-nostdin','-xerror','-v','info','-i',a.media,'-t','325','-map','0:a:0','-vn','-ac','1','-ar','16000','-af','volumedetect','-acodec','pcm_s16le','-f','s16le','pipe:1']
  r=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=30)
  evidence['decoder_exit_code']=r.returncode;evidence['stderr_tail']=r.stderr.decode(errors='replace')[-8000:]
  evidence['decoded_bytes']=len(r.stdout);evidence['decoded_samples']=len(r.stdout)//2;evidence['decoded_seconds']=evidence['decoded_samples']/16000
  levels=re.findall(r'mean_volume:\s*(-?[0-9]+(?:\.[0-9]+)?) dB',evidence['stderr_tail'])
  if len(levels)==1:evidence['mean_volume_db']=float(levels[0])
  evidence['decoded_pcm_sha256']=hashlib.sha256(r.stdout).hexdigest()
  evidence['verified']=(r.returncode==0 and len(r.stdout)%2==0 and a.requested_seconds*.8<=evidence['decoded_seconds']<=a.requested_seconds+3 and isinstance(evidence['mean_volume_db'],float) and math.isfinite(evidence['mean_volume_db']) and evidence['mean_volume_db']>-80)
 except (OSError,ValueError,subprocess.TimeoutExpired) as e:evidence['error']=str(e)[:1000]
 finally:
  raw=(json.dumps(evidence,ensure_ascii=False,sort_keys=True)+'\n').encode()
  with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
 print('decoded_audio_verified='+str(evidence['verified']).lower()+' decoded_audio_samples='+str(evidence['decoded_samples'])+' decoded_audio_sample_rate=16000 decoded_audio_seconds='+str(evidence['decoded_seconds'])+' decoder_exit_code='+str(evidence['decoder_exit_code'])+' capture_requested_seconds='+str(a.requested_seconds)+' decoded_audio_evidence_file='+os.path.basename(a.evidence_file)+' decoded_audio_evidence_sha256='+hashlib.sha256(raw).hexdigest()+' mean_volume_db='+str(evidence['mean_volume_db']))
 return 0 if evidence['verified'] else 2
if __name__=='__main__':sys.exit(main())
