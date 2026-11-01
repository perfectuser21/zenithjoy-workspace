from datetime import datetime
from email.utils import parsedate_to_datetime
from urllib.request import urlopen

CENTRAL_BRAIN = 'http://100.79.41.61:5221'


def live_central_lease(config):
    if config['binding'].get('remoteBrainBaseUrl') != CENTRAL_BRAIN: raise ValueError('CENTRAL_BRAIN_AUTHORITY_UNVERIFIED')
    remaining = config['deadline'] - time.monotonic()
    if remaining < 12: raise ValueError('CENTRAL_BRAIN_BUDGET_EXHAUSTED')
    started = time.monotonic()
    url = CENTRAL_BRAIN + '/api/brain/device-locks'
    try:
        with urlopen(url, timeout=min(10,remaining-1)) as response:
            if getattr(response,'status',200) != 200 or (hasattr(response,'geturl') and response.geturl()!=url): raise ValueError('CENTRAL_BRAIN_RESPONSE_UNTRUSTED')
            date = response.headers.get('Date')
            raw = response.read(1_000_001)
            if len(raw)>1_000_000: raise ValueError('CENTRAL_BRAIN_RESPONSE_OVERSIZED')
            data = json.loads(raw)
        elapsed = time.monotonic()-started
        records = [x for x in data.get('locks',[]) if isinstance(x,dict) and x.get('device_name')==config['binding']['serial']]
        if data.get('success') is not True or len(records)!=1: raise ValueError('CENTRAL_LOCK_RECORD_UNCONFIRMED')
        record = records[0]
        server = parsedate_to_datetime(date)
        expires = datetime.fromisoformat(record['expires_at'].replace('Z','+00:00'))
        if server.tzinfo is None or expires.tzinfo is None: raise ValueError('CENTRAL_CLOCK_UNCONFIRMED')
        lifetime = expires.timestamp()-server.timestamp()-elapsed-1
        required = max(0,config['deadline']-time.monotonic())+10
        if record.get('locked_by')!=config['owner'] or record.get('expired') is not False or lifetime<required: raise ValueError('CENTRAL_LEASE_UNSAFE')
    except Exception as cause:
        if isinstance(cause,ValueError) and str(cause).startswith('CENTRAL_'): raise
        raise ValueError('CENTRAL_LEASE_READ_UNCONFIRMED') from cause
    proof = {'record':record,'serverDate':date,'networkElapsedSeconds':elapsed,'remainingSeconds':lifetime,'requiredSeconds':required,'at':time.time()}
    config.setdefault('centralLeaseTrace',[]).append(proof)
    store(Path(config['remoteRoot'])/'config.json',config)
    return proof


def guarded_host_operation(config,request,operation):
    held(config)
    result = control_ok(config,'lock-status',[],request['jobId']+'-gate-status')
    match = re.fullmatch(r'lock=held owner=(\S+) age=(\d+)s stale=false reclaimable=false ttl=(\d+)s\s*',result['stdout'].strip())
    if not match or match[1]!=config['owner'] or int(match[3])-int(match[2])<max(1010,config['deadline']-time.monotonic()+10): raise ValueError('CENTRAL_CONTROLLER_LEASE_UNSAFE')
    control_ok(config,'lock-refresh',[config['owner']],request['jobId']+'-gate-renew')
    held(config)
    proof=live_central_lease(config)
    held(config)
    if config['deadline']-time.monotonic()<1: raise ValueError('CENTRAL_BRAIN_BUDGET_EXHAUSTED')
    result=operation()
    if isinstance(result,dict): result['leaseProof']=proof
    return result
