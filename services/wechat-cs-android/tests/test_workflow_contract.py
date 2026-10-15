"""冻结合同与可执行实现一致，不代表真机运行已通过。"""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
IMPLEMENTATION = '7eb99e5cfc013539d7a9ad4ec0654c03802da1f2'


class WorkflowContractTests(unittest.TestCase):
    def test_candidate_keeps_four_activities_nine_steps_and_pins_all_code(self):
        workflow = json.loads((ROOT / 'workflows/wechat_cs_reply_delivery.android.json').read_text())
        self.assertEqual(workflow['version'], '0.3.0')
        self.assertEqual(workflow['runtime']['code_revision'], IMPLEMENTATION)
        self.assertEqual(len(workflow['activities']), 4)
        self.assertEqual(sum(len(a['steps']) for a in workflow['activities']), 9)
        for activity in workflow['activities']:
            bindings = [activity['implementation'], *activity['implementation_bindings'],
                        *(step['implementation'] for step in activity['steps'])]
            self.assertTrue(any(b.get('path', '').endswith('/identity.py') for b in bindings))
            for binding in bindings:
                self.assertEqual(binding['version'], '0.3.0')
                self.assertEqual(binding['revision'], 'contract' if binding['kind'] == 'skill' else IMPLEMENTATION)
        skill = (ROOT / 'skills/wechat-cs-android/SKILL.md').read_text()
        self.assertIn(IMPLEMENTATION, skill)
        self.assertNotIn('苏小妖', skill)
        self.assertNotIn('suxiaoyao121', skill)
        self.assertIn('contact_identity_evidence', skill)
