import importlib.util
import os
import sys
import unittest
from unittest.mock import patch

path = os.path.join(os.path.dirname(__file__), '..', 'custom_nodes', 'zenithjoy', '__init__.py')
spec = importlib.util.spec_from_file_location('zenithjoy_nodes', path)
nodes = importlib.util.module_from_spec(spec)
import comfy.options
comfy.options.enable_args_parsing()
sys.argv.append('--cpu')
spec.loader.exec_module(nodes)
sys.argv.remove('--cpu')


class NodesTest(unittest.TestCase):
    def test_instance_credential_is_environment_only(self):
        self.assertNotIn('token', str(nodes.Image2Generate.INPUT_TYPES()).lower())
        self.assertNotIn('token', str(nodes.WanGenerate.INPUT_TYPES()).lower())
        with patch.dict(os.environ, {'ZENITHJOY_CANVAS_API': 'http://api:3000', 'ZENITHJOY_CANVAS_TOKEN': 'secret'}), patch.object(nodes.requests, 'request') as req:
            req.return_value.status_code = 200
            nodes._api('GET', '/image-jobs/123')
            self.assertEqual(req.call_args.kwargs['headers']['X-Creative-Instance-Token'], 'secret')
            self.assertNotIn('secret', req.call_args.args[1])
            self.assertFalse(req.call_args.kwargs['allow_redirects'])

    def test_image_to_choice_to_wan_uses_selected_asset(self):
        first = {'url': 'https://first.example/image'}
        second = {'url': 'https://second.example/image'}
        with patch.object(nodes, '_submit_and_wait', side_effect=[{'id':'11111111-1111-1111-1111-111111111111','asset': first}, {'id':'22222222-2222-2222-2222-222222222222','asset': second}]) as submit, patch.object(nodes, '_image_from_asset', side_effect=lambda asset: asset['url']):
            _, a, _ = nodes.Image2Generate().run('first', 'a'*32)['result']
            _, b, _ = nodes.Image2Generate().run('second', 'b'*32)['result']
            image, chosen = nodes.ChooseAsset().run(**{'选择第几张': 2, '素材1': a, '素材2': b})
            self.assertEqual(image, second['url'])
            self.assertEqual(chosen, second)
            self.assertEqual(submit.call_count, 2)
            with self.assertRaisesRegex(ValueError, '请先选好图片'):
                nodes.WanGenerate().run(chosen, 'animate', 5, False, 'c'*32)
            self.assertEqual(submit.call_count, 2)

    def test_confirmed_wan_sends_the_selected_asset_and_returns_video(self):
        asset = {'id': '11111111-1111-1111-1111-111111111111', 'url': 'https://bucket.cos.ap-guangzhou.myqcloud.com/chosen.png'}
        response = unittest.mock.MagicMock()
        response.json.return_value = {**asset, 'url': 'https://bucket.cos.ap-guangzhou.myqcloud.com/renewed.png'}
        response.__enter__.return_value = response
        response.iter_content.return_value = [b'video bytes']
        with patch.object(nodes, '_submit_and_wait', return_value={'id': '12345678-1234-1234-1234-123456789abc'}) as submit, patch.object(nodes, '_api', return_value=response):
            video, = nodes.WanGenerate().run(asset, 'animate the selected photo', 5, True, 'c'*32)
            self.assertIsNotNone(video)
            payload = submit.call_args.args[1]
            self.assertEqual(payload['media'], [{'type': 'reference_image', 'url': 'https://bucket.cos.ap-guangzhou.myqcloud.com/renewed.png'}])
            self.assertEqual(payload['kind'], 'wan')

    def test_conflicting_generation_displays_request_new_version_instruction(self):
        response = unittest.mock.MagicMock()
        response.status_code = 409
        with patch.dict(os.environ, {'ZENITHJOY_CANVAS_API': 'http://api:3000', 'ZENITHJOY_CANVAS_TOKEN': 'secret'}), patch.object(nodes.requests, 'request', return_value=response):
            with self.assertRaisesRegex(RuntimeError, '参数已变化，请点击生成新版本'):
                nodes._submit_and_wait('/image-jobs', {'prompt': 'cat'}, 'a'*32)

    def test_legacy_conflict_asks_for_history_review_before_new_generation(self):
        response = unittest.mock.MagicMock()
        response.status_code = 409
        response.json.return_value = {'error': '旧任务的参数或素材地址已变化，无法确认与原任务一致'}
        with patch.dict(os.environ, {'ZENITHJOY_CANVAS_API': 'http://api:3000', 'ZENITHJOY_CANVAS_TOKEN': 'secret'}), patch.object(nodes.requests, 'request', return_value=response):
            with self.assertRaisesRegex(RuntimeError, '请先核对历史记录'):
                nodes._submit_and_wait('/jobs', {'prompt': 'cat'}, 'a'*32)

    def test_same_request_id_is_used_across_retries_and_saved_asset_can_be_reloaded(self):
        response = unittest.mock.MagicMock()
        response.json.side_effect = [{'id': '11111111-1111-1111-1111-111111111111', 'status': 'succeeded', 'asset': {'url': 'safe'}}]
        with patch.object(nodes, '_api', return_value=response) as api:
            result = nodes._submit_and_wait('/image-jobs', {'prompt': 'cat'}, 'a'*32)
            self.assertEqual(api.call_args.args[2]['clientRequestId'], 'a'*32)
            self.assertEqual(result['status'], 'succeeded')
        response.json.return_value = result
        response.json.side_effect = None
        with patch.object(nodes, '_api', return_value=response) as api, patch.object(nodes, '_image_from_asset', return_value='image'):
            image, asset = nodes.LoadSavedAsset().run(result['id'])
            self.assertEqual(image, 'image')
            self.assertEqual(asset, result['asset'])
            self.assertEqual(api.call_args.args, ('GET', '/image-jobs/' + result['id']))

    def test_upload_node_registers_image_bytes_and_outputs_wan_asset(self):
        image = nodes.torch.ones((1, 256, 256, 3))
        response = unittest.mock.MagicMock()
        response.json.return_value = {'id': '11111111-1111-1111-1111-111111111111', 'url': 'https://bucket.cos.ap-guangzhou.myqcloud.com/x.png', 'kind': 'image'}
        with patch.object(nodes, '_api', return_value=response) as api:
            preview, asset = nodes.RegisterUploadedImage().run(image, 1)
            self.assertEqual(asset['id'], response.json.return_value['id'])
            self.assertEqual(tuple(preview.shape), (1,256,256,3))
            part = api.call_args.kwargs['files']['file']
            self.assertEqual(part[0], 'canvas.png')
            self.assertTrue(part[1].startswith(b'\x89PNG\r\n\x1a\n'))
        with self.assertRaisesRegex(ValueError, '没有对应图片'):
            nodes.RegisterUploadedImage().run(image, 2)

    def test_large_image_is_rejected_before_builtin_loader_decodes_pixels(self):
        import tempfile
        from PIL import Image
        with tempfile.NamedTemporaryFile(suffix='.png') as f:
            Image.new('RGB', (2049, 2049)).save(f.name)
            with patch.object(nodes.folder_paths, 'get_annotated_filepath', return_value=f.name), patch.object(nodes, '_original_load_image') as load:
                with self.assertRaisesRegex(ValueError, '图片像素不能超过'):
                    nodes._checked_load_image(None, 'huge.png')
                load.assert_not_called()

    def test_upload_node_rejects_images_above_pixel_limit(self):
        image = nodes.torch.zeros((1, 2049, 2049, 3))
        with patch.object(nodes, '_api') as api:
            with self.assertRaisesRegex(ValueError, '图片像素不能超过'):
                nodes.RegisterUploadedImage().run(image, 1)
            api.assert_not_called()

    def test_untrusted_image_url_is_rejected_before_fetch(self):
        with patch.object(nodes.requests, 'get') as get:
            with self.assertRaises(RuntimeError):
                nodes._image_from_asset({'url': 'http://169.254.169.254/metadata'})
            get.assert_not_called()


if __name__ == '__main__':
    unittest.main()
