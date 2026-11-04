"""102专用历史请求域及单owner维护：不得把业务code1或旧false洗绿。"""
import importlib.util
import json
import os
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('collection_review',HERE/'collection-review-maintenance.py')
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def leaf(code=0):
    i={'sequence':1,'argv_sha256':'a'*64,'intent_at':10,'boundary':'darwin-sandbox-deny-process-fork-v1'}
    s={**i,'pid':123,'started_at':11}
    return [{**i,'phase':'intent'},{**s,'phase':'started'},{**s,'phase':'exit','ended_at':12,'code':code,'signal':None,'tainted':False,'request_returned':True}]

class RequestDomainTest(unittest.TestCase):
    def verify(self,rows):
        return m.verify_leaf_log(''.join(json.dumps(x)+'\n' for x in rows))
    def test_business_failure_returned_never_means_complete(self):
        for code in [0,1]:
            r=self.verify(leaf(code));self.assertEqual(r['leaves'],1);self.assertTrue(r['requests_returned'])
            self.assertFalse(r['execution_stopped']);self.assertEqual(r['code_failures'],code)
    def test_missing_duplicate_signal_taint_unknown_and_scope_changes_fail(self):
        r=leaf()
        for rows in [r[:-1],r+r,[*r,{'phase':'unknown'}],[r[0],{**r[1],'pid':999},r[2]],
                     [*r[:-1],{**r[-1],'signal':'SIGKILL'}],[*r[:-1],{**r[-1],'tainted':True}],
                     [*r[:-1],{**r[-1],'request_returned':False}],[*r[:-1],{**r[-1],'code':137}],
                     [*r[:-1],{**r[-1],'ended_at':9}]]:
            with self.subTest(rows=rows),self.assertRaises(ValueError):self.verify(rows)
    def test_exact_new102_scope_and_new_maintenance_claim(self):
        self.assertEqual(m.SCOPE['owner'],'ys20261103235714_102')
        self.assertEqual(m.SCOPE['task_id'],'6ca6e356-d63b-4a1f-92b7-9f5a7798b916')
        task={**m.TASK,'payload':{'headed_manual':'true'}};m.verify_task(task)
        for k in m.TASK:
            with self.subTest(key=k),self.assertRaises(ValueError):m.verify_task({**task,k:'foreign'})
    def test_phone_cleanup_is_fixed_and_never_business_or_shared_restart(self):
        commands=m.cleanup_commands()
        self.assertEqual(commands[:2],[['shell','am','force-stop','com.ss.android.ugc.aweme'],['shell','input','keyevent','3']])
        for args in commands:
            self.assertNotIn('kill-server',args);self.assertNotIn('start-server',args)
            self.assertNotIn('text',args);self.assertNotIn('tap',args)

@unittest.skipUnless(os.environ.get('COLLECTION_REVIEW_ORIGINAL_FIXTURE'),'受控真实102副本')
class OriginalTest(unittest.TestCase):
    def test_actual_1486_returned_leaves_with_16_business_failures(self):
        r=m.verify_original(Path(os.environ['COLLECTION_REVIEW_ORIGINAL_FIXTURE']),runtime_root=Path(os.environ['COLLECTION_REVIEW_RUNTIME_FIXTURE']))
        self.assertEqual(r['leaves'],1486);self.assertEqual(r['code_failures'],16)
        self.assertTrue(r['requests_returned']);self.assertFalse(r['execution_stopped'])

if __name__=='__main__':unittest.main()
