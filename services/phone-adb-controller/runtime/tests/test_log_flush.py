#!/usr/bin/env python3
"""Compile the real patched scrcpy logger; require live readiness visibility.

No device/ADB or production runtime is used. A missing fflush in util/log.c
reproduces the macOS regular-file stdout buffering bug deterministically.
"""
import argparse
import os
from pathlib import Path
import selectors
import shlex
import subprocess
import tempfile


def check(source, build_dir, pkg_config, sdl_package='sdl3'):
    env = os.environ.copy()
    flags = shlex.split(subprocess.check_output(
        [pkg_config, '--cflags', '--libs', 'libavutil', sdl_package],
        env=env, text=True))
    with tempfile.TemporaryDirectory(prefix='scrcpy-log-flush-') as temp:
        root = Path(temp)
        binary = root / 'logger'
        subprocess.run(['clang', '-std=c11',
                        '-I' + str(Path(build_dir) / 'app'),
                        '-I' + str(Path(source) / 'app/src'),
                        str(Path(__file__).with_name('log_flush_regression.c')),
                        str(Path(source) / 'app/src/util/log.c'), *flags,
                        '-o', str(binary)], check=True, timeout=60)
        log = root / 'capture.log'
        media = str(root / 'capture.wav')
        with log.open('wb') as target:
            child = subprocess.Popen([str(binary), media], stdout=target,
                                     stderr=subprocess.PIPE, stdin=subprocess.PIPE)
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(child.stderr, selectors.EVENT_READ)
                assert selector.select(timeout=3), 'logger did not return in time'
            assert child.stderr.readline() == b'logger returned\n'
            assert child.poll() is None, 'test must inspect a live recorder'
            expected = 'INFO: Recording started to wav file: ' + media + '\n'
            assert log.read_text() == expected, (
                'readiness INFO is buffered while process is alive: ' + repr(log.read_text()))
        finally:
            stdout, stderr = child.communicate(input=b'\n', timeout=3)
        assert child.returncode == 0, stderr
        assert log.read_text() == expected
    print('PASS: exact recording-start INFO visible in redirected file before exit')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'build-dir', 'pkg-config'):
        parser.add_argument('--' + key, required=True)
    parser.add_argument('--sdl-package', choices=['sdl2', 'sdl3'], default='sdl3')
    check(**vars(parser.parse_args()))
