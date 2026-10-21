#!/usr/bin/env python3
"""只读既有本机ADB smart-socket，按精确serial唯一选路；不启动/重连server。"""
import os
from pathlib import Path
import json
import re
import socket
import stat
import subprocess
import sys
import time

PORTS = (5037, 5041, 5042)


def read_host_policy(path=None):
    """Explicit or installed host policy is authoritative for every reader."""
    if path is not None:
        pass
    elif 'ZJ_ADB_HOST_CONFIG' in os.environ:
        path = os.environ['ZJ_ADB_HOST_CONFIG']
    else:
        path = str(Path.home() / '.config/zenithjoy/adb-service.json')
        if not os.path.lexists(path):
            return None
    if not path or not os.path.isabs(path):
        raise ValueError('ADB_HOST_CONFIG_PATH')
    try:
        info = os.lstat(path)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError('ADB_HOST_CONFIG_PERMISSIONS')
        with open(path, encoding='utf8') as source:
            policy = json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError('ADB_HOST_CONFIG_UNREADABLE') from error
    if not isinstance(policy, dict) or type(policy.get('schema_version')) is not int or policy['schema_version'] != 1:
        raise ValueError('ADB_HOST_CONFIG_SCHEMA')
    if policy.get('host_id') not in ('xian-m4', 'mmv') or policy.get('transport') not in ('usb', 'tcp'):
        raise ValueError('ADB_HOST_CONFIG_IDENTITY')
    if (policy['host_id'] == 'xian-m4') != (policy['transport'] == 'usb'):
        raise ValueError('ADB_HOST_CONFIG_TRANSPORT')
    endpoint = policy.get('endpoint')
    match = re.fullmatch(r'tcp:127\.0\.0\.1:([0-9]{1,5})', endpoint) if isinstance(endpoint, str) else None
    if not match or not 1 <= int(match[1]) <= 65535:
        raise ValueError('ADB_HOST_CONFIG_ENDPOINT')
    primary = int(match[1])
    forbidden = policy.get('forbidden_ports')
    if not isinstance(forbidden, list) or len(forbidden) > 8 or any(type(p) is not int or not 1 <= p <= 65535 or p == primary for p in forbidden):
        raise ValueError('ADB_HOST_CONFIG_FORBIDDEN_PORTS')
    if len(set(forbidden)) != len(forbidden):
        raise ValueError('ADB_HOST_CONFIG_FORBIDDEN_PORTS')
    if 'adb_bin' in policy and (not isinstance(policy['adb_bin'], str) or not os.path.isabs(policy['adb_bin']) or '\x00' in policy['adb_bin']):
        raise ValueError('ADB_HOST_CONFIG_BINARY')
    return {**policy, 'port': primary}


def smart_request(port, service, deadline):
    """Read the existing socket directly, without an adb client or server spawn."""
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ValueError('ADB_ROUTE_TIMEOUT')
    try:
        connection = socket.create_connection(('127.0.0.1', port), timeout=min(.4, remaining))
    except ConnectionRefusedError:
        return None
    with connection:
        def exact(count):
            data = b''
            while len(data) < count:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ValueError('ADB_ROUTE_TIMEOUT')
                connection.settimeout(min(.4, remaining))
                part = connection.recv(count - len(data))
                if not part:
                    raise ValueError('ADB_ROUTE_RESPONSE_INCOMPLETE')
                data += part
            return data
        value = service.encode('ascii')
        connection.sendall(('%04x' % len(value)).encode('ascii') + value)
        if exact(4) != b'OKAY':
            raise ValueError('ADB_ROUTE_RESPONSE_INVALID')
        size = int(exact(4), 16)
        if not 0 <= size <= (16 if service == 'host:version' else 65536):
            raise ValueError('ADB_ROUTE_RESPONSE_TOO_LARGE')
        return exact(size).decode('utf8')


def inspect_managed_host(policy=None, *, budget=2.0):
    policy = read_host_policy() if policy is None else policy
    if policy is None:
        raise ValueError('ADB_HOST_CONFIG_REQUIRED')
    deadline = time.monotonic() + budget
    for port in [policy['port'], *policy['forbidden_ports']]:
        version = smart_request(port, 'host:version', deadline)
        if version is None:
            if port == policy['port']:
                raise ValueError('ADB_HOST_SERVER_UNAVAILABLE')
            continue
        if not re.fullmatch(r'[0-9a-fA-F]+', version) or int(version, 16) != 41:
            raise ValueError('ADB_ROUTE_PROTOCOL_MISMATCH')
        if port != policy['port']:
            raise ValueError('ADB_HOST_EXTRA_SERVER port=%s' % port)
    raw = smart_request(policy['port'], 'host:devices', deadline)
    if raw is None:
        raise ValueError('ADB_ROUTE_SERVER_DISAPPEARED')
    devices = []
    seen = set()
    for row in raw.splitlines():
        fields = row.split('\t')
        if len(fields) != 2 or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', fields[0]) or fields[0] in seen:
            raise ValueError('ADB_ROUTE_DEVICES_INVALID')
        seen.add(fields[0])
        devices.append({'serial': fields[0], 'state': fields[1]})
    return {'host_id': policy['host_id'], 'endpoint': policy['endpoint'], 'port': policy['port'], 'devices': devices}


