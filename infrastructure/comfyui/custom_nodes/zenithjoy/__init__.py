"""ZenithJoy API nodes; credentials live only in the per-employee server environment."""
import io
import os
import time
import re
from urllib.parse import urlparse

import numpy as np
import requests
import torch
from PIL import Image


def _api(method, path, payload=None, stream=False):
    base = os.environ.get('ZENITHJOY_CANVAS_API', '').rstrip('/')
    token = os.environ.get('ZENITHJOY_CANVAS_TOKEN', '')
    parsed = urlparse(base)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or not token or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise RuntimeError('画布服务尚未配置，请联系管理员')
    try:
        response = requests.request(method, base + '/api/video-tools' + path,
            headers={'X-Creative-Instance-Token': token}, json=payload, timeout=35,
            allow_redirects=False, stream=stream)
    except requests.RequestException:
        raise RuntimeError('无法连接创作服务，请检查任务记录后重试') from None
    if response.status_code == 409:
        raise RuntimeError('参数已变化，请点击生成新版本')
    if not 200 <= response.status_code < 300:
        raise RuntimeError('创作服务请求失败，请联系管理员或查看任务记录')
    return response


def _submit_and_wait(path, payload, request_id, max_wait=900):
    if not re.fullmatch(r'[A-Za-z0-9_-]{16,100}', request_id):
        raise ValueError('请先点击节点上的生成新版本按钮')
    payload['clientRequestId'] = request_id
    try:
        job = _api('POST', path, payload).json()
        job_id = job['id']
        if not isinstance(job_id, str) or not all(c in '0123456789abcdefABCDEF-' for c in job_id):
            raise ValueError('bad job')
        deadline = time.monotonic() + max_wait
        while job.get('status') in ('pending', 'running') and time.monotonic() < deadline:
            time.sleep(4)
            job = _api('GET', path + '/' + job_id).json()
        if job.get('status') != 'succeeded':
            raise RuntimeError('任务未完成，请检查任务记录后重试')
        return job
    except (KeyError, ValueError, requests.RequestException):
        raise RuntimeError('创作服务返回无效结果，请查看任务记录') from None


def _image_from_asset(asset):
    url = asset.get('url', '')
    parsed = urlparse(url)
    host = parsed.hostname or ''
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.port or not host.endswith('.myqcloud.com') or '.cos.' not in host:
        raise RuntimeError('生成图片的素材地址无效')
    try:
        with requests.get(url, timeout=60, allow_redirects=False, stream=True) as response:
            if not response.ok:
                raise RuntimeError('读取生成图片失败')
            chunks, size = [], 0
            for chunk in response.iter_content(65536):
                size += len(chunk)
                if size > 20 * 1024 * 1024:
                    raise RuntimeError('生成图片超过大小限制')
                chunks.append(chunk)
        image = Image.open(io.BytesIO(b''.join(chunks))).convert('RGB')
        return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)
    except (requests.RequestException, OSError, ValueError):
        raise RuntimeError('读取生成图片失败') from None


class Image2Generate:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'prompt': ('STRING', {'multiline': True, 'default': ''}), 'request_id': ('STRING', {'default': ''})}}
    RETURN_TYPES = ('IMAGE', 'ZENITHJOY_ASSET', 'STRING')
    RETURN_NAMES = ('图片预览', '生成的素材', '素材任务ID')
    FUNCTION = 'run'
    CATEGORY = 'ZenithJoy'

    def run(self, prompt, request_id):
        if not prompt.strip():
            raise ValueError('请输入图片提示词')
        job = _submit_and_wait('/image-jobs', {'prompt': prompt}, request_id)
        asset = job.get('asset')
        if not isinstance(asset, dict):
            raise RuntimeError('图片任务未返回素材')
        return {'ui': {'text': [job['id']]}, 'result': (_image_from_asset(asset), asset, job['id'])}


