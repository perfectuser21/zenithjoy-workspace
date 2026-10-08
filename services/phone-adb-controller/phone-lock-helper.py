#!/usr/bin/env python3
"""手机锁互斥及只读在跑任务检查；未知情况不允许回收。"""
import fcntl
import csv
import json
import os
import signal
import time
import subprocess
import sys


def guarded():
    guard_path, serial, command, script, profile, *args = sys.argv[2:]
    os.makedirs(os.path.dirname(guard_path), exist_ok=True)
    fd = os.open(guard_path, os.O_CREAT | os.O_RDWR, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print('lock is held by another run: lock operation busy; preserving device', file=sys.stderr)
        sys.exit(2)
    os.set_inheritable(fd, True)
    os.environ['DOUYIN_LOCK_GUARDED'] = serial + ':' + command
    os.environ['DOUYIN_LOCK_GUARD_FD'] = str(fd)
    os.execv('/bin/zsh', ['zsh', script, '--profile', profile, command, *args])


def verify_guard():
    # 实际继承FD须对应本设备guard；取得同一open-description锁，父进程持续持有。
    try:
        fd = int(os.environ.get('DOUYIN_LOCK_GUARD_FD', ''))
        if fd < 3:
            raise ValueError('invalid fd')
        actual, expected = os.fstat(fd), os.stat(sys.argv[2])
        if (actual.st_dev, actual.st_ino) != (expected.st_dev, expected.st_ino):
            raise ValueError('guard file mismatch')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (ValueError, OSError):
        print('guard descriptor ownership is not verifiable', file=sys.stderr)
        sys.exit(2)


def stop_child():
    pid, parent = map(int, sys.argv[2:4])
    if pid <= 1 or parent <= 1:
        raise ValueError('invalid child identity')

    def send_group(sig):
        try:
            os.killpg(pid, sig)
        except ProcessLookupError:
            pass

    def send_child(sig):
        # 建组之前仍按直接孩子终止；已结束且PID易主时不能杀后来者。
        result = subprocess.run(['/bin/ps', '-o', 'ppid=', '-p', str(pid)],
                                capture_output=True, text=True, timeout=1)
        if result.returncode == 0 and result.stdout.strip() == str(parent):
            try:
                os.kill(pid, sig)
            except ProcessLookupError:
                pass

    send_group(signal.SIGTERM)
    send_child(signal.SIGTERM)
    time.sleep(0.2)
    # 业务命令可能屏蔽TERM；有界升级后再wait，不能清场时孩子还在操作UI。
    send_group(signal.SIGKILL)
    send_child(signal.SIGKILL)


def task_list():
    # 当前 Brain /tasks 忽略 offset：逐次扩大 limit；满页继续，超界拒绝回收。
    for limit in (200, 400, 800, 1600, 3200, 6400, 12800):
        query = 'http://localhost:5221/api/brain/tasks?status=in_progress&limit=' + str(limit)
        response = subprocess.run(
            [os.environ.get('DOUYIN_LOCK_SSH_BIN', '/usr/bin/ssh'),
             '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', 'mmv',
             "curl -fsS --connect-timeout 3 -m 8 '" + query + "'"],
            check=True, capture_output=True, text=True, timeout=15)
        tasks = json.loads(response.stdout)
        if not isinstance(tasks, list):
            raise ValueError('Brain response is not a task list')
        ids = []
        for task in tasks:
            if not isinstance(task, dict) or not isinstance(task.get('id'), str) or task.get('status') != 'in_progress' or not isinstance(task.get('task_type'), str):
                raise ValueError('invalid task row')
            ids.append(task['id'])
        if len(set(ids)) != len(ids):
            raise ValueError('duplicate task ids')
        if len(tasks) < limit:
            return tasks
    raise ValueError('task list remains truncated')


def device_values(value):
    serials, profiles = set(), set()
    if isinstance(value, dict):
        for key, item in value.items():
            if isinstance(item, str):
                if key in ('serial', 'phone_serial', 'device_serial', 'phoneSerial', 'deviceSerial'):
                    serials.add(item.lower())
                if key in ('profile', 'phone_profile', 'device_profile', 'phoneProfile'):
                    profiles.add(item.lower())
            nested_serials, nested_profiles = device_values(item)
            serials.update(nested_serials)
            profiles.update(nested_profiles)
    elif isinstance(value, list):
        for item in value:
            nested_serials, nested_profiles = device_values(item)
            serials.update(nested_serials)
            profiles.update(nested_profiles)
    return serials, profiles


def safe_to_reap():
    owner, serial, profile = sys.argv[2:]
    try:
        tasks = task_list()
        for task in tasks:
            raw = json.dumps(task, ensure_ascii=False).lower()
            serials, profiles = device_values(task.get('payload'))
            task_id = task['id'].lower()
            if (owner.lower() in raw or (len(task_id) >= 8 and task_id in owner.lower())
                    or serial.lower() in raw or profile.lower() in profiles):
                print('active-task')
                return 1
            if task.get('task_type') in ('qiumi_task', 'workflow_run', 'device_job') and not serials:
                # 外部手机任务字段分散；未命中本机不能据此证明属于另一手机。
                print('device-uncertain')
                return 1
        # 旧执行链未必有 Brain task；宿主上有活采收/触达进程时一律保留。
        live = subprocess.run([os.environ.get('DOUYIN_LOCK_PGREP_BIN', '/usr/bin/pgrep'), '-f', '[w]f-run.sh|[h]arvest-keyword.sh|[b]atch2.sh|[o]utreach-tick.sh|[d]iscover-keyword.sh'],
                              capture_output=True, timeout=3)
        if live.returncode != 1:
            print('local-process-or-unknown')
            return 1
        print('idle')
        return 0
    except (ValueError, OSError, subprocess.SubprocessError):
        print('brain-unavailable-or-incomplete')
        return 1


if __name__ == '__main__':
    if sys.argv[1] == 'guard':
        guarded()
    elif sys.argv[1] == 'guard-check':
        verify_guard()
    elif sys.argv[1] == 'stop':
        stop_child()
    elif sys.argv[1] == 'run':
        os.setsid()
        os.execvp(sys.argv[2], sys.argv[2:])
    elif sys.argv[1] == 'profiles':
        serials = set(sys.argv[2:])
        path = os.environ.get('DOUYIN_PHONE_REGISTRY', os.path.expanduser('~/.config/openclaw/douyin-phone-profiles.tsv'))
        with open(path, newline='') as handle:
            columns = None
            for row in csv.reader(handle, delimiter='\t', quoting=csv.QUOTE_NONE):
                if not row:
                    continue
                if row[0] in ('profile', '#profile'):
                    columns = {name.lstrip('#'): i for i, name in enumerate(row)}
                    continue
                if row[0].startswith('#'):
                    continue
                pi, si = (columns.get('profile', -1), columns.get('serial', -1)) if columns else (0, 1)
                if min(pi, si) < 0 or max(pi, si) >= len(row):
                    continue
                if row[si] in serials:
                    print(row[pi] + '\t' + row[si])
    elif sys.argv[1] == 'safe-to-reap':
        sys.exit(safe_to_reap())
    else:
        sys.exit(2)
