"""Sanitized structural replay; never connects to a device."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from wechat_phone import Phone, Refused

POPUP = '''  Session Session{abc 123:u0a10322}:
    mPackageName=com.tencent.mm
  Window #0 Window{aaa u0 PopupWindow:bbb}:
    mDisplayId=0 rootTaskId=1653 mSession=Session{abc 123:u0a10322}
    mOwnerUid=10322 package=com.tencent.mm appop=NONE
    mAttrs={ty=APPLICATION_PANEL}
    mParentWindow=Window{ccc u0 com.tencent.mm/com.tencent.mm.ui.LauncherUI} mLayoutAttached=true
    mHasSurface=true isReadyForDisplay()=true
    isOnScreen=true
    isVisible=true
  Window #1 Window{ddd u0 InputMethod}:
    mOwnerUid=10188 package=com.sohu.inputmethod.sogou appop=NONE
    mAttrs={ty=INPUT_METHOD}
  Window #2 Window{ccc u0 com.tencent.mm/com.tencent.mm.ui.LauncherUI}:
    mDisplayId=0 rootTaskId=1653 mSession=Session{abc 123:u0a10322}
    mOwnerUid=10322 package=com.tencent.mm appop=NONE
    mAttrs={ty=BASE_APPLICATION}
    mHasSurface=true isReadyForDisplay()=true
    isOnScreen=true
    isVisible=true
  mCurrentFocus=Window{aaa u0 PopupWindow:bbb}
  mFocusedApp=ActivityRecord{fff u0 com.tencent.mm/.ui.LauncherUI t1653}
'''
TOP='topResumedActivity=ActivityRecord{fff u0 com.tencent.mm/.ui.LauncherUI t1653}'

class PopupTests(unittest.TestCase):
    def phone(self, raw=POPUP, top=TOP):
        p=Phone('SERIAL','owner','/tmp/evidence','/tmp/locks')
        p.shell=Mock(side_effect=lambda *args: raw if args==('dumpsys','window') else top)
        return p

    def test_owned_popup_replay(self):
        self.assertEqual(self.phone().foreground(), {'package':'com.tencent.mm','activity':'com.tencent.mm.ui.LauncherUI'})

    def test_foreign_missing_ambiguous_or_conflicting_proof_refused(self):
        variants=[
            POPUP.replace('mOwnerUid=10322','mOwnerUid=10188',1),
            POPUP.replace('mOwnerUid=10322 package=com.tencent.mm','package=com.tencent.mm',1),
            POPUP.replace('package=com.tencent.mm appop=NONE','package=foreign.app appop=NONE',1),
            POPUP.replace('ty=APPLICATION_PANEL','ty=INPUT_METHOD'),
            POPUP.replace('ty=APPLICATION_PANEL','ty=APPLICATION_OVERLAY'),
            POPUP.replace('ty=BASE_APPLICATION','ty=APPLICATION_PANEL'),
            POPUP.replace('mLayoutAttached=true','mLayoutAttached=false'),
            POPUP.replace('isVisible=true','isVisible=false',1),
            POPUP.replace('isOnScreen=true','isOnScreen=false',1),
            POPUP.replace('isReadyForDisplay()=true','isReadyForDisplay()=false',1),
            POPUP.replace('mHasSurface=true','mHasSurface=false',1),
            POPUP.replace('rootTaskId=1653','rootTaskId=99',1),
            POPUP.replace('mDisplayId=0','mDisplayId=1',1),
            POPUP.replace('mSession=Session{abc 123:u0a10322}','mSession=Session{zzz 123:u0a10322}',1),
            POPUP.replace('mPackageName=com.tencent.mm','mPackageName=foreign.app'),
            POPUP.replace('mPackageName=com.tencent.mm','mPackageName=com.android.systemui'),
            POPUP.replace('mPackageName=com.tencent.mm',''),
            POPUP.replace('Window #0 Window{aaa u0','Window #0 Window{aaa u1'),
            POPUP.replace('mCurrentFocus=Window{aaa u0','mCurrentFocus=Window{aaa u1'),
            POPUP.replace('mFocusedApp=ActivityRecord{fff u0','mFocusedApp=ActivityRecord{fff u1'),
            POPUP.replace('mFocusedApp=ActivityRecord{fff u0 com.tencent.mm/.ui.LauncherUI t1653}','mFocusedApp=null'),
            POPUP.replace('com.tencent.mm/com.tencent.mm.ui.LauncherUI','com.tencent.mm/com.tencent.mm.plugin.sns.ui.SnsUploadUI'),
            POPUP + 'mCurrentFocus=Window{eee u0 com.tencent.mm/.ui.LauncherUI}\n',
            POPUP + 'mCurrentFocus=Window{aaa u0 PopupWindow:bbb}\n',
            POPUP.replace('  Window #1', '  Window #4 Window{aaa u0 PopupWindow:bbb}:\n    mOwnerUid=10322 package=com.tencent.mm\n  Window #1'),
        ]
        for raw in variants:
            with self.subTest(raw=raw), self.assertRaises(Refused): self.phone(raw).foreground()
        for top in ('',TOP+'\n'+TOP,TOP.replace('u0','u1'),TOP.replace('t1653','t99'),TOP.replace('com.tencent.mm','foreign.app')):
            with self.subTest(top=top), self.assertRaises(Refused): self.phone(top=top).foreground()

    def test_normal_activity_plus_extra_popup_focus_is_ambiguous(self):
        raw='mCurrentFocus=Window{a u0 com.tencent.mm/.ui.LauncherUI}\nmCurrentFocus=Window{b u0 PopupWindow:c}'
        with self.assertRaises(Refused): self.phone(raw).foreground()

    def test_call_lock_and_foreign_write_guards_still_refuse(self):
        for call,lock,fg in [('mCallState=1','showing=false','com.tencent.mm'),('','showing=false','com.tencent.mm'),('mCallState=0','showing=true','com.tencent.mm'),('mCallState=0','','com.tencent.mm'),('mCallState=0','showing=false','foreign.app')]:
            p=self.phone();p.shell=Mock(side_effect=[call,lock]);p.foreground=Mock(return_value={'package':fg,'activity':'.Main'})
            with self.subTest(call=call,lock=lock,fg=fg), self.assertRaises(Refused): p.require_safe_write()

    def test_missing_or_different_lock_owner_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Phone('SERIAL','owner',d,d)
            with self.assertRaisesRegex(Refused,'lock_not_held'):p.require_owner()
            owner=Path(d)/'SERIAL.lock'/'owner';owner.parent.mkdir();owner.write_text('other')
            with self.assertRaisesRegex(Refused,'exact_owner_mismatch'):p.require_owner()

class PreservedSafetyTests(unittest.TestCase):
    def test_bounded_timeout_kills_and_reaps_without_retry(self):
        import subprocess
        from unittest.mock import patch
        from wechat_phone import bounded
        process=Mock(pid=12345)
        process.communicate.side_effect=[subprocess.TimeoutExpired(['adb'],1),(b'',b'')]
        with patch('wechat_phone.subprocess.Popen',return_value=process) as start, patch('wechat_phone.os.killpg') as kill:
            with self.assertRaises(subprocess.TimeoutExpired):bounded(['adb'],1)
            start.assert_called_once();kill.assert_called_once()
            self.assertEqual(process.communicate.call_count,2)

    def test_cli_does_not_add_send_reply_publish_operations(self):
        import subprocess
        import sys
        import wechat_phone
        for operation in ('send','reply','publish'):
            result=subprocess.run([sys.executable,wechat_phone.__file__,'--owner','owner','--evidence-dir','/tmp/evidence',operation],capture_output=True)
            self.assertEqual(result.returncode,2)
            self.assertIn(b'invalid choice',result.stderr)

    def test_busy_guard_refuses_and_does_not_release_owner(self):
        import fcntl
        with tempfile.TemporaryDirectory() as d:
            owner=Path(d)/'SERIAL.lock'/'owner';owner.parent.mkdir();owner.write_text('owner\n')
            guard=Path(d)/'SERIAL.guard'
            with guard.open('w') as held:
                fcntl.flock(held,fcntl.LOCK_EX|fcntl.LOCK_NB)
                p=Phone('SERIAL','owner',d,d)
                with self.assertRaisesRegex(Refused,'serial_guard_busy'):
                    with p.guard():self.fail('guard entered')
            self.assertEqual(owner.read_text(),'owner\n')
