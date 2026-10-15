"""只扩纯读取截图预算；写动作预算、一次执行和进程回收不变。"""
from pathlib import Path
import signal
import subprocess
import sys
import unittest
from unittest.mock import Mock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class ReadBudgetTests(unittest.TestCase):
    def phone(self):
        from phone_read_budget import screenshot_phone
        class BasePhone:
            adb, serial, timeout = 'approved-adb', 'cloud-serial', 15
            def __init__(self): self.owner_checks = 0; self.writes = []
            def require_owner(self): self.owner_checks += 1
            def run(self, *args):
                self.writes.append((args, self.timeout))
                raise subprocess.TimeoutExpired(args, self.timeout)
        return screenshot_phone(BasePhone)()

    def test_read_taking_more_than_fifteen_seconds_finishes_with_45_budget(self):
        phone = self.phone(); process = Mock(pid=7, returncode=0)
        def communicate(timeout):
            if timeout < 16: raise subprocess.TimeoutExpired('screencap', timeout)
            return b'raw-full-resolution-png', b''
        process.communicate.side_effect = communicate
        with patch('phone_read_budget.subprocess.Popen', return_value=process) as popen:
            self.assertEqual(phone.run('exec-out', 'screencap', '-p'), b'raw-full-resolution-png')
        self.assertEqual(process.communicate.call_args.kwargs['timeout'], 45)
        self.assertEqual(popen.call_count, 1)
        self.assertEqual(phone.owner_checks, 2)
        self.assertEqual(phone.timeout, 15)

    def test_read_exceeding_45_seconds_kills_and_reaps_once_without_retry(self):
        phone = self.phone(); process = Mock(pid=7123)
        process.communicate.side_effect = [subprocess.TimeoutExpired('screencap', 45), (b'', b'')]
        with patch('phone_read_budget.subprocess.Popen', return_value=process) as popen, patch('phone_read_budget.os.killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired): phone.run('exec-out', 'screencap', '-p')
        kill.assert_called_once_with(7123, signal.SIGKILL)
        self.assertEqual([c.kwargs['timeout'] for c in process.communicate.call_args_list], [45, 2])
        self.assertEqual(popen.call_count, 1)

    def test_writes_and_non_exact_read_variants_keep_15_and_no_retry(self):
        for args in [('shell', 'input', 'tap', '1', '2'), ('shell', 'input', 'text', 'hello'),
                     ('shell', 'am', 'broadcast', '-a', 'ADB_INPUT_B64'),
                     ('exec-out', 'screencap', '-p', '/sdcard/x.png'),
                     ('shell', 'screencap', '-p'), ('shell', 'dumpsys', 'window')]:
            with self.subTest(args=args):
                phone = self.phone()
                with self.assertRaises(subprocess.TimeoutExpired) as error: phone.run(*args)
                self.assertEqual(error.exception.timeout, 15)
                self.assertEqual(phone.writes, [(args, 15)])

    def test_owner_failure_prevents_starting_read_process(self):
        phone = self.phone(); phone.require_owner = Mock(side_effect=ValueError('wrong_owner'))
        with patch('phone_read_budget.subprocess.Popen') as popen:
            with self.assertRaises(ValueError): phone.run('exec-out', 'screencap', '-p')
        popen.assert_not_called()

    def test_load_phone_installs_budget_without_changing_base_timeout(self):
        import tempfile
        from watcher import load_phone
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'approved_phone.py'
            path.write_text('class Phone:\n'
                ' def __init__(self,serial,owner,evidence_dir,lock_root,adb,timeout):\n'
                '  self.serial,self.adb,self.timeout=serial,adb,timeout\n'
                ' def require_owner(self): pass\n'
                ' def run(self,*args): return self.timeout\n')
            phone = load_phone(dict(phone_module=str(path),serial='47.100.213.173:10001',
                owner='test',evidence_root=directory,adb='approved-adb'))
            self.assertEqual(phone.run('shell','input','tap','1','2'),15)
            process=Mock(pid=7,returncode=0);process.communicate.return_value=(b'PNG',b'')
            with patch('phone_read_budget.subprocess.Popen',return_value=process):
                self.assertEqual(phone.run('exec-out','screencap','-p'),b'PNG')
            self.assertEqual(process.communicate.call_args.kwargs['timeout'],45)
