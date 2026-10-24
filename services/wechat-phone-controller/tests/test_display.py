"""Scrubbed replay of an idle installer display beside the focused default display."""
import unittest
from unittest.mock import Mock
from wechat_phone import Phone, Refused
from test_popup import POPUP, TOP as POPUP_TOP

TOP = 'topResumedActivity=ActivityRecord{aaa u0 com.tencent.mm/.plugin.account.ui.LoginUI t169}'
DISPLAY = '''WINDOW MANAGER DISPLAY CONTENTS (dumpsys window displays)
  Display: mDisplayId=2 rootTasks=0
    init=1x1 240dpi cur=1x1 app=1x1 rng=1x1-1x1
  mCurrentFocus=null
  mFocusedApp=null
  displayId=2
  DisplayFrames w=1 h=1 r=0
  Display: mDisplayId=0 rootTasks=10
    init=720x1280 240dpi cur=720x1280 app=720x1208 rng=720x684-1208x1172
  mCurrentFocus=Window{bbb u0 com.tencent.mm/com.tencent.mm.plugin.account.ui.LoginUI}
  mFocusedApp=ActivityRecord{aaa u0 com.tencent.mm/.plugin.account.ui.LoginUI t169}
  displayId=0
      mPreferredTopFocusableRootTask=Task{ddd #169 type=standard A=10088:com.tencent.mm U=0 visible=true mode=fullscreen}
  DisplayFrames w=720 h=1280 r=0
WINDOW MANAGER WINDOWS (dumpsys window windows)
  Window #0 Window{bbb u0 com.tencent.mm/com.tencent.mm.plugin.account.ui.LoginUI}:
    mDisplayId=0 rootTaskId=169 mSession=Session{ccc 123:u0a10088}
    mOwnerUid=10088 package=com.tencent.mm
    mAttrs={ty=BASE_APPLICATION}
    mHasSurface=true isReadyForDisplay()=true
    isOnScreen=true
    isVisible=true
  mTopFocusedDisplayId=0
WINDOW MANAGER SESSIONS (dumpsys window sessions)
  Session Session{ccc 123:u0a10088}:
    mPackageName=com.tencent.mm
'''

