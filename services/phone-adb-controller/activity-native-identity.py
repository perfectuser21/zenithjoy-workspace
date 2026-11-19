"""Native receipt/URL identity reader; no business acceptance."""
import hashlib,json,re,sys
from pathlib import Path
import xml.etree.ElementTree as ET

def asset(spec):
    p = Path(spec['path'])
    if not p.is_absolute() or not p.is_file() or p.is_symlink():
        raise ValueError('ASSET_PATH_UNVERIFIED')
    if p.stat().st_size > 30 * 1024 * 1024:
        raise ValueError('ASSET_TOO_LARGE')
    raw = p.read_bytes()
    if hashlib.sha256(raw).hexdigest() != spec.get('sha256'):
        raise ValueError('ASSET_HASH_MISMATCH')
    return p, raw


def json_asset(spec):
    return json.loads(asset(spec)[1])


def fields(receipt):
    if receipt.get('exit_code') != 0:
        raise ValueError('NATIVE_OPERATION_NOT_SUCCESSFUL')
    return dict(re.findall(r'([A-Za-z_][A-Za-z_0-9]*)=([^\s]+)', receipt.get('stdout', '')))


def resolve_short_head(url):
    import urllib.request
    import urllib.error
    from urllib.parse import urlparse
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None
    opener=urllib.request.build_opener(NoRedirect)
    for _ in range(2):
        if not re.fullmatch(r'https://v\.douyin\.com/[A-Za-z0-9_-]+/?',url):
            raise ValueError('UNTRUSTED_NATIVE_SHORT_LINK')
        try:
            response=opener.open(urllib.request.Request(url,method='HEAD',headers={'User-Agent':'Mozilla/5.0'}),timeout=10)
        except urllib.error.HTTPError as response:
            code=response.code;location=response.headers.get('Location','')
        else:
            code=response.status;location=response.headers.get('Location','');response.close()
        if not 300<=code<400:raise ValueError('NATIVE_SHORT_LINK_HTTP')
        parsed=urlparse(location)
        if parsed.scheme!='https' or parsed.netloc not in ('v.douyin.com','www.douyin.com','www.iesdouyin.com'):
            raise ValueError('UNTRUSTED_NATIVE_REDIRECT')
        match=re.fullmatch(r'/(?:share/)?video/(\d{16,24})/?',parsed.path)
        if match:return match.group(1)
        url=location
    raise ValueError('NATIVE_SHORT_LINK_ID_MISSING')


def native_video_identity(spec,resolve=resolve_short_head):
    receipt=json_asset(spec['video_identity']);args=receipt.get('args',[])
    if len(args)!=2 or args[0]!='current-video-link' or not args[1].startswith(spec['expected_run']+'-'):
        raise ValueError('NATIVE_LINK_REQUEST_SCOPE')
    if receipt.get('exit_code')==0:
        ids=set(re.findall(r'https://www\.douyin\.com/video/(\d{16,24})',receipt.get('stdout','')))
        return ids=={spec['video_id']}
    if 'LINK_RESOLVE_DNS' not in receipt.get('stderr','') and 'LINK_RESOLVE_NETWORK' not in receipt.get('stderr',''):
        raise ValueError('NATIVE_LINK_FAILURE_NOT_RESOLVABLE')
    file,raw=asset(spec['video_identity_scratch'])
    if file.name!=args[1]+'-t1-scratch-result.xml':raise ValueError('NATIVE_LINK_ORIGINAL_SCOPE')
    values=[v for node in ET.fromstring(raw).iter('node') for v in [node.get('text',''),node.get('content-desc','')]]
    links=set(re.findall(r'https://v\.douyin\.com/[A-Za-z0-9_-]+/?','\n'.join(values)))
    if len(links)!=1:raise ValueError('NATIVE_LINK_AMBIGUOUS')
    return resolve(next(iter(links)))==spec['video_id']


