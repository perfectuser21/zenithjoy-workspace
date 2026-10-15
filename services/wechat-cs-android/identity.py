"""私有运行绑定；只允许一个已授权、实屏核验的微信联系人。"""
from dataclasses import dataclass, asdict
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

CS_WECHAT_ID = 'wxid_skpj8yqmblqc22'
LEGACY_SENDER = '苏小妖'
LEGACY_CONTACT_KEY = 'suxiaoyao121'


def private_file(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('identity_requires_private_regular_file')
    return path


@dataclass(frozen=True)
class ContactBinding:
    sender: str
    contact_key: str
    cs_wechat_id: str = CS_WECHAT_ID
    evidence_path: str = ''
    evidence_sha256: str = ''
    authorization_task_id: str = ''

    def __post_init__(self):
        if (not isinstance(self.sender, str) or not 1 <= len(self.sender) <= 80
                or self.sender != self.sender.strip() or re.search(r'[\x00-\x1f\x7f*?`"{}<>]', self.sender)
                or not isinstance(self.contact_key, str)
                or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{4,80}', self.contact_key)
                or self.cs_wechat_id != CS_WECHAT_ID):
            raise ValueError('invalid_single_contact_binding')

    @property
    def fingerprint(self):
        return hashlib.sha256(json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True).encode()).hexdigest()

    def to_dict(self):
        return asdict(self)

    @classmethod
    def from_dict(cls, value):
        if not isinstance(value, dict) or set(value) != set(cls.__dataclass_fields__):
            raise ValueError('invalid_contact_binding_shape')
        return cls(**value)

    @classmethod
    def from_runtime(cls, config):
        proof_path = private_file(config.get('contact_identity_evidence', ''))
        proof = json.loads(proof_path.read_text())
        sender, key = config.get('allowed_contact'), config.get('allowed_contact_key')
        binding = cls(sender, key, config.get('cs_wechat_id'))
        if (proof.get('sender') != sender or proof.get('contact_key') != key
                or proof.get('wechat_id') != key or proof.get('cs_wechat_id') != binding.cs_wechat_id
                or proof.get('visual_confirmed') is not True
                or not isinstance(proof.get('authorization_task_id'), str)
                or not re.fullmatch(r'[0-9a-f-]{36}', proof['authorization_task_id'])):
            raise ValueError('contact_identity_not_authorized_or_verified')
        try:
            if datetime.fromisoformat(proof['verified_at'].replace('Z', '+00:00')).tzinfo is None:
                raise ValueError('missing_identity_time_zone')
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError('invalid_identity_verification_time') from exc
        screenshot = Path(proof.get('screenshot', ''))
        if not screenshot.is_absolute() or screenshot.is_symlink() or not screenshot.is_file():
            raise ValueError('identity_screenshot_missing')
        raw = screenshot.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        if not raw.startswith(b'\x89PNG\r\n\x1a\n') or sha != proof.get('screenshot_sha256'):
            raise ValueError('identity_screenshot_changed')
        return cls(sender, key, binding.cs_wechat_id, str(proof_path), sha, proof['authorization_task_id'])

    def require_event(self, event):
        if (event.get('sender') != self.sender or event.get('contact_key') != self.contact_key
                or event.get('cs_wechat_id') != self.cs_wechat_id
                or event.get('contact_binding') != self.fingerprint):
            raise ValueError('event_contact_binding_mismatch')

    def require_context(self, context):
        if (context.get('sender') != self.sender or context.get('conversation_header') != self.sender
                or context.get('contact_key') != self.contact_key
                or context.get('cs_wechat_id') != self.cs_wechat_id):
            raise ValueError('context_contact_binding_mismatch')
