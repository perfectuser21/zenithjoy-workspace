"""Mandatory native FFmpeg regression: CI entry and SDK33 builder entry, no device.

Not test_*.py: ordinary mocked runtime discovery does not claim this native test.
The existing Darwin native CI job executes it explicitly with real development
headers; candidate builds execute it again with their actual FFmpeg toolchain.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import tempfile

from test_recorder_lifecycle import function

HERE = Path(__file__).resolve().parent


def patched_fixture(root):
    fixture = HERE / 'fixtures'
    raw = b''.join((fixture / ('scrcpy-3.3.4-recorder.part%d.c' % i)).read_bytes()
                   for i in (1, 2))
    origin = json.loads((fixture / 'scrcpy-3.3.4-recorder.provenance.json').read_text())
    if hashlib.sha256(raw).hexdigest() != origin['sha256']:
        raise AssertionError('upstream fixture SHA mismatch')
    target = root / 'app/src/recorder.c'
    target.parent.mkdir(parents=True)
    target.write_bytes(raw)
    patch = (HERE.parent / 'scrcpy-v3.3.4-log-flush.patch').read_text()
    recorder_patch = ''.join('diff --git ' + p for p in patch.split('diff --git ')[1:]
                             if p.startswith('a/app/src/recorder.c '))
    subprocess.run(['git', 'apply', '--unsafe-paths', '-'], input=recorder_patch,
                   text=True, cwd=root, check=True, timeout=5)
    return target


def check(source=None, pkg_config='pkg-config', ffmpeg_prefix=None):
    policy = json.loads((HERE.parent / 'runtime-policy-sdk33.json').read_text())
    if ffmpeg_prefix:
        prefix = Path(ffmpeg_prefix)
        flags = ['-I' + str(prefix / 'include'), '-L' + str(prefix / 'lib'),
                 '-lavformat', '-lavcodec', '-lavutil']
    else:
        flags = shlex.split(subprocess.check_output(
            [pkg_config, '--cflags', '--libs', 'libavformat', 'libavcodec', 'libavutil'],
            text=True, timeout=10))
    with tempfile.TemporaryDirectory(prefix='scrcpy-header-native-') as temporary:
        root = Path(temporary)
        target = Path(source) / 'app/src/recorder.c' if source else patched_fixture(root)
        raw = target.read_bytes()
        if hashlib.sha256(raw).hexdigest() != policy['patched_recorder_sha256']:
            raise AssertionError('actual patched recorder SHA mismatch')
        body = function(raw.decode(), 'sc_recorder_process_header')
        harness = (HERE / 'recorder_header_regression.c').read_text()
        unit, binary, media = root / 'header.c', root / 'header', root / 'media.mkv'
        unit.write_text(harness.replace('/* ACTUAL_UPSTREAM_HEADER_FUNCTION */', body))
        subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', str(unit), *flags,
                        '-o', str(binary)], check=True, timeout=30)
        failures = []
        for case in ('header', 'write-error', 'header-error'):
            result = subprocess.run([str(binary), case, str(media)], capture_output=True,
                                    text=True, timeout=5)
            if result.returncode:
                failures.append({'case': case, 'exit': result.returncode,
                                 'stderr': result.stderr})
        if failures:
            raise AssertionError(json.dumps(failures))
        # header-error opens the same output path; preserve the success media in
        # one fresh execution, then independently verify the actual encoded file.
        subprocess.run([str(binary), 'header', str(media)], check=True, timeout=5)
        probe = json.loads(subprocess.check_output(
            ['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(media)],
            text=True, timeout=10))
        audio = probe['streams']
        assert len(audio) == 1 and audio[0]['codec_name'] == 'pcm_s16le', probe
        assert audio[0]['sample_rate'] == '48000' and audio[0]['channels'] == 2, probe
        assert float(probe['format']['duration']) >= .09, probe
        print(json.dumps({'verified': True, 'patched_recorder_sha256': policy['patched_recorder_sha256'],
                          'cases': ['live-header-nonzero', 'flush-write-EIO', 'header-failure'],
                          'media_bytes': media.stat().st_size, 'audio': audio,
                          'duration': probe['format']['duration']}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source')
    parser.add_argument('--pkg-config', default='pkg-config')
    parser.add_argument('--ffmpeg-prefix')
    check(**vars(parser.parse_args()))
