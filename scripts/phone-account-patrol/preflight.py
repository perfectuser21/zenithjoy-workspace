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
    try:
        manifest = json.loads((root / 'deployment.json').read_text())
        checks['source_version'] = all(hashlib.sha256((root / n).read_bytes()).hexdigest() == h for n, h in manifest['sha256'].items() if n != 'runner.py')
    except Exception:
        checks['source_version'] = False
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
    except Exception:
        checks['adb_online'] = False
    print(json.dumps({'ok': all(checks.values()), 'serial': args.serial, 'checks': checks}))
    # 回传证据后由调用方判定失败；自检本身也以非零退出。
    return 0 if all(checks.values()) else 1

if __name__ == '__main__':
    raise SystemExit(main())