class DisplayTests(unittest.TestCase):
    def phone(self, raw=DISPLAY, top=TOP):
        p=Phone('SERIAL','owner','/tmp/evidence','/tmp/locks')
        p.shell=Mock(side_effect=lambda *args: raw if args==('dumpsys','window') else top)
        return p

    def test_idle_installer_display_does_not_hide_default_wechat_focus(self):
        self.assertEqual(self.phone().foreground(), {
            'package':'com.tencent.mm','activity':'com.tencent.mm.plugin.account.ui.LoginUI'})

    def test_display_order_is_not_assumed(self):
        begin=DISPLAY.index('  Display: mDisplayId=2')
        split=DISPLAY.index('  Display: mDisplayId=0')
        end=DISPLAY.index('WINDOW MANAGER WINDOWS')
        swapped=DISPLAY[:begin]+DISPLAY[split:end]+DISPLAY[begin:split]+DISPLAY[end:]
        self.assertEqual(self.phone(swapped).foreground()['package'],'com.tencent.mm')

    def test_ambiguous_nondefault_foreign_or_inconsistent_display_refused(self):
        mutations=[
            ('mTopFocusedDisplayId=0','mTopFocusedDisplayId=2'),
            ('  mTopFocusedDisplayId=0\n',''),
            ('  mTopFocusedDisplayId=0','  mTopFocusedDisplayId=0\n  mTopFocusedDisplayId=0'),
            ('mDisplayId=2 rootTasks=0','mDisplayId=2 rootTasks=1'),
            ('  mCurrentFocus=null','  mCurrentFocus=Window{eee u0 foreign.app/.Main}'),
            ('  mFocusedApp=null','  mFocusedApp=ActivityRecord{fff u0 foreign.app/.Main t2}'),
            ('DisplayFrames w=1 h=1','DisplayFrames w=100 h=100'),
            ('displayId=2','displayId=3'),
            ('mDisplayId=0 rootTasks=10','mDisplayId=0 rootTasks=0'),
            ('mDisplayId=2 rootTasks=0','mDisplayId=0 rootTasks=0'),
            ('mDisplayId=0 rootTaskId=169','mDisplayId=1 rootTaskId=169'),
            ('rootTaskId=169','rootTaskId=99'),
            ('A=10088:com.tencent.mm','A=10099:com.tencent.mm'),
            ('A=10088:com.tencent.mm','A=10088:foreign.app'),
            ('U=0 visible=true','U=1 visible=true'),
            ('U=0 visible=true','U=0 visible=false'),
            ('mOwnerUid=10088','mOwnerUid=10099'),
            ('package=com.tencent.mm','package=foreign.app'),
            ('mPackageName=com.tencent.mm','mPackageName=foreign.app'),
            ('ty=BASE_APPLICATION','ty=APPLICATION_OVERLAY'),
            ('mHasSurface=true','mHasSurface=false'),
            ('isReadyForDisplay()=true','isReadyForDisplay()=false'),
            ('isOnScreen=true','isOnScreen=false'),
            ('isVisible=true','isVisible=false'),
            ('mSession=Session{ccc 123:u0a10088}','mSession=Session{eee 123:u0a10088}'),
            ('mFocusedApp=ActivityRecord{aaa u0','mFocusedApp=ActivityRecord{aaa u1'),
            ('mCurrentFocus=Window{bbb u0','mCurrentFocus=Window{bbb u1'),
        ]
        for old,new in mutations:
            with self.subTest(old=old,new=new),self.assertRaisesRegex(Refused,'foreground_unknown'):
                self.phone(DISPLAY.replace(old,new,1)).foreground()
        for extra in ('mCurrentFocus=null\n','mFocusedApp=null\n',
                      'mCurrentFocus=Window{bbb u0 com.tencent.mm/com.tencent.mm.plugin.account.ui.LoginUI}\n'):
            with self.subTest(extra=extra),self.assertRaises(Refused):
                self.phone(DISPLAY+extra).foreground()
        for top in ('',TOP+'\n'+TOP,TOP.replace('t169','t99'),TOP.replace('u0','u1'),TOP.replace('aaa','fff'),TOP.replace('com.tencent.mm','foreign.app')):
            with self.subTest(top=top),self.assertRaises(Refused):self.phone(top=top).foreground()

    def test_nondefault_top_display_refused_even_with_one_focus(self):
        raw='mCurrentFocus=Window{bbb u0 com.tencent.mm/.ui.LauncherUI}\nmTopFocusedDisplayId=2'
        with self.assertRaises(Refused):self.phone(raw).foreground()

    def test_owned_launcher_popup_retains_full_proofs_with_idle_aux_display(self):
        display=DISPLAY[:DISPLAY.index('WINDOW MANAGER WINDOWS')]
        display=display.replace('Window{bbb u0 com.tencent.mm/com.tencent.mm.plugin.account.ui.LoginUI}', 'Window{aaa u0 PopupWindow:bbb}')
        display=display.replace('ActivityRecord{aaa u0 com.tencent.mm/.plugin.account.ui.LoginUI t169}', 'ActivityRecord{fff u0 com.tencent.mm/.ui.LauncherUI t1653}')
        display=display.replace('#169 type=standard A=10088:com.tencent.mm','#1653 type=standard A=10322:com.tencent.mm')
        windows=POPUP[:POPUP.index('  mCurrentFocus=')]
        raw=display+'WINDOW MANAGER WINDOWS (dumpsys window windows)\n'+windows+'  mTopFocusedDisplayId=0\n'
        self.assertEqual(self.phone(raw,POPUP_TOP).foreground()['activity'],'com.tencent.mm.ui.LauncherUI')
        for old,new in [('mParentWindow=Window{ccc','mParentWindow=Window{eee'),('mLayoutAttached=true','mLayoutAttached=false'),('ty=APPLICATION_PANEL','ty=APPLICATION_OVERLAY')]:
            with self.subTest(old=old),self.assertRaises(Refused):self.phone(raw.replace(old,new,1),POPUP_TOP).foreground()