class LoadSavedAsset:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'素材任务ID': ('STRING', {'default': ''})}}
    RETURN_TYPES = ('IMAGE', 'ZENITHJOY_ASSET')
    RETURN_NAMES = ('图片预览', '生成的素材')
    FUNCTION = 'run'
    CATEGORY = 'ZenithJoy'

    def run(self, 素材任务ID):
        if not re.fullmatch(r'[A-Fa-f0-9-]{36}', 素材任务ID):
            raise ValueError('请输入有效的素材任务ID')
        job = _api('GET', '/image-jobs/' + 素材任务ID).json()
        if job.get('status') != 'succeeded' or not isinstance(job.get('asset'), dict):
            raise RuntimeError('图片任务尚未完成，请稍后再试')
        return (_image_from_asset(job['asset']), job['asset'])


class ChooseAsset:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'选择第几张': ('INT', {'default': 1, 'min': 1, 'max': 4}), '素材1': ('ZENITHJOY_ASSET',)},
                'optional': {'素材2': ('ZENITHJOY_ASSET',), '素材3': ('ZENITHJOY_ASSET',), '素材4': ('ZENITHJOY_ASSET',)}}
    RETURN_TYPES = ('IMAGE', 'ZENITHJOY_ASSET')
    RETURN_NAMES = ('选中图片', '选中素材')
    FUNCTION = 'run'
    CATEGORY = 'ZenithJoy'

    def run(self, **kwargs):
        asset = kwargs.get('素材' + str(kwargs['选择第几张']))
        if not isinstance(asset, dict):
            raise ValueError('所选图片未连接，请选择已连接的图片')
        return (_image_from_asset(asset), asset)


class WanGenerate:
    @classmethod
    def INPUT_TYPES(cls):
        return {'required': {'素材': ('ZENITHJOY_ASSET',), 'prompt': ('STRING', {'multiline': True, 'default': ''}),
                             'duration': ('INT', {'default': 5, 'min': 2, 'max': 15}),
                             '确认生成': ('BOOLEAN', {'default': False}), 'request_id': ('STRING', {'default': ''})}}
    RETURN_TYPES = ('VIDEO',)
    RETURN_NAMES = ('视频',)
    FUNCTION = 'run'
    CATEGORY = 'ZenithJoy'

    def run(self, 素材, prompt, duration, 确认生成, request_id):
        if not 确认生成:
            raise ValueError('请先选好图片，再打开确认生成')
        if not prompt.strip():
            raise ValueError('请输入视频提示词')
        job = _submit_and_wait('/jobs', {'kind': 'wan', 'prompt': prompt, 'duration': duration,
                                       'media': [{'type': 'reference_image', 'url': 素材['url']}]}, request_id)
        import folder_paths
        from comfy_api.input_impl import VideoFromFile
        filename = os.path.join(folder_paths.get_temp_directory(), 'zenithjoy-' + job['id'] + '.mp4')
        try:
            with _api('GET', '/jobs/' + job['id'] + '/download', stream=True) as response, open(filename, 'wb') as output:
                size = 0
                for chunk in response.iter_content(65536):
                    size += len(chunk)
                    if size > 200 * 1024 * 1024:
                        raise RuntimeError('视频结果超过大小限制')
                    output.write(chunk)
            return (VideoFromFile(filename),)
        except Exception:
            if os.path.exists(filename):
                os.unlink(filename)
            raise


WEB_DIRECTORY = './web'
NODE_CLASS_MAPPINGS = {'ZenithJoyImage2': Image2Generate, 'ZenithJoyLoadAsset': LoadSavedAsset, 'ZenithJoyChooseAsset': ChooseAsset, 'ZenithJoyWan': WanGenerate}
NODE_DISPLAY_NAME_MAPPINGS = {'ZenithJoyImage2': 'Image2 图片生成', 'ZenithJoyLoadAsset': '加载已生成图片', 'ZenithJoyChooseAsset': '选择图片', 'ZenithJoyWan': 'Wan 视频生成'}
