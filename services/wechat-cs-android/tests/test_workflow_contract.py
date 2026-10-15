"""冻结合同与可执行实现一致，不代表真机运行已通过。"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMPLEMENTATION = '0ba872d6cf534279d0640523636c378f5dd76e5d'


class WorkflowContractTests(unittest.TestCase):
    def test_candidate_keeps_four_activities_nine_steps_and_pins_all_code(self):
        workflow = json.loads((ROOT / 'workflows/wechat_cs_reply_delivery.android.json').read_text())
        self.assertEqual(workflow['version'], '0.3.2')
        self.assertEqual(workflow['runtime']['code_revision'], IMPLEMENTATION)
        self.assertEqual(len(workflow['activities']), 4)
        self.assertEqual(sum(len(a['steps']) for a in workflow['activities']), 9)
        for activity in workflow['activities']:
            bindings = [activity['implementation'], *activity['implementation_bindings'],
                        *(step['implementation'] for step in activity['steps'])]
            self.assertTrue(any(b.get('path', '').endswith('/identity.py') for b in bindings))
            for binding in bindings:
                self.assertEqual(binding['version'], '0.3.2')
                self.assertEqual(binding['revision'], 'contract' if binding['kind'] == 'skill' else IMPLEMENTATION)
        skill = (ROOT / 'skills/wechat-cs-android/SKILL.md').read_text()
        self.assertIn(IMPLEMENTATION, skill)
        self.assertNotIn('苏小妖', skill)
        self.assertNotIn('suxiaoyao121', skill)
        self.assertIn('contact_identity_evidence', skill)

    def test_friend_onboarding_is_separate_candidate_with_no_message_delivery(self):
        workflow = json.loads((ROOT / 'workflows/wechat_friend_onboarding.android.json').read_text())
        self.assertEqual(workflow['key'], 'wechat_friend_onboarding.android')
        self.assertEqual(workflow['version'], '0.1.0')
        self.assertEqual(workflow['capability_id'], 'ac2e35bc-849a-48cd-917f-79d15c5ac886')
        self.assertEqual(len(workflow['activities']), 4)
        self.assertNotIn('reply_delivered', [a['key'] for a in workflow['activities']])
        skill = (ROOT / 'skills/wechat-friend-onboarding-android/SKILL.md').read_text()
        self.assertIn('scan_scope', skill)
        self.assertIn('partial', skill)
        self.assertIn('409', skill)
        self.assertIn('no-op', skill)
        self.assertIn('待整链核验', skill)
