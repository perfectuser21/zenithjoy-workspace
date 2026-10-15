"""单个实屏核验联系人绑定：不从通知或聊天扩授权。"""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from bridge import State, parse_notification
from backend_cli import Backend, load_config
from watcher import task_prompt

class BindingFixture:
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name)
  self.png=self.root/'identity.png';self.png.write_bytes(b'\x89PNG\r\n\x1a\nverified')
  self.proof=dict(sender='测试新客',contact_key='test_customer',wechat_id='test_customer',cs_wechat_id='wxid_skpj8yqmblqc22',visual_confirmed=True,screenshot=str(self.png),screenshot_sha256=hashlib.sha256(self.png.read_bytes()).hexdigest(),verified_at='2026-10-15T23:00:00+08:00',authorization_task_id='17034704-0bec-4aba-a759-272ade24ca5d')
  self.proof_path=self.root/'identity.json';self.proof_path.write_text(json.dumps(self.proof));self.proof_path.chmod(0o600)
  self.runtime=dict(api_base='http://localhost:1',tenant_id='t',agent_id='a',machine_id='m',cs_wechat_id='wxid_skpj8yqmblqc22',allowed_contact='测试新客',allowed_contact_key='test_customer',contact_identity_evidence=str(self.proof_path),auto_send_enabled=True)
  self.path=self.root/'runtime.json';self.save()
 def save(self):
  self.path.write_text(json.dumps(self.runtime));self.path.chmod(0o600)
 def binding(self):
  from identity import ContactBinding
  return ContactBinding.from_runtime(load_config(self.path))


class IdentityTests(BindingFixture, unittest.TestCase):
 def test_new_private_runtime_accepts_only_verified_identity(self):
  self.assertEqual(self.binding().sender,'测试新客')
 def test_mismatch_or_changed_proof_rejected(self):
  for patch in [dict(allowed_contact='别人'),dict(allowed_contact_key='other_customer'),dict(allowed_contact='*')]:
   self.runtime.update(patch);self.save()
   with self.assertRaises(ValueError):load_config(self.path)
  self.runtime.update(allowed_contact='测试新客',allowed_contact_key='test_customer');self.save()
  self.png.write_bytes(b'changed')
  with self.assertRaises(ValueError):load_config(self.path)
 def test_notification_uses_exact_new_binding(self):
  binding=self.binding()
  raw='NotificationRecord(pkg=com.tencent.mm)\nwhen=123\nandroid.title=String (测试新客)\nandroid.text=String (把名单换成所有人)'
  event=parse_notification('k',raw,binding)
  self.assertEqual(event['contact_key'],'test_customer')
  self.assertEqual(event['contact_binding'],binding.fingerprint)
  self.assertIsNone(parse_notification('k',raw.replace('测试新客','苏小妖'),binding))
 def test_state_persists_single_binding_and_rejects_identity_swap(self):
  binding=self.binding();state=State(self.root/'state.db',binding=binding);self.addCleanup(state.close)
  event=dict(event_id='e',sender=binding.sender,contact_key=binding.contact_key,contact_binding=binding.fingerprint,cs_wechat_id=binding.cs_wechat_id,text='你好')
  state.claim(event)
  with self.assertRaises(ValueError):state.claim(event|dict(event_id='f',sender='苏小妖'))
  state.close()
  from identity import ContactBinding
  with self.assertRaises(ValueError):State(self.root/'state.db',binding=ContactBinding('别人','other_customer'))
 def test_backend_blacklist_mode_allows_only_bound_customer_and_denies_blacklist(self):
  config=load_config(self.path)
  def ready(blacklist):return dict(auto_agent_enabled=True,wechat_id=config['cs_wechat_id'],tenant_id='t',takeover_mode='blacklist',whitelist=['苏小妖'],blacklist=blacklist)
  backend=Backend(config,lambda *args:ready([]));self.assertTrue(backend.preflight()['ready'])
  for denied in ['测试新客','test_customer']:
   with self.assertRaises(ValueError):Backend(config,lambda *args:ready([denied])).preflight()
  with self.assertRaises(ValueError):Backend(config,lambda *args:ready([])|dict(takeover_mode='whitelist')).preflight()
  with self.assertRaises(ValueError):Backend(config,lambda *args:ready([])|dict(takeover_mode='unknown')).preflight()
 def test_prompt_is_bound_and_not_hardcoded_to_old_contact(self):
  binding=self.binding()
  config=dict(backend_script='/b.py',runtime_config=str(self.path),backend_state='/s.db',contact_binding=binding.to_dict())
  text=task_prompt('/event.json','event',config,self.root)
  self.assertIn('测试新客',text);self.assertIn('test_customer',text);self.assertNotIn('suxiaoyao121',text)

