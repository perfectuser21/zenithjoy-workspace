"""Exercise the real remake node class without importing unrelated tensor models."""
import ast
import pathlib
import os
from types import SimpleNamespace
from urllib.parse import urlparse
import re
import unittest
from unittest.mock import Mock

ROOT = pathlib.Path(__file__).resolve().parents[1]

class WanRemakeTest(unittest.TestCase):
    def setUp(self):
        tree = ast.parse((ROOT / 'custom_nodes/zenithjoy/__init__.py').read_text())
        cls = next((item for item in tree.body if isinstance(item, ast.ClassDef) and item.name == 'WanRemakeGenerate'), None)
        self.assertIsNotNone(cls, 'WanRemakeGenerate must be implemented')
        self.submit = Mock(return_value={'id': '12345678-1234-1234-1234-123456789abc'})
        self.download = Mock(return_value='downloaded-video')
        scope = {'re': re, '_submit_and_wait': self.submit, '_download_job_video': self.download}
        exec(compile(ast.Module(body=[cls], type_ignores=[]), '<real-remake-node>', 'exec'), scope)
        self.node = scope['WanRemakeGenerate']()
        self.values = dict(参考视频ID='11111111-1111-1111-1111-111111111111', 产品操作='保留产品', 产品图片ID='', 产品说明='', 目标颜色='', 更换背景=False, 背景说明='', 背景图片ID='', 更换人脸=False, 原片人脸='尚未确认', 人脸图片ID='', 确认生成=True, request_id='a'*32)

    def test_combinations_send_roles_without_browser_urls_or_provider_options(self):
        self.values.update(产品操作='更换款式', 产品图片ID='22222222-2222-2222-2222-222222222222', 更换背景=True, 背景说明='海边', 更换人脸=True, 原片人脸='有露脸', 人脸图片ID='33333333-3333-3333-3333-333333333333')
        result = self.node.run(**self.values)
        path, payload, request_id = self.submit.call_args.args
        self.assertEqual(path, '/jobs')
        self.assertEqual(payload['kind'], 'wan')
        self.assertEqual(payload['remake']['productMode'], 'replace')
        self.assertEqual(payload['remake']['facePresence'], 'present')
        self.assertEqual(payload['remake']['backgroundDescription'], '海边')
        self.assertNotIn('prompt', payload)
        self.assertEqual(request_id, 'a'*32)
        self.assertEqual(result, {'ui': {'text': ['12345678-1234-1234-1234-123456789abc']}, 'result': ('downloaded-video',)})

    def test_confirmation_missing_uuid_and_upload_busy_never_submit(self):
        for change in [{'确认生成': False}, {'参考视频ID': ''}, {'产品图片ID': '上传中'}, {'参考视频ID': 'https://example.com/video.mp4'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.node.run(**{**self.values, **change})
        self.submit.assert_not_called()

    def test_no_effective_operation_is_rejected(self):
        for change in [{}, {'更换人脸': True, '原片人脸': '未露脸'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.node.run(**{**self.values, **change})
        self.submit.assert_not_called()

    def test_each_operation_has_required_material(self):
        for change in [{'产品操作': '更换颜色'}, {'产品操作': '更换Logo'}, {'产品操作': '更换款式'}, {'更换背景': True}, {'更换人脸': True}, {'更换人脸': True, '原片人脸': '有露脸'}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.node.run(**{**self.values, **change})
        self.submit.assert_not_called()

    def test_independent_color_and_absent_face_can_continue(self):
        self.node.run(**{**self.values, '产品操作': '更换颜色', '目标颜色': '深蓝色', '更换人脸': True, '原片人脸': '未露脸'})
        payload = self.submit.call_args.args[1]['remake']
        self.assertEqual(payload['productMode'], 'color')
        self.assertEqual(payload['facePresence'], 'absent')

class ApiMessageTest(unittest.TestCase):
    def test_safe_validation_errors_are_actionable_but_sensitive_messages_stay_hidden(self):
        tree = ast.parse((ROOT / 'custom_nodes/zenithjoy/__init__.py').read_text())
        functions = [item for item in tree.body if isinstance(item, ast.FunctionDef) and item.name in ('_api', '_submit_and_wait')]
        response = Mock(status_code=400)
        request = Mock(return_value=response)
        scope = {'os': SimpleNamespace(environ={'ZENITHJOY_CANVAS_API': 'http://api:5200', 'ZENITHJOY_CANVAS_TOKEN': 'secret'}), 'urlparse': urlparse, 're': re,
                 'requests': SimpleNamespace(request=request, RequestException=ConnectionError)}
        exec(compile(ast.Module(body=functions, type_ignores=[]), '<real-api-functions>', 'exec'), scope)
        response.json.return_value = {'error': '原片没有露脸，请关闭换脸或选择其他操作'}
        with self.assertRaisesRegex(ValueError, '原片没有露脸'):
            scope['_submit_and_wait']('/jobs', {'kind': 'wan'}, 'a'*32)
        for message in ['请检查 https://signed.example/private?signature=secret', '敏感字段' + 'a'*50, '错误\n泄漏', '错'*201]:
            response.json.return_value = {'error': message}
            with self.subTest(message=message), self.assertRaisesRegex(RuntimeError, '^创作服务请求失败'):
                scope['_api']('POST', '/jobs', {})

if __name__ == '__main__': unittest.main()
