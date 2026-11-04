"""Real bootstrap subprocess + real temporary Git objects; transport failures are isolated."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

BOOTSTRAP = Path(__file__).with_name('bootstrap.py')
if not BOOTSTRAP.exists():
    BOOTSTRAP = Path(__file__).resolve().parents[1] / 'skills-source.py'

class BootstrapFetchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='skills-fetch-contract-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace'
        self.workspace.mkdir()
        self.origin = self.root / 'origin'
        (self.origin / 'distribution').mkdir(parents=True)
        self.loader = self.origin / 'distribution/skills_source.py'
        # This is the downstream process boundary, not a copy of bootstrap/fetch logic.
        self.loader.write_text("import pathlib,sys\nw=pathlib.Path(sys.argv[sys.argv.index('--workspace')+1])\n(w/'loader-called').write_text(sys.argv[1])\nif sys.argv[1]=='verify' and (w/'force-verify-failure').exists():\n print('fixture verify rejected changed content',file=sys.stderr);sys.exit(9)\nprint('fixture downstream loader completed')\n")
        self.git = shutil.which('git')
        subprocess.run([self.git, 'init', '-q', str(self.origin)], check=True)
        subprocess.run([self.git, '-C', str(self.origin), 'add', '.'], check=True)
        subprocess.run([self.git, '-C', str(self.origin), '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture source'], check=True)
        self.revision = subprocess.check_output([self.git, '-C', str(self.origin), 'rev-parse', 'HEAD'], text=True).strip()
        self.lock = {'repository':'perfectuser21/zenithjoy-skills','revision':self.revision,'profile':'fixture','loader_sha256':hashlib.sha256(self.loader.read_bytes()).hexdigest()}
        self.write_lock()
        self.log = self.root / 'fetch.jsonl'
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        wrapper = self.bin / 'git'
        wrapper.write_text('''#!'''+sys.executable+'''
import hashlib,json,os,pathlib,shlex,stat,subprocess,sys,time
args=sys.argv[1:]
if 'fetch' not in args: os.execv(os.environ['FIXTURE_REAL_GIT'],['git',*args])
log=pathlib.Path(os.environ['FIXTURE_FETCH_LOG']);previous=log.read_text().splitlines() if log.exists() else []
ssh=os.environ.get('GIT_SSH_COMMAND','');parts=shlex.split(ssh);identity=parts[parts.index('-i')+1] if '-i' in parts else None
entry={'args':args,'ssh':ssh,'identity_sha256':hashlib.sha256(pathlib.Path(identity).read_bytes()).hexdigest() if identity else None,'identity_mode':stat.S_IMODE(pathlib.Path(identity).stat().st_mode) if identity else None,'key_env_present':'SKILLS_SOURCE_SSH_KEY' in os.environ}
with log.open('a') as out:out.write(json.dumps(entry)+'\\n')
time.sleep(float(os.environ.get('FIXTURE_FETCH_SLEEP','0')))
if len(previous)<int(os.environ['FIXTURE_FETCH_FAILURES']):
 print(os.environ['FIXTURE_FETCH_ERROR'],file=sys.stderr);sys.exit(128)
index=args.index('fetch');args[index+3]=os.environ['FIXTURE_SOURCE']
os.execv(os.environ['FIXTURE_REAL_GIT'],['git',*args])
''')
        wrapper.chmod(0o755)
        self.identity = self.root / 'fixture-identity'
        subprocess.run(['ssh-keygen','-q','-t','ed25519','-N','','-C','fixture-local-only','-f',str(self.identity)],check=True,stdin=subprocess.DEVNULL,timeout=5,capture_output=True)
        self.private_lines = self.identity.read_text().splitlines()
        self.key = self.identity.read_text().replace('\n','\r\n').rstrip('\r\n')
        self.fingerprint = subprocess.check_output(['ssh-keygen','-l','-E','sha256','-f',str(self.identity)+'.pub'],text=True,timeout=5).split()[1]
        self.env = {**os.environ,'PATH':str(self.bin)+os.pathsep+os.environ['PATH'],'SKILLS_SOURCE_SSH_KEY':self.key,'FIXTURE_REAL_GIT':self.git,'FIXTURE_SOURCE':str(self.origin),'FIXTURE_FETCH_LOG':str(self.log),'FIXTURE_FETCH_FAILURES':'0','FIXTURE_FETCH_ERROR':'git@github.com: Permission denied (publickey).'}

    def write_lock(self):
        (self.workspace / '.skills-source.json').write_text(json.dumps(self.lock))

    def run_bootstrap(self, command='install'):
        return subprocess.run([sys.executable,str(BOOTSTRAP),command,'--workspace',str(self.workspace)],env=self.env,capture_output=True,text=True,timeout=25)

    def attempts(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def test_two_publickey_failures_then_success_use_same_revision_identity_and_no_other_credentials(self):
        self.env['FIXTURE_FETCH_FAILURES']='2'
        result=self.run_bootstrap()
        self.assertEqual(result.returncode,0,result.stderr)
        attempts=self.attempts();self.assertEqual(len(attempts),3)
        for attempt in attempts:
            self.assertEqual(attempt['args'][-1],self.revision)
            self.assertEqual(attempt['args'][-2],'git@github.com:perfectuser21/zenithjoy-skills.git')
            self.assertFalse(attempt['key_env_present'])
            self.assertEqual(attempt['identity_mode'],0o600)
            for option in ['-F /dev/null','IdentitiesOnly=yes','IdentityAgent=none','BatchMode=yes','ConnectTimeout=10','ConnectionAttempts=1','StrictHostKeyChecking=yes']:
                self.assertIn(option,attempt['ssh'])
        self.assertEqual(len({a['ssh'] for a in attempts}),1)
        expected=hashlib.sha256((self.key.replace('\r\n','\n').rstrip()+'\n').encode()).hexdigest()
        self.assertEqual({a['identity_sha256'] for a in attempts},{expected})
        for secret_line in self.private_lines:
            self.assertNotIn(secret_line,result.stdout+result.stderr)
        self.assertNotIn(self.identity.with_suffix('.pub').read_text().split()[1],result.stdout+result.stderr)
        metadata='skill source identity type=ssh-ed25519 fingerprint='+self.fingerprint
        self.assertEqual(result.stderr.count(metadata),1)
        self.assertLess(result.stderr.index(metadata),result.stderr.index('fetch attempt'))
        self.assertEqual((self.workspace/'loader-called').read_text(),'install')

    def test_auth_retry_exhaustion_stays_fatal_and_preserves_original_error(self):
        self.env['FIXTURE_FETCH_FAILURES']='99'
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0)
        self.assertEqual(len(self.attempts()),3)
        self.assertIn('Permission denied (publickey)',result.stderr)
        self.assertFalse((self.workspace/'loader-called').exists())

    def test_identity_format_error_is_permanent_and_is_not_retried(self):
        self.env.update(FIXTURE_FETCH_FAILURES='99',FIXTURE_FETCH_ERROR='Load key "fixture": invalid format')
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),1)
        self.assertIn('invalid format',result.stderr)

    def test_repository_permission_error_is_permanent_and_not_retried(self):
        self.env.update(FIXTURE_FETCH_FAILURES='99',FIXTURE_FETCH_ERROR='ERROR: Repository not found.')
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),1)
        self.assertIn('Repository not found',result.stderr)

    def test_missing_key_fails_before_network_without_https_or_other_credential_fallback(self):
        self.env.pop('SKILLS_SOURCE_SSH_KEY')
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(self.attempts(),[])
        self.assertIn('SKILLS_SOURCE_SSH_KEY',result.stderr)

    def test_malformed_revision_fails_before_network(self):
        self.lock['revision']='not-a-complete-sha';self.write_lock()
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(self.attempts(),[])

    def test_unknown_fixed_revision_remains_fatal_without_retrying_different_refs(self):
        self.lock['revision']='0'*40;self.write_lock()
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),1)
        self.assertEqual(self.attempts()[0]['args'][-1],'0'*40)

    def test_downstream_verify_failure_is_fatal_and_does_not_retry_fetch_or_install(self):
        (self.workspace/'force-verify-failure').touch()
        result=self.run_bootstrap('verify');self.assertNotEqual(result.returncode,0)
        self.assertEqual(len(self.attempts()),1)
        self.assertEqual((self.workspace/'loader-called').read_text(),'verify')
        self.assertIn('fixture verify rejected changed content',result.stderr)

    def test_cached_fixed_object_does_not_require_network_or_a_key(self):
        subprocess.run([self.git,'clone','-q',str(self.origin),str(self.workspace/'.skills-source')],check=True)
        self.env.pop('SKILLS_SOURCE_SSH_KEY')
        result=self.run_bootstrap();self.assertEqual(result.returncode,0,result.stderr);self.assertEqual(self.attempts(),[])

    def test_git_error_cannot_echo_private_identity_content(self):
        self.env.update(FIXTURE_FETCH_FAILURES='99',FIXTURE_FETCH_ERROR='invalid format '+self.private_lines[1])
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0)
        self.assertIn('invalid format',result.stderr)
        for secret_line in self.private_lines:self.assertNotIn(secret_line,result.stdout+result.stderr)

    def test_process_deadline_retries_are_bounded_and_remain_fatal(self):
        self.env['FIXTURE_FETCH_SLEEP']='2'
        launcher=self.root/'deadline-test.py'
        # Override only the duration in this isolated process; execute the actual
        # production timeout and retry code against real sleeping child processes.
        launcher.write_text("import importlib.util\ns=importlib.util.spec_from_file_location('candidate',"+repr(str(BOOTSTRAP))+" )\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.FETCH_TIMEOUT_SECONDS=0.5;m.FETCH_RETRY_DELAYS=(0,0)\nm.main()\n")
        result=subprocess.run([sys.executable,str(launcher),'install','--workspace',str(self.workspace)],env=self.env,capture_output=True,text=True,timeout=8)
        self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),3)
        self.assertIn('transport_timeout',result.stderr);self.assertIn('timed out',result.stderr)
        self.assertFalse((self.workspace/'loader-called').exists())

    def test_identity_diagnostic_failure_does_not_swallow_fetch_failure_or_leak_its_output(self):
        keygen=self.bin/'ssh-keygen'
        keygen.write_text('#!'+sys.executable+'\nimport sys\nprint('+repr(self.private_lines[1])+',file=sys.stderr);sys.exit(1)\n')
        keygen.chmod(0o755)
        self.env['FIXTURE_FETCH_FAILURES']='99'
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),3)
        self.assertIn('identity diagnostic unavailable',result.stderr)
        self.assertIn('Permission denied (publickey)',result.stderr)
        for secret_line in self.private_lines:self.assertNotIn(secret_line,result.stdout+result.stderr)

    def test_identity_diagnostic_failure_does_not_swallow_downstream_verify_failure(self):
        keygen=self.bin/'ssh-keygen';keygen.write_text('#!/bin/sh\nexit 1\n');keygen.chmod(0o755)
        (self.workspace/'force-verify-failure').touch()
        result=self.run_bootstrap('verify');self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),1)
        self.assertIn('fixture verify rejected changed content',result.stderr)

    def test_identity_diagnostic_is_noninteractive_and_has_a_real_deadline(self):
        keygen=self.bin/'ssh-keygen'
        keygen.write_text('#!'+sys.executable+'\nimport json,pathlib,sys,time\npathlib.Path('+repr(str(self.root/'keygen-args'))+').write_text(json.dumps(sys.argv[1:]))\nassert sys.stdin.read()==""\ntime.sleep(8)\n')
        keygen.chmod(0o755)
        self.env.update(FIXTURE_FETCH_FAILURES='99',FIXTURE_FETCH_ERROR='Repository not found.')
        import time
        start=time.monotonic();result=self.run_bootstrap();elapsed=time.monotonic()-start
        self.assertNotEqual(result.returncode,0);self.assertLess(elapsed,7)
        args=json.loads((self.root/'keygen-args').read_text())
        self.assertEqual(args[:3],['-y','-P','']);self.assertEqual(args[3],'-f')
        self.assertEqual(len(self.attempts()),1)
        self.assertIn('identity diagnostic unavailable',result.stderr)
        self.assertIn('Repository not found.',result.stderr)

    def test_loader_checksum_failure_is_fatal_after_one_fetch(self):
        self.lock['loader_sha256']='0'*64;self.write_lock()
        result=self.run_bootstrap();self.assertNotEqual(result.returncode,0);self.assertEqual(len(self.attempts()),1)
        self.assertIn('loader checksum mismatch',result.stderr)
        self.assertFalse((self.workspace/'loader-called').exists())

if __name__=='__main__':
    unittest.main()
