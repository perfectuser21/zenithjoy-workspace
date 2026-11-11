"""Execute actual business node classes without importing Torch or Comfy models."""
import ast
import copy
import hashlib
import pathlib
import re
import time
import unittest
from unittest.mock import Mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROJECT = '11111111-1111-1111-1111-111111111111'
SEGMENT = '22222222-2222-2222-2222-222222222222'
ASSET = '33333333-3333-3333-3333-333333333333'
JOB = '44444444-4444-4444-4444-444444444444'
REQUEST = 'request_identifier_for_version_001'

class Blocker:
    def __init__(self, message): self.message = message

class NativeVideoWorkflowTest(unittest.TestCase):
    def setUp(self):
        path = ROOT / 'custom_nodes/zenithjoy/native_video_workflow.py'
        self.assertTrue(path.exists(), 'native business nodes must be implemented')
        # Compile the actual source while excluding imports to keep tensor/model dependencies out.
        tree = ast.parse(path.read_text())
        scope = {'re': re, 'time': Mock(monotonic=time.monotonic, sleep=Mock()), 'copy': copy, 'hashlib': hashlib}
        exec(compile(ast.Module(body=[node for node in tree.body if not isinstance(node, (ast.Import, ast.ImportFrom))], type_ignores=[]), str(path), 'exec'), scope)
        self.project = {'id': PROJECT, 'name': '一分钟原片', 'status': 'review', 'confirmed': False, 'segments': [
            {'id': SEGMENT, 'assetId': ASSET, 'start': 0, 'end': 5, 'videoUrl': 'https://owned.example/clip.mp4', 'revision': 0, 'approved': False, 'useOriginal': True}]}
        self.calls = []
        def api(method, path, payload=None, **kwargs):
            self.calls.append((method, path, copy.deepcopy(payload)))
            if method == 'POST' and path == '/projects':
                return Mock(json=lambda: copy.deepcopy(self.project))
            if method == 'PATCH' and path == '/projects/' + PROJECT:
                self.project['confirmed'] = True
            if method == 'PATCH' and '/segments/' in path:
                segment = next(segment for segment in self.project['segments'] if path.endswith('/' + segment['id']))
                self.assertEqual(payload['expectedRevision'], segment['revision'])
                segment.update({key: value for key, value in payload.items() if key != 'expectedRevision'})
                segment['revision'] += 1
                if payload.get('jobId'):
                    segment['job'] = {'id': JOB, 'status': 'succeeded', 'videoUrl': 'https://result.example/output.mp4'}
            if method == 'POST' and path.endswith('/assemble'):
                self.project['status'] = 'completed'
            return Mock(json=lambda: copy.deepcopy(self.project))
        self.api = Mock(side_effect=api)
        self.submit = Mock(return_value={'id': JOB, 'status': 'succeeded', 'videoUrl': 'https://result.example/output.mp4'})
        self.download = Mock(return_value='native-video')
        self.download_project = Mock(return_value='assembled-video')
        self.nodes = scope['build_video_nodes'](self.api, self.submit, self.download, self.download_project, Blocker)
        self.options = {'产品操作': '保留产品', '产品图片ID': '', '产品说明': '', '目标颜色': '', '更换背景': True,
            '背景说明': '海边', '背景图片ID': '', '更换人脸': False, '原片人脸': '尚未确认', '人脸图片ID': '', '确认生成': True, 'request_id': REQUEST}

    def select(self):
        result = self.nodes['ZenithJoyVideoSegment']().run({'id': PROJECT}, 1, True, 已预览分镜ID=SEGMENT)
        return result['result'][0]

    def test_confirmation_without_a_preview_identity_never_confirms_or_releases_a_segment(self):
        result = self.nodes['ZenithJoyVideoSegment']().run({'id': PROJECT}, 1, True)
        self.assertIsInstance(result['result'][0], Blocker)
        self.assertFalse(self.project['confirmed'])
        self.assertFalse(any(method == 'PATCH' for method, _path, _payload in self.calls))
        self.submit.assert_not_called()

    def test_recut_invalidates_old_preview_identity_even_with_confirmation_checked(self):
        old_preview = copy.deepcopy(self.project)
        replacement_id = '77777777-7777-7777-7777-777777777777'
        self.project['segments'][0]['id'] = replacement_id
        self.project['segments'][0]['assetId'] = '88888888-8888-8888-8888-888888888888'
        for confirmed in (False, True):
            with self.subTest(project_already_confirmed=confirmed):
                self.project['confirmed'] = confirmed
                result = self.nodes['ZenithJoyVideoSegment']().run(old_preview, 1, True, 已预览分镜ID=SEGMENT)
                self.assertIsInstance(result['result'][0], Blocker)
                self.assertEqual(result['ui']['segment'][0]['id'], replacement_id)
                self.assertFalse(any(method == 'PATCH' for method, _path, _payload in self.calls))
                self.submit.assert_not_called()
        self.project['confirmed'] = False
        accepted = self.nodes['ZenithJoyVideoSegment']().run(old_preview, 1, True, 已预览分镜ID=replacement_id)
        self.assertEqual(accepted['result'][0]['segmentId'], replacement_id)
        self.assertTrue(self.project['confirmed'])

    def test_project_uses_stable_idempotency_and_real_typed_outputs(self):
        node = self.nodes['ZenithJoyVideoProject']()
        result = node.run(ASSET, REQUEST)
        self.assertEqual(self.api.call_args_list[0].args, ('POST', '/projects', {'sourceAssetId': ASSET, 'clientRequestId': REQUEST}))
        self.assertEqual(result['result'][0]['id'], PROJECT)
        self.assertEqual(result['ui']['project'][0]['segments'][0]['id'], SEGMENT)
        self.assertEqual(node.RETURN_TYPES, ('ZJ_VIDEO_PROJECT',))

    def test_unconfirmed_steps_pause_all_downstream_outputs_without_writes_or_paid_calls(self):
        selected = self.nodes['ZenithJoyVideoSegment']().run({'id': PROJECT}, 1, False)
        self.assertIsInstance(selected['result'][0], Blocker)
        remake = self.nodes['ZenithJoySegmentRemake']().run({'projectId': PROJECT, 'segmentId': SEGMENT, 'assetId': ASSET}, **{**self.options, '确认生成': False})
        self.assertEqual(len(remake['result']), 2)
        self.assertTrue(all(isinstance(value, Blocker) for value in remake['result']))
        assembled = self.nodes['ZenithJoyAssembleVideo']().run({'id': PROJECT}, False)
        self.assertIsInstance(assembled['result'][0], Blocker)
        self.assertFalse(any(method == 'PATCH' or method == 'POST' for method, _path, _payload in self.calls))
        self.submit.assert_not_called()

    def test_remake_saves_attempt_before_paid_submit_and_links_with_fresh_revision(self):
        selected = self.select()
        result = self.nodes['ZenithJoySegmentRemake']().run(selected, **self.options)
        patches = [(path, body) for method, path, body in self.calls if method == 'PATCH' and '/segments/' in path]
        self.assertEqual(patches[0][1]['clientRequestId'], self.submit.call_args.args[2])
        self.assertEqual(patches[0][1]['remake']['referenceAssetId'], ASSET)
        self.assertEqual(patches[1][1]['jobId'], JOB)
        self.assertGreater(patches[1][1]['expectedRevision'], patches[0][1]['expectedRevision'])
        self.assertEqual(result['result'][0]['jobId'], JOB)
        self.assertEqual(result['result'][1], 'native-video')
        self.assertEqual(result['ui']['edited'][0]['jobId'], JOB)
        before = len(patches)
        self.nodes['ZenithJoySegmentRemake']().run(selected, **self.options)
        after = len([1 for method, path, _payload in self.calls if method == 'PATCH' and '/segments/' in path])
        self.assertEqual(after, before, 'same version reruns must not reset already reviewed output')

    def test_auditing_requires_exact_current_task_and_new_versions_cannot_reuse_old_approval(self):
        selected = self.select()
        edited = self.nodes['ZenithJoySegmentRemake']().run(selected, **self.options)['result'][0]
        approve = self.nodes['ZenithJoyApproveSegment']()
        self.assertIsInstance(approve.run(edited, '')['result'][0], Blocker)
        self.assertFalse(self.project['segments'][0]['approved'])
        approved = approve.run(edited, JOB)
        self.assertTrue(self.project['segments'][0]['approved'])
        self.assertEqual(approved['result'][0]['id'], PROJECT)
        self.project['segments'][0]['jobId'] = '55555555-5555-5555-5555-555555555555'
        self.assertIsInstance(approve.run(edited, JOB)['result'][0], Blocker)

    def test_assembly_requires_every_segment_approved_and_downloads_project_result(self):
        assembled = self.nodes['ZenithJoyAssembleVideo']()
        self.assertIsInstance(assembled.run({'id': PROJECT}, True)['result'][0], Blocker)
        self.assertFalse(any(path.endswith('/assemble') for _method, path, _payload in self.calls))
        self.project['segments'][0]['approved'] = True
        self.project['confirmed'] = True
        result = assembled.run({'id': PROJECT}, True)
        self.assertEqual(result['result'], ('assembled-video',))
        self.download_project.assert_called_once_with(self.project)

    def test_request_identity_is_stable_per_project_segment_and_version(self):
        first = self.select()
        self.nodes['ZenithJoySegmentRemake']().run(first, **self.options)
        first_key = self.submit.call_args.args[2]
        self.nodes['ZenithJoySegmentRemake']().run(first, **self.options)
        self.assertEqual(self.submit.call_args.args[2], first_key)
        other = {**self.project['segments'][0], 'id': '55555555-5555-5555-5555-555555555555',
                 'assetId': '66666666-6666-6666-6666-666666666666', 'revision': 0, 'useOriginal': True}
        for key in ('jobId', 'job', 'clientRequestId', 'remake'):
            other.pop(key, None)
        self.project['segments'].append(other)
        second = self.nodes['ZenithJoyVideoSegment']().run({'id': PROJECT}, 2, True, 已预览分镜ID=other['id'])['result'][0]
        self.nodes['ZenithJoySegmentRemake']().run(second, **self.options)
        self.assertNotEqual(self.submit.call_args.args[2], first_key, 'selecting another segment cannot reuse the same paid idempotency key')
        self.assertRegex(first_key, r'^[a-f0-9]{64}$')

    def test_invalid_ids_upload_busy_and_changed_parameters_cannot_submit(self):
        with self.assertRaises(ValueError): self.nodes['ZenithJoyVideoProject']().run('../../token', REQUEST)
        self.submit.assert_not_called()
        selected = self.select()
        with self.assertRaises(ValueError): self.nodes['ZenithJoySegmentRemake']().run(selected, **{**self.options, '产品图片ID': '上传中'})
        self.nodes['ZenithJoySegmentRemake']().run(selected, **self.options)
        self.submit.reset_mock()
        self.project['segments'][0]['remake']['backgroundDescription'] = '森林'
        with self.assertRaisesRegex(ValueError, '生成新版本'): self.nodes['ZenithJoySegmentRemake']().run(selected, **self.options)
        self.submit.assert_not_called()

if __name__ == '__main__': unittest.main()
