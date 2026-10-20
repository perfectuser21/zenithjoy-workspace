"""Compile fixed upstream C bodies, applying the shipped patch, without a device.

Only FFmpeg/OS boundaries are substitutes. Lifecycle bodies are extracted intact
from the hash-verified upstream source, not reimplemented by this test.
"""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
FUNCTIONS = ('sc_recorder_get_format_name', 'sc_recorder_open_output_file',
             'sc_recorder_close_output_file', 'sc_recorder_stream_init',
             'sc_recorder_init', 'sc_recorder_record', 'run_recorder',
             'sc_recorder_start', 'sc_recorder_stop',
             'sc_recorder_video_packet_sink_open',
             'sc_recorder_audio_packet_sink_open')


def function(source, name):
    # Upstream functions have their return type on a separate line. Preserve
    # each body byte-for-byte; no source-string assertions stand in for runtime.
    matches = list(re.finditer(r'(?m)^(?:static )?(?:inline )?[^\n;{}]+\n' + name + r'\(', source))
    if len(matches) != 1:
        raise AssertionError('missing or duplicate actual C function: ' + name)
    match = matches[0]
    start = source.index('{', match.start())
    depth = 1
    end = start + 1
    while depth:
        depth += (source[end] == '{') - (source[end] == '}')
        end += 1
    return source[match.start():end] + '\n'


class RecorderLifecycle(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='scrcpy-recorder-c-')
        cls.addClassCleanup(cls.temp.cleanup)
        root = Path(cls.temp.name)
        fixture = HERE / 'fixtures'
        raw = b''.join((fixture / f'scrcpy-3.3.4-recorder.part{i}.c').read_bytes()
                       for i in (1, 2))
        provenance = json.loads((fixture / 'scrcpy-3.3.4-recorder.provenance.json').read_text())
        if hashlib.sha256(raw).hexdigest() != provenance['sha256']:
            raise AssertionError('upstream recorder fixture digest mismatch')
        target = root / 'app/src/recorder.c'
        target.parent.mkdir(parents=True)
        target.write_bytes(raw)
        # The logger patch also needs its own file, but cannot affect lifecycle.
        patch = (HERE.parent / 'scrcpy-v3.3.4-log-flush.patch').read_text()
        recorder_patch = ''.join('diff --git ' + part for part in patch.split('diff --git ')[1:]
                                 if part.startswith('a/app/src/recorder.c '))
        if recorder_patch:
            subprocess.run(['git', 'apply', '--unsafe-paths', '-'], input=recorder_patch,
                           text=True, cwd=root, check=True, timeout=5)
        source = target.read_text()
        bodies = '\n'.join(function(source, name) for name in FUNCTIONS)
        harness = (HERE / 'recorder_lifecycle_regression.c').read_text()
        unit = root / 'test.c'
        unit.write_text(harness.replace('/* ACTUAL_UPSTREAM_FUNCTIONS */', bodies))
        cls.binary = root / 'test'
        compiled = subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra',
                                   '-Wno-unused-parameter', str(unit), '-o', str(cls.binary)],
                                  capture_output=True, text=True, timeout=30)
        if compiled.returncode:
            raise AssertionError('SETUP compiler failed:\n' + compiled.stderr)

    def run_case(self, name):
        result = subprocess.run([str(self.binary), name], capture_output=True,
                                text=True, timeout=3)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_start_initializes_before_worker_can_be_scheduled(self):
        self.run_case('start-before-worker')

    def test_stop_rejects_first_late_audio_open(self):
        self.run_case('late-audio')

    def test_normal_video_audio_open_once_and_close_once(self):
        self.run_case('normal')

    def test_failed_thread_creation_releases_output(self):
        self.run_case('thread-failure')

    def test_output_open_failure_never_starts_worker(self):
        self.run_case('file-failure')
