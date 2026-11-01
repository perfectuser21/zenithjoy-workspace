#!/usr/bin/env python3
"""安全安装的自动入口与 ADB 字节守卫；不执行任何现场动作。"""

from pathlib import Path
import re


def select_cron(raw, review_serials, *, outreach_retired):
    if not isinstance(raw, str) or not raw.endswith('\n') or not review_serials:
        raise ValueError('review cron input invalid')
    if not all(re.fullmatch(r'[A-Za-z0-9_-]{1,80}', s) for s in review_serials):
        raise ValueError('review serial invalid')
    kept, removed = [], []
    for line in raw.splitlines(keepends=True):
        body = line.rstrip('\n')
        if not body or body.lstrip().startswith('#'):
            kept.append(line)
            continue
        if 'outreach-tick.sh' in body:
            if not outreach_retired:
                raise ValueError('outreach auto entry lacks retired guard')
            kept.append(line)
            continue
        if 'harvest-cron.sh' in body:
            match = re.search(r'/bin/zsh /Users/[^/]+/bin-harvest/harvest-cron[.]sh [A-Za-z0-9_.-]+ ([A-Za-z0-9_-]+) ', body)
            if not match or match.group(1) not in review_serials:
                raise ValueError('unknown harvest auto entry')
            removed.append(body)
            continue
        if re.search(r'(phone-candidates|phone-candidate-runs|leadgen-run[.]sh|wf-run[.]sh|douyin-phone-adb)', body):
            raise ValueError('unknown phone auto entry')
        kept.append(line)
    if not removed:
        raise ValueError('review harvest schedules not found')
    return ''.join(kept), removed


def verify_automatic_quiescence(cron_raw, review_serials, *, recovery_disabled, recovery_loaded, process_table):
    if not recovery_disabled or recovery_loaded:
        raise ValueError('recovery daemon remains active')
    for line in cron_raw.splitlines():
        if 'harvest-cron.sh' in line and any(s in line for s in review_serials):
            raise ValueError('review harvest schedule remains active')
    for line in process_table.splitlines():
        if re.search(r'(phone-candidates|phone-candidate-runs|leadgen-run[.]sh|harvest-cron[.]sh|douyin-phone-adb)', line):
            raise ValueError('candidate or leadgen process remains active')
    return True


def verify_adb_relocation(original, stable, script_path, candidate_root):
    required = {'adb-host-service.py', 'adb-existing-route.py'}
    if not isinstance(original, dict) or not isinstance(stable, dict) or not required <= original.keys() or not required <= stable.keys():
        raise ValueError('ADB source files missing')
    if any(not isinstance(original[k], bytes) or stable[k] != original[k] for k in required):
        raise ValueError('ADB stable source bytes differ')
    script = Path(script_path)
    if not script.is_absolute() or script.name != 'adb-host-service.py' or script == Path(candidate_root) or Path(candidate_root) in script.parents:
        raise ValueError('ADB stable source path invalid')
    if '/.config/zenithjoy/adb-host-stable/' not in str(script):
        raise ValueError('ADB stable source root invalid')
    return True
