"""Private, run-owned COS bridge. Original HK staging admission remains authoritative."""
import logging
import os
from pathlib import Path
import re
import signal
import shlex
import subprocess
import sys
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import urlopen


class DeliveryError(RuntimeError):
    """Only locally defined, secret-free stage codes may reach CI output."""


def absent(client, location):
    try:
        client.head_object(**location)
    except Exception as error:
        if getattr(error, 'get_status_code', lambda: None)() != 404:
            raise
        # COS HEAD has no error body. A missing bucket is not a deleted object.
        try:
            response = client.get_object(**location, Range='bytes=0-0')
        except Exception as read_error:
            if (getattr(read_error, 'get_status_code', lambda: None)() == 404
                    and getattr(read_error, 'get_error_code', lambda: None)() == 'NoSuchKey'):
                return True
            raise
        response['Body'].get_raw_stream().close()
    return False


def remote_command(original, size):
    # No URL in argv or environment. Download must finish before existing gates run.
    return '''set -euo pipefail
umask 077
TMP=$(mktemp -d /tmp/zj-cos.XXXXXXXX)
trap 'rm -rf "$TMP"' EXIT
AVAILABLE=$(df -Pk "$TMP" | awk 'NR==2 {print $4}')
[[ "$AVAILABLE" =~ ^[0-9]+$ ]] && (( AVAILABLE >= ''' + str((size + 536870912 + 1023) // 1024) + ''' )) || { echo 'COS_DOWNLOAD_DISK_FAILED' >&2; exit 41; }
curl --disable --fail --silent --proto '=https' --connect-timeout 30 --max-time 900 --config - --output "$TMP/image.tar.gz" 2>/dev/null || { echo 'COS_DOWNLOAD_FAILED' >&2; exit 42; }
''' + 'if ' + original + ' < "$TMP/image.tar.gz"; then :; else echo COS_ORIGINAL_GATE_FAILED >&2; exit 44; fi\n'


def deliver(client, archive, env, original, ssh, anonymous_open=urlopen, run=subprocess.run):
    bucket, region, sha, run_id, attempt = [env[key] for key in
        ('COS_BUCKET', 'COS_REGION', 'DEPLOY_SHA', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT')]
    for value, pattern in [(bucket, r'[a-z0-9][a-z0-9-]+-[0-9]+'), (region, r'[a-z]+-[a-z]+'),
                           (sha, r'[a-f0-9]{40}'), (run_id, r'[0-9]+'), (attempt, r'[0-9]+')]:
        if not re.fullmatch(pattern, value):
            raise ValueError('COS_IDENTITY_INVALID')
    size = archive.stat().st_size
    if not 0 < size < 5 * 1024**3:
        raise ValueError('COS_ARCHIVE_SIZE_INVALID')
    location = {'Bucket': bucket, 'Key': f'deploy/staging-api/{sha}/{run_id}-{attempt}/image.tar.gz'}
    # No version history or delete markers may survive this ephemeral transfer.
    if client.get_bucket_versioning(Bucket=bucket).get('Status'):
        raise DeliveryError('COS_VERSIONING_UNSUPPORTED')
    if not absent(client, location):
        raise DeliveryError('COS_OBJECT_ALREADY_EXISTS')
    phase = 'UPLOAD'
    try:
        with archive.open('rb') as body:
            client.put_object(**location, Body=body, ACL='private', EnableMD5=True, ContentLength=str(size))
        phase = 'UPLOAD_READBACK'
        if int(client.head_object(**location)['Content-Length']) != size:
            raise DeliveryError('COS_UPLOAD_SIZE_MISMATCH')
        phase = 'PRIVACY'
        host = f'{bucket}.cos.{region}.myqcloud.com'
        unsigned = f'https://{host}/{location["Key"]}'
        try:
            response = anonymous_open(unsigned, timeout=30)
        except HTTPError as error:
            status = error.code
            error.close()
            if status != 403:
                raise DeliveryError('COS_PRIVATE_ACCESS_UNVERIFIED') from None
        else:
            response.close()
            raise DeliveryError('COS_OBJECT_PUBLIC')
        # Sign only after upload and privacy readback, preserving the full TTL.
        phase = 'SIGN'
        url = client.get_presigned_download_url(**location, Expired=900)
        parsed = urlsplit(url)
        if (parsed.scheme != 'https' or parsed.netloc != host or parsed.path != '/' + location['Key']
                or not parsed.query or any(c in url for c in '\r\n"\\') or parsed.fragment):
            raise DeliveryError('COS_SIGNED_URL_INVALID')
        phase = 'REMOTE_TRANSPORT'
        try:
            run([*ssh, 'bash -c ' + shlex.quote(remote_command(original, size))], input=f'url = "{url}"\n', text=True, check=True)
        except subprocess.CalledProcessError as error:
            code = {41:'COS_DOWNLOAD_DISK_FAILED',42:'COS_DOWNLOAD_FAILED',44:'COS_ORIGINAL_GATE_FAILED'}.get(error.returncode,'COS_REMOTE_TRANSPORT_FAILED')
            raise DeliveryError(code) from None
    except DeliveryError:
        raise
    except Exception:
        raise DeliveryError(f'COS_{phase}_FAILED') from None
    finally:
        try:
            client.delete_object(**location)
            if not absent(client, location):
                raise DeliveryError('COS_OBJECT_STILL_PRESENT')
        except Exception:
            raise DeliveryError('COS_CLEANUP_UNVERIFIED') from None


def main():
    # SDK/HTTP exception text can contain signatures; expose only a fixed failure.
    logging.disable(logging.CRITICAL)
    signal.signal(signal.SIGTERM, lambda *_: (_ for _ in ()).throw(InterruptedError()))
    try:
        from qcloud_cos import CosConfig, CosS3Client
        archive, original, separator, *ssh = sys.argv[1:]
        if separator != '--' or not ssh or ssh[0] != 'ssh':
            raise ValueError('COS_ARGUMENTS_INVALID')
        client = CosS3Client(CosConfig(Region=os.environ['COS_REGION'],
            SecretId=os.environ['COS_SECRET_ID'], SecretKey=os.environ['COS_SECRET_KEY'],
            Scheme='https', Timeout=600))
        deliver(client, Path(archive), os.environ, original, ssh)
    except DeliveryError as error:
        print(str(error), file=sys.stderr)
        return 1
    except (Exception, KeyboardInterrupt):
        print('COS_SETUP_OR_INTERRUPTION_FAILED', file=sys.stderr)
        return 1
    print('COS_DELIVERY_VERIFIED_AND_OBJECT_REMOVED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
