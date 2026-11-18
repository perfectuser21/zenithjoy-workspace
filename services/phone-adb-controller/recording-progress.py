"""Bounded local recorder observations; never a coverage or business verdict."""
import json
import math
import os
import pathlib
import resource
import shlex
import stat
import subprocess
import sys
import tempfile

PROBE_SECONDS = 4
MAX_OUTPUT = 8 * 1024 * 1024


def regular(path, maximum):
    s = os.lstat(path)
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o022 or s.st_size > maximum:
        raise ValueError('unsafe_file')
    return s


def recorder_state(proof, media):
    try:
        regular(proof, 1024 * 1024)
        p = json.loads(pathlib.Path(proof).read_text())
        pid = p['pid']
        expected = p['expected_argv']
        original = p['observations'][-1]['ps'].split(None, 8)
        if (p['status'] != 'ready' or type(pid) is not int or pid <= 1 or len(original) != 9
                or original[0] != str(os.getuid()) or not isinstance(expected, list)
                or '--record=' + str(media) not in expected):
            return 'unknown'
        r = subprocess.run(['/bin/ps', '-ww', '-p', str(pid), '-o', 'uid=,ppid=,lstart=,stat=,command='],
                           capture_output=True, text=True, timeout=1)
        if r.returncode == 1 and not r.stdout.strip():
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return 'terminal'
            return 'unknown'
        now = r.stdout.strip().split(None, 8)
        if (r.returncode or len(now) != 9 or now[0] != original[0] or now[2:7] != original[2:7]
                or now[1] not in [str(p['parent_pid']), '1']):
            return 'unknown'
        args = shlex.split(now[8])
        if args and args[0] in ['/bin/zsh', '/bin/sh', '/bin/bash']:
            args = args[1:]
        if not args or os.path.realpath(args[0]) != os.path.realpath(expected[0]) or args[1:] != expected[1:]:
            return 'unknown'
        return 'terminal' if now[7].startswith('Z') else 'recording'
    except (OSError, ValueError, KeyError, IndexError, TypeError, OverflowError, subprocess.TimeoutExpired):
        return 'unknown'


def summarize(value):
    streams = value['streams']
    if not isinstance(streams, list) or not streams:
        raise ValueError('streams_missing')
    kinds = {}
    for stream in streams:
        kind, index = stream['codec_type'], stream['index']
        if kind not in ['video', 'audio'] or type(index) is not int or index in kinds or kind in kinds.values():
            raise ValueError('streams_ambiguous')
        kinds[index] = kind
    result = {'video': None, 'audio': None}
    for packet in value['packets']:
        kind = kinds[packet['stream_index']]
        pts = float(packet['pts_time'])
        if not math.isfinite(pts) or pts < 0:
            raise ValueError('packet_pts_invalid')
        previous = result[kind]
        if previous and pts < previous['last_pts_seconds']:
            raise ValueError('packet_pts_backwards')
        result[kind] = {'first_pts_seconds': previous['first_pts_seconds'] if previous else pts,
                        'last_pts_seconds': pts, 'packets': previous['packets'] + 1 if previous else 1}
    if all(x is None for x in result.values()):
        raise ValueError('packets_missing')
    return result


def observe(media, proof, ffprobe):
    media = pathlib.Path(media)
    result = {'schema': 'recording-progress/v1', 'capture_state': 'unknown', 'progress_status': 'unknown',
              'video': None, 'audio': None, 'coverage_verified': False, 'bytes': 0, 'reason': 'not_observed'}
    try:
        if not media.is_absolute() or not pathlib.Path(ffprobe).is_absolute():
            raise ValueError('absolute_path_required')
        before = regular(media, 1024 * 1024 * 1024)
        result['bytes'] = before.st_size
        result['capture_state'] = recorder_state(proof, media)
        if result['capture_state'] == 'unknown':
            raise ValueError('recorder_identity_unknown')
        # Temporary output bounds memory. The probe reads a local owned artifact only.
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as errors:
            try:
                r = subprocess.run([ffprobe, '-v', 'error', '-protocol_whitelist', 'file',
                                    '-format_whitelist', 'matroska,webm,wav',
                                    '-show_entries', 'stream=index,codec_type:packet=stream_index,pts_time',
                                    '-of', 'json', str(media)], stdout=output, stderr=errors, timeout=PROBE_SECONDS,
                                    preexec_fn=lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_OUTPUT, MAX_OUTPUT)))
            except subprocess.TimeoutExpired:
                result['reason'] = 'probe_timeout'
                return result
            if r.returncode or output.tell() > MAX_OUTPUT or errors.tell() > MAX_OUTPUT:
                raise ValueError('probe_unavailable')
            output.seek(0)
            observed = summarize(json.loads(output.read(MAX_OUTPUT + 1)))
        after = regular(media, 1024 * 1024 * 1024)
        if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino) or after.st_size < before.st_size:
            raise ValueError('media_changed')
        end_state = recorder_state(proof, media)
        if end_state == 'unknown' or (result['capture_state'] == 'terminal' and end_state != 'terminal'):
            result['capture_state'] = 'unknown'
            raise ValueError('recorder_identity_unknown')
        result.update(observed, capture_state=end_state, progress_status='observed', reason='sampled_packet_pts')
    except (OSError, ValueError, KeyError, IndexError, TypeError, subprocess.SubprocessError):
        result['reason'] = 'progress_unavailable'
    return result


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: recording-progress.py MEDIA STARTUP_PROOF FFPROBE')
    observation = observe(*sys.argv[1:])
    state = {'recording': 'recording', 'terminal': 'stopped'}.get(observation['capture_state'], 'unknown')
    print('state=' + state + ' bytes=' + str(observation['bytes']) + ' path=' + sys.argv[1])
    print('media_progress=' + json.dumps(observation, separators=(',', ':')))
