"""手机控制器 ROM 焦点回归；不连接或操作手机。"""
import base64
import unittest
from unittest.mock import Mock
from wechat_phone import Phone, Refused


class ForegroundTests(unittest.TestCase):
    def setUp(self):
        self.phone = Phone('SERIAL', 'owner', '/tmp/evidence', '/tmp/locks')

    def test_honor_full_dump_focus(self):
        self.phone.shell = Mock(return_value='''WINDOW MANAGER WINDOWS
  Window #0 Window{4c1a686 u0 com.hihonor.android.launcher/com.hihonor.android.launcher.unihome.UniHomeLauncher}
WINDOW MANAGER DISPLAY CONTENTS
  mCurrentFocus=Window{4c1a686 u0 com.hihonor.android.launcher/com.hihonor.android.launcher.unihome.UniHomeLauncher}
''')
        self.assertEqual(self.phone.foreground(), {
            'package': 'com.hihonor.android.launcher',
            'activity': 'com.hihonor.android.launcher.unihome.UniHomeLauncher'})
        self.phone.shell.assert_called_once_with('dumpsys', 'window')

    def test_missing_or_multiple_focus_refused(self):
        for raw in ('mCurrentFocus=null',
                    'mCurrentFocus=Window{a u0 com.tencent.mm/.ui.LauncherUI}\n'
                    'mCurrentFocus=Window{b u0 other.app/.Activity}'):
            with self.subTest(raw=raw):
                self.phone.shell = Mock(return_value=raw)
                with self.assertRaisesRegex(Refused, 'foreground_unknown'):
                    self.phone.foreground()


OEM_FIXTURE = """mInputShown=true
mServedView=com.tencent.mm.plugin.sns.ui.widget.SnsUploadV2EditText{516c4e9 VFED..CL. .F...... 0,0-100,100}
mServedInputConnection=RemoteInputConnectionImpl{connection=nt5.l1@ffa19d mDeactivateRequested=false mServedView=com.tencent.mm.plugin.sns.ui.widget.SnsUploadV2EditText{516c4e9 VFED..CL. .F...... 0,0-100,100}}
current EditorInfo packageName=com.tencent.mm,inputType=0x24001,fieldId=2131387217
"""

class OemComposerTests(unittest.TestCase):
    def setUp(self):
        self.phone = Phone('SERIAL', 'owner', '/tmp/evidence', '/tmp/locks')
        self.phone.foreground = Mock(return_value={
            'package':'com.tencent.mm', 'activity':'com.tencent.mm.plugin.sns.ui.SnsUploadUI'})
        self.phone.shell = Mock(return_value=OEM_FIXTURE)

    def test_exact_honor_served_composer_fixture(self):
        self.phone.require_oem_composer_focus()
        self.phone.shell.assert_called_once_with('dumpsys','input_method')

    def test_honor_actual_multiline_current_editor_info(self):
        editor = """  mCurrentEditorInfo:
    inputType=0x24001 imeOptions=0x40000006 privateImeOptions=null
    actionLabel=null actionId=0
    initialSelStart=0 initialSelEnd=0 initialToolType=0 initialCapsMode=0x2000
    hintText=这一刻的想法... label=null
    packageName=com.tencent.mm autofillId=1073741824 fieldId=2131387217 fieldName=null
    hintLocales=null
    supportedHandwritingGestureTypes=SELECT|INSERT
"""
        self.phone.shell.return_value = OEM_FIXTURE.replace(
            'current EditorInfo packageName=com.tencent.mm,inputType=0x24001,fieldId=2131387217', editor)
        self.phone.require_oem_composer_focus()

    def test_legacy_sns_upload_widget_supported(self):
        self.phone.shell.return_value=OEM_FIXTURE.replace('SnsUploadV2EditText','SnsUploadEditText')
        self.phone.require_oem_composer_focus()

    def test_missing_focus_hidden_inactive_zero_type_wrong_widget_refused(self):
        for sample in (
            OEM_FIXTURE.replace('.F......','........'),
            OEM_FIXTURE.replace('mInputShown=true','mInputShown=false'),
            OEM_FIXTURE.replace('mInputShown=true','no_input_shown'),
            OEM_FIXTURE.replace('mDeactivateRequested=false','mDeactivateRequested=true'),
            OEM_FIXTURE.replace('inputType=0x24001','inputType=0'),
            OEM_FIXTURE.replace('SnsUploadV2EditText','ChattingEditText'),
            OEM_FIXTURE.replace('packageName=com.tencent.mm','packageName=other.app'),
            OEM_FIXTURE.replace('connection=nt5.l1@ffa19d','connection=null'),
        ):
            with self.subTest(sample=sample):
                self.phone.shell.return_value=sample
                with self.assertRaises(Refused):self.phone.require_oem_composer_focus()

    def test_non_composer_refused(self):
        self.phone.foreground.return_value={'package':'com.tencent.mm','activity':'.ui.LauncherUI'}
        with self.assertRaisesRegex(Refused,'oem_not_sns_composer'):
            self.phone.require_oem_composer_focus()

    def test_empty_uia_input_requires_visual_readback_restores_ime_once(self):
        original='com.example.keyboard/.IME'
        current=[original]
        broadcasts=[]
        def shell(*args):
            if args==('dumpsys','input_method'):return OEM_FIXTURE
            if args==('settings','get','secure','default_input_method'):return current[0]
            if args[:2]==('ime','set'):current[0]=args[2];return 'ok'
            if args[:2]==('ime','enable'):return 'already enabled'
            if args[:2]==('am','broadcast'):broadcasts.append(args);return 'Broadcast completed: result=0'
            self.fail('unexpected command '+str(args))
        self.phone.shell=Mock(side_effect=shell)
        self.phone.ui_xml=Mock(return_value=b'<hierarchy><node class="android.widget.FrameLayout"/></hierarchy>')
        self.phone.require_safe_write=Mock()
        result=self.phone.input_text(base64.b64encode('今晚风很舒服'.encode()).decode())
        self.assertFalse(result['text_verified'])
        self.assertTrue(result['requires_visual_readback'])
        self.assertEqual(len(result['sha256']),64)
        self.assertEqual(current[0],original)
        self.assertEqual(len(broadcasts),1)


if __name__ == '__main__':
    unittest.main()