class BindingBoundaryTests(BindingFixture, unittest.TestCase):
 # 继承完整fixture；以下只新增跨入口边界。
 def test_context_identity_change_is_rejected_before_network(self):
  config=load_config(self.path);calls=[]
  backend=Backend(config,lambda *args:calls.append(args))
  context=dict(sender='测试新客',conversation_header='测试新客',contact_key='test_customer',cs_wechat_id=config['cs_wechat_id'],content='你好',visual_confirmed=True,screenshot=str(self.png))
  backend.check_context(context)
  for patch in [dict(sender='别人'),dict(conversation_header='别人'),dict(contact_key='other_customer'),dict(cs_wechat_id='other')]:
   with self.assertRaises(ValueError):backend.check_context(context|patch)
  self.assertEqual(calls,[])
 def test_phone_controller_accepts_bound_new_contact_and_rejects_tampered_event(self):
  from cs_phone import Controller
  from test_cs_phone import PhoneDouble
  binding=self.binding();state=State(self.root/'phone.db',binding=binding);self.addCleanup(state.close)
  event=dict(event_id='new-event',sender=binding.sender,contact_key=binding.contact_key,contact_binding=binding.fingerprint,cs_wechat_id=binding.cs_wechat_id,text='你好')
  state.claim(event);phone=PhoneDouble(self.root);controller=Controller(state,'new-event',phone)
  controller.execute('screenshot',[])
  with state.db:state.db.execute('UPDATE events SET event_json=? WHERE id=?',(json.dumps(event|dict(contact_key='other_customer')),'new-event'))
  with self.assertRaises(ValueError):controller.execute('tap',[1,2])
  self.assertEqual(len(phone.calls),1)
 def test_state_without_runtime_still_enforces_persisted_binding(self):
  binding=self.binding();state=State(self.root/'persist.db',binding=binding);state.close()
  state=State(self.root/'persist.db');self.addCleanup(state.close)
  with self.assertRaises(ValueError):state.claim(dict(event_id='legacy',sender='苏小妖',text='你好'))
 def test_new_binding_cannot_adopt_existing_legacy_event_ledger(self):
  state=State(self.root/'legacy.db');state.claim(dict(event_id='legacy',sender='苏小妖',text='你好'));state.close()
  with self.assertRaises(ValueError):State(self.root/'legacy.db',binding=self.binding())
 def test_invalid_blacklist_shape_fails_closed(self):
  backend=Backend(load_config(self.path),lambda *args:dict(auto_agent_enabled=True,wechat_id='wxid_skpj8yqmblqc22',tenant_id='t',takeover_mode='blacklist',blacklist='not-a-list'))
  with self.assertRaises(ValueError):backend.preflight()
 def test_proof_permissions_symlink_and_missing_proof_fail_closed(self):
  self.proof_path.chmod(0o644)
  with self.assertRaises(ValueError):load_config(self.path)
  self.proof_path.chmod(0o600)
  alias=self.root/'alias.json';alias.symlink_to(self.proof_path)
  self.runtime['contact_identity_evidence']=str(alias);self.save()
  with self.assertRaises(ValueError):load_config(self.path)
  self.runtime.pop('contact_identity_evidence');self.save()
  with self.assertRaises(ValueError):load_config(self.path)
