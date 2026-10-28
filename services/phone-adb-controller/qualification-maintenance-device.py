#!/usr/bin/env python3
"""固定5037 smart-socket只读观察；不运行ADB客户端/服务，不发UI/停止命令。"""
import hashlib
import json
import re
import socket
import time

PACKAGE = 'com.ss.android.ugc.aweme'
QUERIES = {
    'sdk': 'getprop ro.build.version.sdk',
    'processes': 'ps -A -o UID,PID,PPID,NAME',
    'projection': 'dumpsys media_projection',
    'audio': 'dumpsys audio',
    'package': 'cmd package list packages -U ' + PACKAGE,
    'foreground': 'dumpsys window windows',
}


def need(value):
    if not value:
        raise ValueError('MAINTENANCE_DEVICE_OBSERVATION_UNKNOWN')


def receive(sock, count):
    result = b''
    while len(result) < count:
        part = sock.recv(count - len(result))
        need(part)
        result += part
    return result


def request(sock, command):
    raw = command.encode('ascii')
    sock.sendall(('%04x' % len(raw)).encode() + raw)
    need(receive(sock, 4) == b'OKAY')


def read_query(serial, key, *, connector=None, uid=None):
    need(isinstance(serial, str) and re.fullmatch(r'[A-Za-z0-9_-]{1,120}', serial))
    need(key in QUERIES or key == 'owners' and type(uid) is int and 0 < uid < 2**31)
    command = QUERIES[key] if key in QUERIES else 'cmd package list packages -U --uid %d' % uid
    connect = connector or (lambda: socket.create_connection(('127.0.0.1', 5037), timeout=3))
    version = connect()
    try:
        version.settimeout(3)
        request(version, 'host:version')
        length = receive(version, 4)
        need(re.fullmatch(b'[0-9a-fA-F]{4}', length) and int(length, 16) == 4)
        need(receive(version, 4) == b'0029')  # 现役ADB协议41；失败绝不start-server兜底。
    finally:
        version.close()
    sock = connect()
    try:
        sock.settimeout(3)
        request(sock, 'host:transport:' + serial)
        request(sock, 'shell:' + command)
        raw = bytearray()
        deadline = time.monotonic() + 8
        while True:
            need(time.monotonic() < deadline)
            part = sock.recv(65536)
            if not part:
                break
            raw.extend(part)
            need(len(raw) <= 4 * 1024 * 1024)
        need(raw and b'\0' not in raw)
        return raw.decode('utf-8', errors='strict').replace('\r\n', '\n')
    finally:
        sock.close()


def parse_processes(raw):
    lines = raw.splitlines()
    need(lines and lines[0].split() == ['UID', 'PID', 'PPID', 'NAME'])
    seen, capture, unknown_capture = set(), [], []
    for line in lines[1:]:
        fields = line.split(None, 3)
        need(len(fields) == 4 and fields[1].isdigit() and fields[2].isdigit()
             and int(fields[1]) > 0 and int(fields[1]) not in seen)
        seen.add(int(fields[1]))
        if re.search(r'scrcpy|screenrecord|qualification.*record', fields[3], re.I):
            capture.append(int(fields[1]))
        elif re.search(r'(?:^|/)app_process(?:32|64)?(?:\s|$)', fields[3]):
            # Toybox NAME只有argv[0]；未知Java入口不能冒认不是audio-only recorder。
            unknown_capture.append(int(fields[1]))
    need(seen)
    return {'process_count': len(seen), 'capture_pids': capture, 'unknown_capture_pids': unknown_capture}


def parse_projection(raw):
    # 只认完整明确的无投影格式；缺服务/未解析内容一律unknown。
    inactive = re.fullmatch(r'MEDIA PROJECTION MANAGER \(dumpsys media_projection\)\n[ \t]*Media Projection:[ \t]*(?:\(null\)|\nnull)[ \t]*\n?', raw)
    return {'state': 'inactive' if inactive else 'unknown'}


