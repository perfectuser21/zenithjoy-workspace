def main():
 c,key=context();kind,name,*args=sys.argv[1:]
 if not re.fullmatch('[A-Za-z0-9_-]{1,100}',name):raise ValueError('ACTION_NAME')
 task_authority(c);deadline=c['cleanup_deadline_ms'] if key=='cleanup' else c['business_deadline_ms']
 if time.time()*1000>=deadline:raise ValueError('ABSOLUTE_DEADLINE')
 root=P/'receipts';root.mkdir(exist_ok=True);action=root/(name+'.json')
 bind={'kind':kind,'args':args,'activity':key,'identity':c['tasks'][c['assigned_workflow']]}
 lock=open(root/'.tool.lock','a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if action.exists():
  prior=read(action)
  if prior['binding']!=bind:raise ValueError('ACTION_IDENTITY_CONFLICT')
  if prior['state']!='terminal':raise ValueError('ACTION_UNKNOWN_NO_REPLAY')
  print(json.dumps(prior,ensure_ascii=False));return prior['result']['exit_code']
 if any(read(p).get('state')=='unknown' for p in root.glob('*.json')) and kind not in {'fetch-native','proof','native-readback'} and not (kind=='phone' and args[0] in READ) and not outreach_recovery(c,kind,args):raise ValueError('PRIOR_ACTION_UNKNOWN')
 started_at=time.time();atomic(action,{'binding':bind,'state':'unknown','started_at':started_at})
 try:
  r=invoke(c,key,kind,args);result=r if isinstance(r,dict) else {'exit_code':r.returncode,'stdout':r.stdout,'stderr':r.stderr}
 except subprocess.TimeoutExpired as e:
  if kind!='fetch-native':raise ValueError('TOOL_TIMEOUT_UNKNOWN')
  # subprocess.run kills and waits for this local read-only downloader on timeout.
  # No device mutation ran; a partial local file is never a usable artifact.
  tail=lambda v:(v.decode('utf-8',errors='replace') if isinstance(v,bytes) else v or '')[-2000:]
  result={'exit_code':124,'error':'READ_ONLY_DOWNLOAD_TIMEOUT','artifact_usable':False,'stdout':tail(e.stdout),'stderr':tail(e.stderr),'timeout_seconds':e.timeout}
 except OSError as e:
  if kind!='fetch-native':raise
  result={'exit_code':74,'error':'READ_ONLY_DOWNLOAD_IO_ERROR','artifact_usable':False,'error_type':type(e).__name__}
 except Exception as e:
  if type(e) is PreDispatchRejected:
   return emit_pre_dispatch_rejection(e,action=action,binding=bind,started_at=started_at,persist=atomic)
  raise
 out={'binding':bind,'state':'terminal','started_at':started_at,'result':result,'ended_at':time.time()};atomic(action,out)
 encoded=json.dumps(out,ensure_ascii=False)
 print(encoded if len(encoded)<12000 else json.dumps({'state':'terminal','exit_code':result['exit_code'],'receipt':str(action),'large_result_saved':True,'stdout_preview':result.get('stdout','')[:1800],'stderr':result.get('stderr','')[-1200:]},ensure_ascii=False))
 return result['exit_code']
if __name__=='__main__':
 try:sys.exit(main())
 except Exception as e:print(json.dumps({'error':str(e) if isinstance(e,ValueError) else type(e).__name__}),file=sys.stderr);sys.exit(2)
