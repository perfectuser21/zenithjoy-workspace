"""固定runtime命令行边界；依赖与执行实现留在各自模块。"""
import argparse
import json

def main(runtime, argv=None):
    RuntimeFailure = runtime['RuntimeFailure']
    parser = argparse.ArgumentParser(description='固定scrcpy字节验证、启动自检或受控服务端预置')
    parser.add_argument('command', choices=['verify', 'stage-server'])
    parser.add_argument('--runtime-root', required=True)
    parser.add_argument('--runtime-kind', choices=['sdk31', 'sdk33'], default='sdk31')
    parser.add_argument('--client-sha256')
    parser.add_argument('--startup', action='store_true')
    parser.add_argument('--adb-bin')
    parser.add_argument('--adb-port', type=int)
    parser.add_argument('--serial')
    parser.add_argument('--owner')
    parser.add_argument('--lock-dir')
    parser.add_argument('--evidence-root')
    parser.add_argument('--evidence-id')
    parser.add_argument('--timeout', type=float, default=45)
    args = parser.parse_args(argv)
    if args.startup and (args.command != 'verify' or args.runtime_kind != 'sdk33'):
        parser.error('--startup is only approved for sdk33 verify')
    try:
        if args.command == 'verify':
            result = runtime['verify_runtime'](args.runtime_root, args.client_sha256, args.runtime_kind)
            if args.startup:
                try: result.update(runtime['private_runtime']()['startup_check'](args.runtime_root))
                except ValueError as error: raise RuntimeFailure('runtime startup refused: ' + str(error)) from error
        else:
            for field in ('adb_bin', 'adb_port', 'serial', 'owner', 'lock_dir', 'evidence_root', 'evidence_id'):
                if getattr(args, field) is None:
                    parser.error('--' + field.replace('_', '-') + ' is required for staging')
            values = vars(args).copy()
            del values['command']
            del values['startup']
            result = runtime['stage_server'](**values)
    except RuntimeFailure as error:
        result = {'verified': False, 'error': str(error), 'execution_stop_unknown': error.unknown}
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result['verified'] else (75 if result.get('execution_stop_unknown') else 64)

