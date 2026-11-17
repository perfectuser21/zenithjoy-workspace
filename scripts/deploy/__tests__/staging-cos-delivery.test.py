import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock
from urllib.error import HTTPError

spec = importlib.util.spec_from_file_location('delivery', Path(__file__).parents[1] / 'staging-cos-delivery.py')
delivery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(delivery)

class CosError(Exception):
    def __init__(self, code, status=404): self.code, self.status = code, status
    def get_status_code(self): return self.status
    def get_error_code(self): return self.code

class FakeCos:
    def __init__(self):
        self.present = False
        self.calls = []
        self.version = {}
        self.failure = None
    def get_bucket_versioning(self, **kw): return self.version
    def head_object(self, **kw):
        if not self.present: raise CosError('NoSuchResource')
        return {'Content-Length': str(self.size)}
    def get_object(self, **kw): raise CosError('NoSuchKey')
    def put_object(self, **kw):
        self.calls.append(('put', kw.copy()))
        self.size = len(kw['Body'].read()); self.present = True
        if self.failure == 'upload': raise RuntimeError('SECRET_URL')
        return {}
    def get_presigned_download_url(self, **kw):
        self.calls.append(('sign', kw)); return 'https://private-123.cos.ap-hongkong.myqcloud.com/' + kw['Key'] + '?q-signature=SECRET_URL'
    def delete_object(self, **kw):
        self.calls.append(('delete', kw))
        if self.failure == 'delete': raise RuntimeError('SECRET_URL')
        self.present = False

def denied(*args, **kw): raise HTTPError(args[0], 403, 'Forbidden', {}, None)

class DeliveryTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.archive = Path(self.tmp.name) / 'image.tar.gz'; self.archive.write_bytes(b'gzip-fixture')
        self.cos = FakeCos()
        self.env = {'COS_BUCKET':'private-123','COS_REGION':'ap-hongkong','DEPLOY_SHA':'a'*40,'GITHUB_RUN_ID':'123','GITHUB_RUN_ATTEMPT':'2'}
        self.run = Mock(return_value=subprocess.CompletedProcess([],0))
    def execute(self, anonymous=denied):
        return delivery.deliver(self.cos, self.archive, self.env, 'bash /tmp/zj-staging.ABC ' + 'a'*40, ['ssh','root@hk'], anonymous_open=anonymous, run=self.run)
    def test_success_private_unique_immediate_signature_and_cleanup(self):
        self.execute()
        put, sign, delete = self.cos.calls
        self.assertEqual(put[1]['ACL'], 'private'); self.assertTrue(put[1]['EnableMD5'])
        self.assertEqual(put[1]['Key'], 'deploy/staging-api/'+'a'*40+'/123-2/image.tar.gz')
        self.assertEqual(delete[1]['Key'], put[1]['Key']); self.assertEqual(sign[1]['Expired'],900)
        args, kw = self.run.call_args
        self.assertNotIn('SECRET_URL', str(args)); self.assertIn('SECRET_URL',kw['input'])
        self.assertFalse(self.cos.present)
    def test_upload_failure_still_cleans_owned_object(self):
        self.cos.failure='upload'
        with self.assertRaises(Exception): self.execute()
        self.assertFalse(self.cos.present); self.run.assert_not_called()
    def test_remote_failure_is_not_success_and_cleans(self):
        self.run.side_effect=subprocess.CalledProcessError(22,['ssh'])
        with self.assertRaises(Exception): self.execute()
        self.assertFalse(self.cos.present)
    def test_public_object_never_downloads(self):
        with self.assertRaises(Exception): self.execute(Mock())
        self.run.assert_not_called(); self.assertFalse(self.cos.present)
    def test_anonymous_404_does_not_prove_private(self):
        def missing(*args,**kw): raise HTTPError(args[0],404,'Missing',{},None)
        with self.assertRaises(Exception): self.execute(missing)
        self.run.assert_not_called(); self.assertFalse(self.cos.present)
    def test_versioned_bucket_refused_before_upload(self):
        for status in ['Enabled','Suspended']:
            self.cos.version={'Status':status}
            with self.assertRaises(Exception): self.execute()
            self.assertEqual(self.cos.calls,[])
    def test_existing_object_never_deleted(self):
        self.cos.present=True; self.cos.size=5
        with self.assertRaises(Exception): self.execute()
        self.assertEqual(self.cos.calls,[]); self.assertTrue(self.cos.present)
    def test_missing_bucket_not_absence(self):
        self.cos.get_object=Mock(side_effect=CosError('NoSuchBucket'))
        with self.assertRaises(Exception): self.execute()
        self.assertEqual(self.cos.calls,[])
    def test_cleanup_failure_fails_closed(self):
        self.cos.failure='delete'
        with self.assertRaisesRegex(Exception,'CLEANUP'): self.execute()
    def test_invalid_identity_never_uploads(self):
        self.env['GITHUB_RUN_ID']='1; echo BAD'
        with self.assertRaises(Exception): self.execute()
        self.assertEqual(self.cos.calls,[])
    def test_signed_url_host_or_config_injection_refused(self):
        for url in ['https://evil.invalid/key?secret=1','https://private-123.cos.ap-hongkong.myqcloud.com/key\noutput=/tmp/bad']:
            self.cos.get_presigned_download_url=Mock(return_value=url)
            with self.assertRaises(Exception): self.execute()
            self.run.assert_not_called(); self.assertFalse(self.cos.present)
    def test_remote_complete_download_before_original_gate(self):
        root=Path(self.tmp.name); bin_dir=root/'bin';bin_dir.mkdir()
        curl=bin_dir/'curl'
        curl.write_text('#!/usr/bin/env python3\nimport os,sys\nfrom pathlib import Path\na=sys.argv[1:];Path(os.environ["CURL_ARGS"]).write_text(repr(a));Path(os.environ["CURL_INPUT"]).write_text(sys.stdin.read());Path(a[a.index("--output")+1]).write_bytes(b"original-gzip");sys.exit(int(os.environ.get("FAIL_CURL","0")))\n');curl.chmod(0o755)
        original=root/'original.sh';output=root/'delivered'
        original.write_text('#!/bin/bash\ncat > "$DELIVERED"\n');original.chmod(0o755)
        command=delivery.remote_command('bash '+str(original), 32)
        env={**os.environ,'PATH':str(bin_dir)+':'+os.environ['PATH'],'CURL_ARGS':str(root/'args'),'CURL_INPUT':str(root/'config'),'DELIVERED':str(output)}
        for fail in ['22','0']:
            r=subprocess.run(['bash','-c',command],input='url = "https://private.invalid/?SECRET_URL"\n',text=True,capture_output=True,env={**env,'FAIL_CURL':fail})
            self.assertEqual(r.returncode==0,fail=='0',r.stderr)
            self.assertNotIn('SECRET_URL',(root/'args').read_text()+r.stderr+r.stdout)
            self.assertEqual(output.exists(),fail=='0')
        self.assertEqual(output.read_bytes(),b'original-gzip')

if __name__ == '__main__': unittest.main()
