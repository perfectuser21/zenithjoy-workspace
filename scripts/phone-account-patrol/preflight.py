"""在M4运行；依赖损坏、版本漂移、设备离线都会报红，不操作手机UI。"""
import argparse
import hashlib
import json
import pathlib
import subprocess

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--serial', required=True)
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parent
    checks = {}
    failure = None
    try:
        manifest = json.loads((root / 'deployment.json').read_text())
        checks['source_version'] = all(hashlib.sha256((root / n).read_bytes()).hexdigest() == h for n, h in manifest['sha256'].items())
    except Exception:
        checks['source_version'] = False
    if not checks['source_version']:
        print(json.dumps({'ok': False, 'serial': args.serial, 'checks': checks,
                          'failure': {'stage': 'preflight', 'code': 'source_version_mismatch',
                                      'message': '部署文件版本不一致，未执行设备检查', 'exit_code': None}}, ensure_ascii=False))
        return 1
    # Import only after checking the complete immutable release, including runner.
    from runner import safe_error_text
    checks['ocr'] = (pathlib.Path.home() / '.local/share/phone-account-patrol/ocr').is_file()
    checks['device_lock_controller'] = (pathlib.Path.home() / '.local/bin/douyin-phone-adb').is_file()
    try:
        import PIL
        checks['pillow'] = True
    except ImportError:
        checks['pillow'] = False
    try:
        result = subprocess.run(['/opt/homebrew/bin/adb', '-s', args.serial, 'get-state'], capture_output=True, text=True, timeout=20)
        checks['adb_online'] = result.returncode == 0 and result.stdout.strip() == 'device'
        if not checks['adb_online']:
            failure = {'stage': 'preflight', 'code': 'adb_unreachable', 'message': 'ADB无法连接设备：' + args.serial,
                       'exit_code': result.returncode, 'stdout': safe_error_text(result.stdout), 'stderr': safe_error_text(result.stderr)}
    except Exception as error:
        checks['adb_online'] = False
        failure = {'stage': 'preflight', 'code': 'adb_check_timeout' if isinstance(error, subprocess.TimeoutExpired) else 'adb_check_failed',
                   'message': safe_error_text(str(error)), 'error_type': type(error).__name__, 'exit_code': None,
                   'timeout_sec': error.timeout if isinstance(error, subprocess.TimeoutExpired) else None,
                   'stdout': safe_error_text(getattr(error, 'output', None)), 'stderr': safe_error_text(getattr(error, 'stderr', None))}
    if not all(checks.values()) and failure is None:
        failure = {'stage': 'preflight', 'code': 'prerequisite_failed', 'message': '自检未通过：' + ', '.join(k for k, v in checks.items() if not v), 'exit_code': None}
    print(json.dumps({'ok': all(checks.values()), 'serial': args.serial, 'checks': checks, 'failure': failure}, ensure_ascii=False))
    # 回传证据后由调用方判定失败；自检本身也以非零退出。
    return 0 if all(checks.values()) else 1

if __name__ == '__main__':
    raise SystemExit(main())
