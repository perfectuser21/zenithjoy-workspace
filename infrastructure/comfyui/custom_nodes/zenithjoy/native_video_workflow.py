"""Native Comfy business graph. All media work uses the employee's existing API.

This module deliberately has no tensor/model imports so the actual node classes
can be exercised independently of the CPU Comfy runtime.
"""
import hashlib
import re
import time


def _identifier(value, label):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}', value):
        raise ValueError('请使用有效的' + label)
    return value.lower()


def _request_identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{16,100}', value):
        raise ValueError('请先点击节点上的生成新版本按钮')
    return value


def _project_identity(value):
    if not isinstance(value, dict):
        raise ValueError('请连接视频项目节点')
    return _identifier(value.get('id'), '视频项目ID')


def _segment_identity(value):
    if not isinstance(value, dict):
        raise ValueError('请连接选中分镜节点')
    return (_identifier(value.get('projectId'), '视频项目ID'),
            _identifier(value.get('segmentId'), '分镜ID'),
            _identifier(value.get('assetId'), '分镜素材ID'))


def _safe_message(value, fallback):
    if isinstance(value, str) and 0 < len(value) <= 200 and not re.search(r'[\x00-\x1f]|https?://|Bearer |[A-Za-z0-9_=-]{48,}', value):
        return value
    return fallback


def _remake_config(asset_id, options):
    modes = {'保留产品': 'keep', '更换款式': 'replace', '更换颜色': 'color', '更换Logo': 'logo'}
    faces = {'尚未确认': 'unknown', '未露脸': 'absent', '有露脸': 'present'}
    if options.get('产品操作') not in modes or options.get('原片人脸') not in faces:
        raise ValueError('请选择有效的产品操作和原片人脸状态')
    for field in ('产品图片ID', '背景图片ID', '人脸图片ID'):
        value = options.get(field, '')
        if value == '上传中':
            raise ValueError('素材上传中，请等待上传完成后再运行')
        if value:
            _identifier(value, '图片素材ID')
    for field in ('产品说明', '目标颜色', '背景说明'):
        value = options.get(field, '')
        if not isinstance(value, str) or len(value) > 1000:
            raise ValueError(field + '不能超过 1000 字')
    mode = modes[options['产品操作']]
    background, face = options.get('更换背景'), options.get('更换人脸')
    if not isinstance(background, bool) or not isinstance(face, bool):
        raise ValueError('请选择是否更换背景和人脸')
    config = {'referenceAssetId': asset_id, 'productMode': mode, 'background': background,
              'face': face, 'facePresence': 'unknown'}
    if mode != 'keep':
        if mode != 'color' or options.get('产品图片ID'):
            config['productAssetId'] = _identifier(options.get('产品图片ID'), '目标产品或Logo图片ID')
        if options['产品说明'].strip():
            config['productDescription'] = options['产品说明'].strip()
        if mode == 'replace' and not config.get('productDescription'):
            raise ValueError('请填写产品品类和外观说明')
        if mode == 'color':
            config['targetColor'] = options['目标颜色'].strip()
            if not config['targetColor']:
                raise ValueError('请填写目标颜色')
    if background:
        if options['背景说明'].strip():
            config['backgroundDescription'] = options['背景说明'].strip()
        if options.get('背景图片ID'):
            config['backgroundAssetId'] = _identifier(options['背景图片ID'], '背景图片ID')
        if not config.get('backgroundDescription') and not config.get('backgroundAssetId'):
            raise ValueError('请填写背景说明或上传背景图片')
    if face:
        config['facePresence'] = faces[options['原片人脸']]
        if config['facePresence'] == 'unknown':
            raise ValueError('请先确认原片是否有露脸')
        if config['facePresence'] == 'present':
            config['faceAssetId'] = _identifier(options.get('人脸图片ID'), '目标人脸图片ID')
    if mode == 'keep' and not background and not (face and config['facePresence'] == 'present'):
        raise ValueError('请至少选择一项有效修改；原片未露脸时会跳过换脸')
    return config