def select_route(serial, configured='', *, ports=PORTS, budget=2.0):
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', serial):
        raise ValueError('ADB_ROUTE_SERIAL_INVALID')
    preferred = None
    if configured:
        match = re.fullmatch(r'tcp:127\.0\.0\.1:([0-9]{1,5})', configured)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise ValueError('ADB_ROUTE_SOCKET_INVALID')
        preferred = int(match[1])
    policy = read_host_policy()
    if policy:
        if preferred is not None and preferred != policy['port']:
            raise ValueError('ADB_HOST_ENDPOINT_MISMATCH')
        measured = inspect_managed_host(policy, budget=budget)
        matching = [row for row in measured['devices'] if row['serial'] == serial]
        if not matching:
            raise ValueError('ADB_ROUTE_TARGET_UNAVAILABLE serial=%s ports=%s' % (serial, [policy['port']]))
        if matching[0]['state'] != 'device':
            raise ValueError('ADB_ROUTE_TARGET_OFFLINE serial=%s port=%s state=%s' % (serial, policy['port'], matching[0]['state']))
        return policy['port']
    return select_existing_unique_route(serial, configured, ports=ports, budget=budget)


def select_existing_unique_route(serial, configured='', *, ports=PORTS, budget=2.0):
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', serial):
        raise ValueError('ADB_ROUTE_SERIAL_INVALID')
    preferred = None
    if configured:
        match = re.fullmatch(r'tcp:127\.0\.0\.1:([0-9]{1,5})', configured)
        if not match or not 1 <= int(match[1]) <= 65535:
            raise ValueError('ADB_ROUTE_SOCKET_INVALID')
        preferred = int(match[1])
    deadline = time.monotonic() + budget

    def request(port, service):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError('ADB_ROUTE_TIMEOUT')
        try:
            connection = socket.create_connection(('127.0.0.1', port), timeout=min(.4, remaining))
        except ConnectionRefusedError:
            return None
        with connection:
            def exact(count):
                data = b''
                while len(data) < count:
                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise ValueError('ADB_ROUTE_TIMEOUT')
                    connection.settimeout(min(.4, remaining))
                    part = connection.recv(count - len(data))
                    if not part:
                        raise ValueError('ADB_ROUTE_RESPONSE_INCOMPLETE')
                    data += part
                return data
            value = service.encode('ascii')
            connection.sendall(('%04x' % len(value)).encode('ascii') + value)
            if exact(4) != b'OKAY':
                raise ValueError('ADB_ROUTE_RESPONSE_INVALID')
            size = int(exact(4), 16)
            if not 0 <= size <= (16 if service == 'host:version' else 65536):
                raise ValueError('ADB_ROUTE_RESPONSE_TOO_LARGE')
            return exact(size).decode('utf8')

    matches = []
    for port in dict.fromkeys([*ports, *([preferred] if preferred else [])]):
        version = request(port, 'host:version')
        if version is None:
            continue
        if not re.fullmatch(r'[0-9a-fA-F]+', version) or int(version, 16) != 41:
            raise ValueError('ADB_ROUTE_PROTOCOL_MISMATCH')
        devices = request(port, 'host:devices')
        if devices is None:
            raise ValueError('ADB_ROUTE_SERVER_DISAPPEARED')
        for line in devices.splitlines():
            parts = line.split('\t')
            if len(parts) != 2:
                raise ValueError('ADB_ROUTE_DEVICES_INVALID')
            if parts[0] == serial:
                matches.append((port, parts[1]))
    if not matches:
        raise ValueError('ADB_ROUTE_TARGET_UNAVAILABLE serial=%s ports=%s' % (serial, list(dict.fromkeys([*ports, *([preferred] if preferred else [])]))))
    if len(matches) != 1:
        raise ValueError('ADB_ROUTE_TARGET_AMBIGUOUS serial=%s matches=%s' % (serial, matches))
    if matches[0][1] != 'device':
        raise ValueError('ADB_ROUTE_TARGET_OFFLINE serial=%s port=%s state=%s' % (serial, *matches[0]))
    if preferred and matches[0][0] != preferred:
        raise ValueError('ADB_ROUTE_CONFIGURED_TARGET_MISMATCH')
    return matches[0][0]


if __name__ == '__main__':
    try:
        if len(sys.argv) != 3:
            raise ValueError('ADB_ROUTE_INPUT_INVALID')
        port = select_route(sys.argv[1], os.environ.get('ADB_SERVER_SOCKET', ''))
        # version只读客户端；协议不符会让adb自身重启server，因此必须先拒绝。
        result = subprocess.run([sys.argv[2], 'version'], capture_output=True, text=True, timeout=2)
        if result.returncode or not re.search(r'^Android Debug Bridge version 1\.0\.41\r?$', result.stdout, re.M):
            raise ValueError('ADB_ROUTE_CLIENT_PROTOCOL_MISMATCH')
        print(port)
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).startswith(('ADB_ROUTE_', 'ADB_HOST_')) else 'ADB_ROUTE_PROBE_FAILED'
        print(code, file=sys.stderr)
        sys.exit(2)
