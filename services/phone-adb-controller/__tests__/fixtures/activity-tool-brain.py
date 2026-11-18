def brain_invoke(c,key,kind,args):
 if kind=='brain':
  route=args[0];body=json.loads(args[1]) if len(args)>1 else None
  if body is not None:
   allowed=(key=='preflight' and route=='device-locks/acquire') or (key=='cleanup' and route=='device-locks/release')
   if not allowed or body.get('device_name')!=c['serial'] or body.get('locked_by')!=c['central_owner']:raise PreDispatchRejected()
   if route.endswith('release'):
    x=central(c)
    if body.get('expected_lease_version')!=x['lease_version']:raise ValueError('LEASE_CAS_REQUIRED')
  elif route!='device-locks':raise ValueError('BRAIN_READ_SCOPE')
  return {'exit_code':0,'data':brain(route,body)}