def parse_native_audio(raw, uid):
    # 固定353 SDK36当前players语法；不使用Events log历史记录推断当前状态。
    monitor = re.search(r'(?m)^PlaybackActivityMonitor[^\n]*$', raw)
    unknown = {'state': 'unknown', 'uid': uid}
    if not monitor:
        return unknown
    tail = raw[monitor.end():]
    players = re.search(r'(?m)^[ \t]*players:[ \t]*$', tail)
    if not players:
        return unknown
    block = re.split(r'(?m)^[ \t]*Events log:', tail[players.end():], maxsplit=1)[0]
    tracks = []
    for line in block.splitlines():
        if not re.match(r'^[ \t]*(?:\(not logged\)[ \t]*)?AudioPlaybackConfiguration ', line):
            continue
        match = re.search(r'piid:([0-9]+).*?type:android\.media\.AudioTrack u/pid:([0-9]+)/([0-9]+) state:([a-z]+) attr:.*?usage=USAGE_MEDIA\b.*?mutedState:([a-zA-Z]+(?: [a-zA-Z]+)*?)[ \t]+FormatInfo', line)
        if not match:
            if 'type:android.media.AudioTrack ' in line and 'usage=USAGE_MEDIA' in line:
                return unknown
            continue
        if int(match[2]) == uid:
            tracks.append({'piid': int(match[1]), 'pid': int(match[3]), 'state': match[4], 'muted': match[5].strip()})
    active = [t for t in tracks if t['state'] == 'started']
    if len(active) == 1 and active[0]['muted'] == 'none':
        return {'state': 'started', 'uid': uid, 'pid': active[0]['pid'], 'piid': active[0]['piid']}
    if tracks and all(t['state'] in ('paused', 'stopped', 'idle') and t['muted'] == 'none' for t in tracks):
        return {'state': 'inactive', 'uid': uid}
    return unknown


def _collect_device(serial, values, checkpoint):
    started = int(time.time() * 1000)
    for key in QUERIES:
        checkpoint['stage'] = 'query_' + key
        values[key] = read_query(serial, key)
    checkpoint['stage'] = 'parse_package'
    need(values['sdk'].strip() == '36')
    matches = re.findall(r'(?m)^package:' + re.escape(PACKAGE) + r' uid:([0-9]+)$', values['package'])
    need(len(matches) == 1 and int(matches[0]) > 0)
    uid = int(matches[0])
    checkpoint['stage'] = 'query_owners'
    values['owners'] = read_query(serial, 'owners', uid=uid)
    checkpoint['stage'] = 'parse_owners'
    need(values['owners'].strip() == 'package:%s uid:%d' % (PACKAGE, uid))
    checkpoint['stage'] = 'parse_processes'
    before = parse_processes(values['processes'])
    checkpoint['stage'] = 'query_processes_after'
    values['processes_after'] = read_query(serial, 'processes')
    checkpoint['stage'] = 'query_projection_after'
    values['projection_after'] = read_query(serial, 'projection')
    checkpoint['stage'] = 'parse_after'
    after = parse_processes(values['processes_after'])
    projection = parse_projection(values['projection'])
    projection_after = parse_projection(values['projection_after'])
    audio = parse_native_audio(values['audio'], uid)
    foreground = re.findall(r'mCurrentFocus=Window\{[^\n]*?\s(com\.ss\.android\.ugc\.aweme)/([^\s}]+)', values['foreground'])
    consistent = (not before['capture_pids'] and not after['capture_pids']
                and not before['unknown_capture_pids'] and not after['unknown_capture_pids']
                and projection['state'] == projection_after['state'] == 'inactive'
                and audio['state'] == 'started')
    # 仅采集器；必须再与正式原件recording的UID/原恢复状态绑定，不能自行授予effects。
    return {'status': 'observed' if consistent else 'blocked', 'domain': 'fixed353_device_capture_and_restored_playback',
            'serial': serial, 'sdk': 36, 'uid': uid, 'audio': audio,
            'processes': before, 'processes_after': after, 'projection': projection,
            'projection_after': projection_after, 'foreground_verified': len(foreground) == 1,
            'observed_at_ms': started, 'completed_at_ms': int(time.time() * 1000),
            'normalized_text_sha256': {key: hashlib.sha256(value.encode()).hexdigest() for key, value in values.items()}}


def collect_device(serial):
    values, checkpoint = {}, {'stage': 'start'}
    try:
        return _collect_device(serial, values, checkpoint)
    except Exception:
        lines = values.get('processes', '').splitlines()
        header = lines[0] if lines and re.fullmatch(r'[A-Z ,:]{1,120}', lines[0]) else 'unrecognized'
        owners = values.get('owners', '').splitlines()
        return {'status': 'blocked', 'stage': checkpoint['stage'],
                'code': 'MAINTENANCE_DEVICE_OBSERVATION_UNKNOWN',
                'normalized_text_sha256': {key: hashlib.sha256(value.encode()).hexdigest() for key, value in values.items()},
                'diagnostics': {'process_header': header, 'process_line_count': len(lines),
                                'process_row_widths': sorted(set(len(line.split()) for line in lines[1:])),
                                'owner_line_count': len(owners),
                                'owner_shapes': [bool(re.fullmatch(r'package:[A-Za-z0-9_.]+ uid:[0-9]+', line.strip())) for line in owners]}}
