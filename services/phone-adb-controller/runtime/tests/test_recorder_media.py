"""Full-source native regression, called by the SDK33 candidate builder."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess
import tempfile


def check(source, build_dir, pkg_config):
    source, build_dir = Path(source), Path(build_dir)
    flags = shlex.split(subprocess.check_output(
        [pkg_config, '--cflags', '--libs', 'libavformat', 'libavcodec', 'libavutil', 'sdl2'], text=True))
    with tempfile.TemporaryDirectory(prefix='scrcpy-real-recorder-') as temporary:
        root = Path(temporary)
        binary, media = root / 'regression', root / 'recording.wav'
        files = ['recorder.c', 'compat.c', 'util/memory.c', 'util/thread.c',
                 'util/str.c', 'util/strbuf.c', 'util/log.c', 'util/tick.c']
        command = ['cc', '-std=c11', '-I' + str(build_dir / 'app'),
                   '-I' + str(source / 'app/src'),
                   str(Path(__file__).with_name('recorder_media_regression.c')),
                   *(str(source / 'app/src' / name) for name in files), *flags, '-o', str(binary)]
        subprocess.run(command, check=True, timeout=60)
        clip = root / 'input.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=32x32:rate=10',
                        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.2',
                        '-c:v', 'mpeg4', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', str(clip)],
                       check=True, timeout=30)
        subprocess.run([str(binary), str(media), str(clip)], check=True, timeout=30)
        probe = subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                                         '-show_format', '-of', 'json', str(media) + '.valid'],
                                        text=True, timeout=10)
        result = json.loads(probe)
        audio = [s for s in result['streams'] if s['codec_type'] == 'audio']
        assert len(audio) == 1 and audio[0]['codec_name'] == 'pcm_s16le', result
        assert audio[0]['sample_rate'] == '48000' and audio[0]['channels'] == 2, result
        assert float(result['format']['duration']) >= .09, result
        muxed = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams',
                            '-show_format', '-of', 'json', str(media) + '.mkv'], text=True, timeout=10))
        assert sorted(s['codec_type'] for s in muxed['streams']) == ['audio', 'video'], muxed
        assert float(muxed['format']['duration']) >= .19, muxed
        print(json.dumps({'verified': True, 'real_source': str(source), 'media': result, 'muxed': muxed}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('source', 'build-dir', 'pkg-config'):
        parser.add_argument('--' + key, required=True)
    check(**vars(parser.parse_args()))
