#!/usr/bin/env python3
"""固定宿主策略的ADB客户端；不拥有任何server生命周期权限。"""
import importlib.util
import base64
import json
import socket
import os
from pathlib import Path
import re
import subprocess
import sys


def policy_path():
    if 'ZJ_ADB_HOST_CONFIG' in os.environ:
        value = os.environ['ZJ_ADB_HOST_CONFIG']
        if not value or not os.path.isabs(value):
            raise ValueError('ADB_MANAGED_CONFIG_REQUIRED')
        return value
    default = Path.home() / '.config/zenithjoy/adb-service.json'
    if not os.path.lexists(default):
        raise ValueError('ADB_MANAGED_CONFIG_REQUIRED')
    return str(default)


def route_module():
    spec = importlib.util.spec_from_file_location('managed_adb_route', Path(__file__).with_name('adb-existing-route.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args(argv, port):
    serial = None
    index = 0
    while index < len(argv) and argv[index].startswith('-'):
        option = argv[index]
        if option not in ('-H', '-P', '-s') or index + 1 >= len(argv):
            raise ValueError('ADB_MANAGED_ARGUMENT_REFUSED')
        value = argv[index + 1]
        if option == '-H' and value != '127.0.0.1':
            raise ValueError('ADB_MANAGED_ENDPOINT_MISMATCH')
        if option == '-P' and value != str(port):
            raise ValueError('ADB_MANAGED_ENDPOINT_MISMATCH')
        if option == '-s':
            if serial is not None or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,200}', value):
                raise ValueError('ADB_MANAGED_SERIAL_INVALID')
            serial = value
        index += 2
    command = argv[index:]
    if not command:
        raise ValueError('ADB_MANAGED_COMMAND_REQUIRED')
    forbidden = {'start-server', 'kill-server', 'server', 'nodaemon', 'fork-server', 'connect',
                 'disconnect', 'reconnect', 'root', 'unroot', 'tcpip', 'usb', 'attach', 'detach',
                 'pair', 'mdns', 'keygen', 'host-features', 'server-status'}
    if command[0] in forbidden or command[0].startswith('-'):
        raise ValueError('ADB_MANAGED_LIFECYCLE_REFUSED')
    if command[0] in ('devices', 'version'):
        if serial is not None or command not in (['devices'], ['devices', '-l'], ['version']):
            raise ValueError('ADB_MANAGED_READ_ARGUMENTS_INVALID')
    elif serial is None:
        raise ValueError('ADB_MANAGED_SERIAL_REQUIRED')
    return serial, command


def parent_leaf(argv):
    path = os.environ.get('WFR_COLLECTION_LEAF_SOCKET')
    nonce = os.environ.get('WFR_COLLECTION_LEAF_NONCE', '')
    if not path or not os.path.isabs(path) or not re.fullmatch(r'[a-f0-9]{48}', nonce):
        raise ValueError('ADB_MANAGED_COLLECTION_PARENT_REQUIRED')
    try:
        with socket.socket(socket.AF_UNIX) as peer:
            peer.settimeout(300)
            peer.connect(path)
            peer.sendall(json.dumps({'nonce': nonce, 'argv': argv}).encode() + b'\n')
            peer.shutdown(socket.SHUT_WR)
            data = bytearray()
            while True:
                chunk = peer.recv(65536)
                if not chunk:
                    break
                data.extend(chunk)
                if len(data) > 12 * 1024 * 1024:
                    raise ValueError('ADB_MANAGED_COLLECTION_OUTPUT_LIMIT')
        result = json.loads(data)
        if result.get('ok') is not True or type(result.get('code')) is not int:
            raise ValueError('ADB_MANAGED_COLLECTION_PARENT_REJECTED')
        return result['code'], base64.b64decode(result['stdout'], validate=True), base64.b64decode(result['stderr'], validate=True)
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as error:
        raise ValueError('ADB_MANAGED_COLLECTION_PARENT_UNAVAILABLE') from error


def client_version(binary):
    if 'WFR_COLLECTION_LEAF_SOCKET' in os.environ:
        code, stdout, _ = parent_leaf(['version'])
        text = stdout.decode('utf8')
        if code or re.findall(r'^Android Debug Bridge version 1\.0\.([0-9]+)\r?$', text, re.M) != ['41']:
            raise ValueError('ADB_MANAGED_CLIENT_PROTOCOL_MISMATCH')
        return text
    result = subprocess.run([binary, 'version'], capture_output=True, text=True, timeout=2)
    matches = re.findall(r'^Android Debug Bridge version 1\.0\.([0-9]+)\r?$', result.stdout, re.M)
    if result.returncode or matches != ['41']:
        raise ValueError('ADB_MANAGED_CLIENT_PROTOCOL_MISMATCH')
    return result.stdout


def main(argv):
    os.environ['ZJ_ADB_HOST_CONFIG'] = policy_path()
    route = route_module()
    policy = route.read_host_policy()
    if not policy:
        raise ValueError('ADB_MANAGED_CONFIG_REQUIRED')
    binary = policy.get('adb_bin')
    if not isinstance(binary, str) or not os.path.isabs(binary) or not os.path.isfile(binary) or not os.access(binary, os.X_OK):
        raise ValueError('ADB_MANAGED_BINARY_INVALID')
    serial, command = parse_args(argv, policy['port'])
    for name, expected in [('ADB_SERVER_SOCKET', policy['endpoint']),
                           ('ANDROID_ADB_SERVER_PORT', str(policy['port'])),
                           ('ANDROID_ADB_SERVER_ADDRESS', '127.0.0.1'),
                           ('DOUYIN_ADB_PORT', str(policy['port']))]:
        if name in os.environ and os.environ[name] != expected:
            raise ValueError('ADB_MANAGED_ENV_ENDPOINT_MISMATCH')
    if command == ['version']:
        print(client_version(binary), end='')
        return 0
    # 检查整个host（包括forbidden端口），不能devices时跳过附加server守卫。
    if command[0] == 'devices':
        host = route.inspect_managed_host(policy=policy)
        print('List of devices attached')
        for device in host['devices']:
            print(device['serial'] + '\t' + device['state'])
        return 0
    route.select_route(serial, policy['endpoint'])
    client_version(binary)
    env = dict(os.environ, ADB_SERVER_SOCKET=policy['endpoint'])
    for name in ('ANDROID_ADB_SERVER_PORT', 'ANDROID_ADB_SERVER_ADDRESS', 'ANDROID_SERIAL',
                 'ADB_VENDOR_KEYS', 'ADB_LIBUSB', 'ADB_LOCAL_TRANSPORT_MAX_PORT'):
        env.pop(name, None)
    # numeric -H is deliberately not localhost: a missing server must not be spawned.
    actual = ['-H', '127.0.0.1', '-P', str(policy['port']), '-s', serial, *command]
    if 'WFR_COLLECTION_LEAF_SOCKET' in os.environ:
        code, stdout, stderr = parent_leaf(actual)
        sys.stdout.buffer.write(stdout)
        sys.stderr.buffer.write(stderr)
        return code
    os.execve(binary, [binary, *actual], env)


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except Exception as error:
        message = str(error)
        safe = message if isinstance(error, ValueError) and message.startswith(('ADB_MANAGED_', 'ADB_HOST_', 'ADB_ROUTE_')) else 'ADB_MANAGED_FAILED'
        print(safe, file=sys.stderr)
        sys.exit(2)