def build_video_nodes(api, submit_and_wait, download_job, download_project, execution_blocker):
    """Inject existing authenticated transport and Comfy's pinned blocker type."""
    def read_project(project_id):
        project_id = _identifier(project_id, '视频项目ID')
        body = api('GET', '/projects/' + project_id).json()
        if not isinstance(body, dict) or body.get('id') != project_id or not isinstance(body.get('segments'), list):
            raise RuntimeError('视频项目返回无效结果，请重新加载项目')
        return body

    def find_segment(project, segment_id, asset_id=None):
        for segment in project['segments']:
            if isinstance(segment, dict) and segment.get('id') == segment_id:
                _identifier(segment.get('assetId'), '分镜素材ID')
                if asset_id is not None and segment['assetId'] != asset_id:
                    raise ValueError('分镜已经重新切分，请重新选择分镜后运行')
                if not isinstance(segment.get('revision', 0), int) or isinstance(segment.get('revision'), bool) or segment.get('revision', 0) < 0:
                    raise RuntimeError('分镜版本无效，请重新加载项目')
                return segment
        raise ValueError('分镜不存在或已经重新切分，请重新选择')

    def wait_project(project, processing):
        project_id = _project_identity(project)
        deadline = time.monotonic() + 900
        while project.get('status') == processing and time.monotonic() < deadline:
            time.sleep(3)
            project = read_project(project_id)
        if project.get('status') == 'failed':
            raise RuntimeError(_safe_message(project.get('error'), '视频处理失败，请检查项目后重试'))
        if project.get('status') == processing:
            raise RuntimeError('处理尚未完成，项目已保存；请保持当前版本重试，不必重复上传')
        return project

    def paused(count, message, **ui):
        return {'ui': {'text': [message], **ui}, 'result': tuple(execution_blocker(None) for _ in range(count))}

    def current_segment(value):
        project_id, segment_id, asset_id = _segment_identity(value)
        project = read_project(project_id)
        return project, find_segment(project, segment_id, asset_id)

    def segment_ui(project, segment):
        return {**segment, 'projectId': project['id'], 'segmentId': segment['id']}

    class VideoProject:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'原片视频ID': ('STRING', {'default': ''}), 'request_id': ('STRING', {'default': ''})}}
        RETURN_TYPES = ('ZJ_VIDEO_PROJECT',)
        RETURN_NAMES = ('视频项目',)
        FUNCTION = 'run'
        CATEGORY = 'ZenithJoy/短视频工作流'
        OUTPUT_NODE = True
        @classmethod
        def IS_CHANGED(cls, **kwargs):
            return float('nan')
        def run(self, 原片视频ID, request_id):
            source_id = _identifier(原片视频ID, '原片视频ID；请先上传完整视频')
            request_id = _request_identifier(request_id)
            project = api('POST', '/projects', {'sourceAssetId': source_id, 'clientRequestId': request_id}).json()
            project = wait_project(project, 'splitting')
            if not project.get('segments'):
                raise RuntimeError('原片尚未生成分镜，请检查项目后重试')
            return {'ui': {'project': [project], 'text': ['分镜已准备好，请预览并确认分镜']}, 'result': (project,)}

    class VideoSegment:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'视频项目': ('ZJ_VIDEO_PROJECT',), '分镜序号': ('INT', {'default': 1, 'min': 1, 'max': 120}), '确认分镜': ('BOOLEAN', {'default': False}), '已预览分镜ID': ('STRING', {'default': ''})}}
        RETURN_TYPES = ('ZJ_VIDEO_SEGMENT',)
        RETURN_NAMES = ('选中分镜',)
        FUNCTION = 'run'
        CATEGORY = 'ZenithJoy/短视频工作流'
        OUTPUT_NODE = True
        @classmethod
        def IS_CHANGED(cls, **kwargs):
            return float('nan')
        def run(self, 视频项目, 分镜序号, 确认分镜, 已预览分镜ID=''):
            project_id = _project_identity(视频项目)
            project = read_project(project_id)
            if not isinstance(分镜序号, int) or isinstance(分镜序号, bool) or 分镜序号 < 1 or 分镜序号 > len(project['segments']):
                raise ValueError('请选择当前项目中有效的分镜序号，从 1 开始')
            segment = find_segment(project, _identifier(project['segments'][分镜序号 - 1].get('id'), '分镜ID'))
            preview = {'project': [project], 'segment': [segment_ui(project, segment)]}
            if not 确认分镜:
                return paused(1, '请先预览全部分镜，再打开确认分镜；后续生成尚未执行', **preview)
            # Ordinals and confirmation booleans survive saved graph queues.
            # Re-cutting replaces segment UUIDs, so a previous preview cannot
            # authorize a new segment merely because its ordinal is unchanged.
            if 已预览分镜ID != segment['id']:
                return paused(1, '分镜已更新或尚未预览，请重新预览当前分镜后再确认；尚未执行生成', **preview)
            if not project.get('confirmed'):
                project = api('PATCH', '/projects/' + project_id, {'confirmed': True}).json()
                segment = find_segment(project, segment['id'])
            selected = {'projectId': project_id, 'segmentId': segment['id'], 'assetId': segment['assetId']}
            return {'ui': {'project': [project], 'segment': [segment_ui(project, segment)]}, 'result': (selected,)}

    class SegmentRemake:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'分镜': ('ZJ_VIDEO_SEGMENT',),
                '产品操作': (['保留产品', '更换款式', '更换颜色', '更换Logo'],),
                '产品图片ID': ('STRING', {'default': ''}), '产品说明': ('STRING', {'default': '', 'multiline': True}),
                '目标颜色': ('STRING', {'default': ''}), '更换背景': ('BOOLEAN', {'default': False}),
                '背景说明': ('STRING', {'default': '', 'multiline': True}), '背景图片ID': ('STRING', {'default': ''}),
                '更换人脸': ('BOOLEAN', {'default': False}), '原片人脸': (['尚未确认', '未露脸', '有露脸'],),
                '人脸图片ID': ('STRING', {'default': ''}), '确认生成': ('BOOLEAN', {'default': False}),
                'request_id': ('STRING', {'default': ''})}}
        RETURN_TYPES = ('ZJ_EDITED_SEGMENT', 'VIDEO')
        RETURN_NAMES = ('待审核分镜', '生成视频')
        FUNCTION = 'run'
        CATEGORY = 'ZenithJoy/短视频工作流'
        OUTPUT_NODE = True
        @classmethod
        def IS_CHANGED(cls, **kwargs):
            return float('nan')
        def run(self, 分镜, **options):
            project, segment = current_segment(分镜)
            if not options.get('确认生成'):
                return paused(2, '请选择修改内容并打开确认生成；尚未提交付费任务', segment=[segment_ui(project, segment)])
            if not project.get('confirmed'):
                raise ValueError('请先确认完整视频的分镜')
            local_request_id = _request_identifier(options.get('request_id'))
            request_id = hashlib.sha256(('zj-video-segment-v1:' + project['id'] + ':' + segment['id'] + ':' + local_request_id).encode('utf-8')).hexdigest()
            remake = _remake_config(segment['assetId'], options)
            if segment.get('clientRequestId') == request_id and segment.get('remake') != remake:
                raise ValueError('修改参数已变化，请先点击生成新版本，再确认生成')
            path = '/projects/' + project['id'] + '/segments/' + segment['id']
            if segment.get('clientRequestId') != request_id or segment.get('remake') != remake or segment.get('useOriginal'):
                project = api('PATCH', path, {'expectedRevision': segment.get('revision', 0), 'remake': remake,
                    'useOriginal': False, 'clientRequestId': request_id}).json()
                segment = find_segment(project, segment['id'])
            # Existing Wan transport persists the paid attempt before submitting,
            # and the stable request ID recovers it after a lost response.
            job = submit_and_wait('/jobs', {'kind': 'wan', 'remake': remake}, request_id)
            job_id = _identifier(job.get('id'), '生成任务ID')
            project = read_project(project['id'])
            segment = find_segment(project, segment['id'], remake['referenceAssetId'])
            if segment.get('clientRequestId') != request_id or segment.get('remake') != remake:
                raise RuntimeError('此分镜已在其他画布切换版本，请重新加载当前分镜，原任务已保留')
            if segment.get('jobId') != job_id:
                project = api('PATCH', path, {'expectedRevision': segment.get('revision', 0), 'jobId': job_id}).json()
                segment = find_segment(project, segment['id'])
            edited = {'projectId': project['id'], 'segmentId': segment['id'], 'assetId': segment['assetId'], 'jobId': job_id,
                      'videoUrl': job.get('videoUrl', '')}
            return {'ui': {'project': [project], 'edited': [edited], 'text': ['当前分镜已生成，请预览后确认使用']},
                    'result': (edited, download_job(job))}

    class ApproveSegment:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'修改结果': ('ZJ_EDITED_SEGMENT',), '审核任务ID': ('STRING', {'default': ''})}}
        RETURN_TYPES = ('ZJ_VIDEO_PROJECT',)
        RETURN_NAMES = ('视频项目',)
        FUNCTION = 'run'
        CATEGORY = 'ZenithJoy/短视频工作流'
        OUTPUT_NODE = True
        @classmethod
        def IS_CHANGED(cls, **kwargs):
            return float('nan')
        def run(self, 修改结果, 审核任务ID):
            project, segment = current_segment(修改结果)
            typed_job_id = _identifier(修改结果.get('jobId'), '生成任务ID')
            job = segment.get('job') or {}
            if 审核任务ID != typed_job_id or segment.get('jobId') != typed_job_id or job.get('id') != typed_job_id or job.get('status') != 'succeeded':
                return paused(1, '请预览本次结果，点击确认使用当前结果后再运行；新版本须重新审核',
                    project=[project], edited=[{**修改结果, 'currentJobId': segment.get('jobId', '')}])
            if not segment.get('approved'):
                project = api('PATCH', '/projects/' + project['id'] + '/segments/' + segment['id'],
                    {'expectedRevision': segment.get('revision', 0), 'approved': True}).json()
            return {'ui': {'project': [project], 'text': ['本分镜已审核，可继续下一分镜或合成']}, 'result': (project,)}

    class AssembleVideo:
        @classmethod
        def INPUT_TYPES(cls):
            return {'required': {'视频项目': ('ZJ_VIDEO_PROJECT',), '确认合成': ('BOOLEAN', {'default': False})}}
        RETURN_TYPES = ('VIDEO',)
        RETURN_NAMES = ('完整成片',)
        FUNCTION = 'run'
        CATEGORY = 'ZenithJoy/短视频工作流'
        OUTPUT_NODE = True
        @classmethod
        def IS_CHANGED(cls, **kwargs):
            return float('nan')
        def run(self, 视频项目, 确认合成):
            project_id = _project_identity(视频项目)
            project = read_project(project_id)
            if not 确认合成:
                return paused(1, '全部分镜预览审核后，再打开确认合成', project=[project])
            if not project.get('confirmed') or not project['segments'] or any(not segment.get('approved') for segment in project['segments']):
                return paused(1, '还有分镜尚未审核，请逐段预览并审核后再合成', project=[project])
            if project.get('status') != 'completed':
                if project.get('status') != 'assembling':
                    project = api('POST', '/projects/' + project_id + '/assemble', {}).json()
                project = wait_project(project, 'assembling')
            if project.get('status') != 'completed':
                raise RuntimeError('成片尚未准备好，请检查项目状态后重试')
            return {'ui': {'project': [project], 'text': ['完整视频已合成，原音轨与视频顺序已保留']},
                    'result': (download_project(project),)}

    return {'ZenithJoyVideoProject': VideoProject, 'ZenithJoyVideoSegment': VideoSegment,
            'ZenithJoySegmentRemake': SegmentRemake, 'ZenithJoyApproveSegment': ApproveSegment,
            'ZenithJoyAssembleVideo': AssembleVideo}
