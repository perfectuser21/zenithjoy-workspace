"""每次 pipeline 的唯一产物目录，不按关键词寻找其他运行。"""
import json
import os
import re
from pathlib import Path


def owned_directory(run_data, *, create=False):
    identity = str(run_data.get('pipeline_id') or '')
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,100}', identity):
        raise ValueError('pipeline_id 缺失或无效')
    base = Path(os.environ.get('CONTENT_OUTPUT_DIR') or str(Path.home() / 'content-output')).resolve()
    expected = base / 'runs' / identity
    supplied = run_data.get('output_dir')
    if supplied and Path(str(supplied)).resolve() != expected:
        raise ValueError('output_dir 不属于当前 pipeline')
    if expected.resolve() != expected or expected.is_symlink():
        raise ValueError('产物目录不允许符号链接或越界')
    if create:
        expected.mkdir(parents=True, exist_ok=True)
        for directory in ('cards', 'article'):
            child = expected / directory
            if child.resolve() != child:
                raise ValueError('产物子目录不允许符号链接')
            child.mkdir(exist_ok=True)
    return expected


def owned_file(run_data, relative):
    base = owned_directory(run_data)
    candidate = base / relative
    if '..' in Path(relative).parts or candidate.resolve() != candidate or not candidate.is_relative_to(base):
        raise ValueError('产物路径不允许符号链接或越界')
    return candidate


def load_findings(run_data):
    path = owned_file(run_data, 'findings.json')
    supplied = run_data.get('findings_path')
    if supplied and Path(str(supplied)).resolve() != path:
        raise ValueError('findings_path 不属于当前 pipeline')
    if not path.is_file():
        return []
    data = json.loads(path.read_text('utf-8'))
    return data.get('findings', [])


def guard(run_data):
    check = run_data.get('execution_guard')
    if callable(check):
        check()
