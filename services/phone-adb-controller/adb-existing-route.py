#!/usr/bin/env python3
"""只读既有本机ADB smart-socket，按精确serial唯一选路；不启动/重连server。"""
import os
import re
import socket
import subprocess
import sys
import time

PORTS = (5037, 5041, 5042)


def select_route(serial, configured='', *, ports=PORTS, budget=2.0):
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
        code = str(error) if isinstance(error, ValueError) and str(error).startswith('ADB_ROUTE_') else 'ADB_ROUTE_PROBE_FAILED'
        print(code, file=sys.stderr)
        sys.exit(2)
