#!/usr/bin/env bash
set -euo pipefail
umask 077

# Keep the schema manifest on fd 3 while Python reads this program on stdin.
exec 3<&0
exec python3 - "$@" <<'PY'
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import signal
import stat
import subprocess
import sys
import tempfile
import time

ROOT = Path(os.environ.get('ZJ_HZ_ROOT', '/var/lib/zenithjoy-cn-production'))
BASE_COMPOSE = ROOT / 'compose.production.candidate.yml'
STATE_FILE = ROOT / 'api-release-state.json'
PROJECT = 'zenithjoy-cn-production'
CONTAINER = PROJECT + '-api'
DB_CONTAINER = PROJECT + '-db'
HEALTH_URLS = (
    'http://127.0.0.1:5200/health',
    'https://zenithjoy.tech/api/health',
    'https://autopilot.zenjoymedia.media/api/health',
)
SHA = re.compile(r'[a-f0-9]{40}')
DIGEST = re.compile(r'[a-f0-9]{64}')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}')
MIGRATION = re.compile(r'[0-9]+_[A-Za-z0-9_.-]+\.sql')
DB_ID = 'zenithjoy|zenithjoy_prod|17'
DB_SQL = """BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SELECT current_database() || '|' || current_user || '|' ||
       (current_setting('server_version_num')::integer / 10000)::text;
SELECT filename FROM zenithjoy.schema_migrations ORDER BY filename COLLATE "C";
COMMIT;"""
CONTAINER_FORMAT = ('{"image":{{json .Image}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
                    '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
                    '"health":{{with .State.Health}}{{json .Status}}{{else}}null{{end}}}')
IMAGE_FORMAT = ('{"id":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},'
                '"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}},'
                '"layers":{{json .RootFS.Layers}}}')


class ReleaseError(Exception):
    pass


class ActivationUncertain(ReleaseError):
    pass


def require(condition, message):
    if not condition:
        raise ReleaseError(message)


def valid(pattern, value):
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def safe_path(path, file_type):
    info = path.lstat()
    require(file_type(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022,
            f'unsafe release path: {path.name}')


def json_bytes(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def hash_bytes(value):
    return hashlib.sha256(value).hexdigest()


def write_json(path, value):
    with tempfile.NamedTemporaryFile(dir=ROOT, prefix='.api-release-', delete=False, mode='wb') as handle:
        temporary = Path(handle.name)
        try:
            handle.write(json_bytes(value) + b'\n')
            handle.flush()
            os.fsync(handle.fileno())
            temporary.replace(path)
            fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        finally:
            temporary.unlink(missing_ok=True)


def execute(arguments, description, timeout=12, allow_failure=False):
    try:
        result = subprocess.run(arguments, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        raise ReleaseError(description) from None
    require(allow_failure or result.returncode == 0, description)
    return result.stdout if result.returncode == 0 else None


def compose(*arguments):
    return ['docker', 'compose', '-p', PROJECT, '-f', str(BASE_COMPOSE), *arguments]


def production_config_hash():
    safe_path(BASE_COMPOSE, stat.S_ISREG)
    config = json.loads(execute(compose('config', '--format', 'json'), 'production Compose invalid'))
    services = config.get('services', {})
    require(set(services) == {'api'}, 'production Compose must contain only the API')
    api = services['api']
    environment = api.get('environment', {})
    require(api.get('container_name') == CONTAINER and valid(IMAGE, api.get('image')) and
            not api.get('build') and not api.get('depends_on'), 'production API Compose identity mismatch')
    require(set(api.get('networks', {})) == {'egress', 'production_db'} and
            config.get('networks', {}).get('egress', {}).get('name') == PROJECT + '-api-egress' and
            config.get('networks', {}).get('production_db', {}).get('name') == PROJECT + '-db-internal' and
            config.get('networks', {}).get('production_db', {}).get('external') is True,
            'production API network identity mismatch')
    ports = api.get('ports', [])
    require(len(ports) == 1 and ports[0].get('host_ip') == '127.0.0.1' and
            str(ports[0].get('published')) == str(ports[0].get('target')) == '5200' and
            ports[0].get('protocol') == 'tcp', 'production API listener identity mismatch')
    require({key: environment.get(key) for key in
             ('DATABASE_HOST', 'DATABASE_PORT', 'DATABASE_NAME', 'DATABASE_USER')} ==
            {'DATABASE_HOST': 'db', 'DATABASE_PORT': '5432', 'DATABASE_NAME': 'zenithjoy',
             'DATABASE_USER': 'zenithjoy_prod'} and not environment.get('DATABASE_URL'),
            'production API database configuration mismatch')
    return hash_bytes(json_bytes(config))


def available_container():
    value = execute(['docker', 'inspect', CONTAINER, '--format', CONTAINER_FORMAT],
                    'production API inspection failed', allow_failure=True)
    if value is None:
        names = execute(['docker', 'ps', '--all', '--filter', 'name=^/' + CONTAINER + '$',
                         '--format', '{{.Names}}'], 'unable to determine production API presence')
        require(not names.strip(), 'production API inspection failed')
        return None
    container = json.loads(value)
    require(container.get('project') == PROJECT and container.get('service') == 'api' and
            valid(IMAGE, container.get('image')), 'production API container identity mismatch')
    return container


def inspect_image(image):
    details = json.loads(execute(['docker', 'image', 'inspect', image, '--format', IMAGE_FORMAT],
                                 'retained Docker image unavailable'))
    require(details.get('id') == image and details.get('os') == 'linux' and
            details.get('architecture') == 'amd64' and valid(SHA, details.get('revision')),
            'API image ID, platform or revision label mismatch')
    return details


def migration_list(text):
    values = text.splitlines()
    require(values and values == sorted(set(values)) and all(valid(MIGRATION, v) for v in values),
            'invalid migration filename inventory')
    return values


def candidate_migrations():
    with os.fdopen(3, encoding='ascii') as stream:
        text = stream.read(64 * 1024 + 1)
    require(len(text) <= 64 * 1024, 'candidate migration inventory too large')
    return migration_list(text)


def live_migrations():
    rows = execute(['docker', 'exec', DB_CONTAINER, 'psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                    '-U', 'zenithjoy_prod', '-d', 'zenithjoy', '-c', DB_SQL],
                   'read-only production database lookup failed')
    identity, _, rows = rows.partition('\n')
    require(identity == DB_ID, 'production database identity mismatch')
    return migration_list(rows)


def verify_candidate_migrations(expected, actual):
    pending = sorted(set(expected) - set(actual))
    unexpected = sorted(set(actual) - set(expected))
    require(not pending and not unexpected,
            'production migration inventory mismatch '
            f'(pending={",".join(pending) or "-"}; extra={",".join(unexpected) or "-"})')


def health_at(url, sha):
    value = execute(['curl', '--disable', '--fail', '--silent', '--connect-timeout', '3',
                     '--max-time', '6', '--header', 'Cache-Control: no-cache',
                     url + '?release_check=' + sha + '&probe=' + secrets.token_hex(8)],
                    'API health read failed', allow_failure=True)
    if value is None:
        return False
    try:
        response = json.loads(value)
        return response.get('status') == 'ok' and (response.get('build') or {}).get('sha') == sha
    except (ValueError, AttributeError):
        return False


def verify_live(release, retry=False):
    attempts = int(os.environ.get('ZJ_HZ_HEALTH_ATTEMPTS', '24')) if retry else 1
    interval = float(os.environ.get('ZJ_HZ_HEALTH_INTERVAL', '5'))
    deadline = time.monotonic() + 150
    for trial in range(attempts):
        observed = available_container()
        if observed and observed['image'] == release['image'] and observed.get('health') == 'healthy':
            if all(health_at(url, release['sha']) for url in HEALTH_URLS):
                return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        if trial + 1 < attempts:
            time.sleep(min(interval, remaining))
    raise ReleaseError(f'local and public API health/build readback failed for {release["sha"]}')


def validate_release(release):
    require(isinstance(release, dict) and set(release) == {'sha', 'image'} and
            valid(SHA, release.get('sha')) and valid(IMAGE, release.get('image')), 'invalid release record')


def read_state():
    if not STATE_FILE.exists() and not STATE_FILE.is_symlink():
        return None
    safe_path(STATE_FILE, stat.S_ISREG)
    state = json.loads(STATE_FILE.read_bytes())
    require(isinstance(state, dict) and set(state) == {'current', 'previous', 'schema', 'config', 'pending'} and
            valid(DIGEST, state.get('schema')) and valid(DIGEST, state.get('config')), 'invalid release ledger')
    validate_release(state['current'])
    if state['previous'] is not None:
        validate_release(state['previous'])
    if state['pending'] is not None:
        pending = state['pending']
        require(isinstance(pending, dict) and set(pending) == {'target'}, 'invalid pending activation journal')
        validate_release(pending['target'])
    return state


def check_running(state):
    active = available_container()
    require(active is not None, 'production API missing without a pending journal')
    image = active['image']
    info = inspect_image(image)
    current = {'sha': info['revision'], 'image': image}
    require(state is None or current == state['current'], 'running production differs from release ledger')
    return current


def retain(release):
    details = inspect_image(release['image'])
    require(details['revision'] == release['sha'], 'retained image does not match release revision')
    execute(['docker', 'tag', release['image'], 'zenithjoy-api-hz:retained-' + release['sha']],
            'unable to retain release image')


def replace_api(release):
    image = release['image']
    override = ROOT / ('api-release-image-' + release['sha'] + '.json')
    write_json(override, {'services': {'api': {'image': image}}})
    arguments = compose('-f', str(override), 'up', '-d', '--no-build', '--pull', 'never', '--no-deps', 'api')
    try:
        # The Compose client holds the same lock if the publisher is killed.
        # A lost response keeps the journal pending until the writer exits.
        writer = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                  stderr=subprocess.DEVNULL, start_new_session=True, pass_fds=(lock_fd,))
    except OSError:
        raise ReleaseError('unable to start the production Compose replacement') from None
    try:
        code = writer.wait(timeout=90)
    except (subprocess.TimeoutExpired, ReleaseError, KeyboardInterrupt):
        raise ActivationUncertain('Compose result unknown; pending activation preserved') from None
    require(code == 0, 'production API Compose replacement failed')


def ensure_config(expected):
    require(production_config_hash() == expected, 'production Compose configuration changed during activation')


def verify_saved_schema(state, schema):
    require(state['schema'] == schema, 'production schema drifted since the verified release')


def recover(state, config):
    pending = state['pending']
    ensure_config(config)
    require(config == state['config'], 'production Compose configuration differs from pending activation')
    verify_saved_schema(state, hash_bytes(json_bytes(live_migrations())))
    current = state['current']
    active = available_container()
    require(active is None or active['image'] in (current['image'], pending['target']['image']),
            'unrecognized running image during pending activation')
    retain(current)
    try:
        verify_live(current)
    except ReleaseError:
        replace_api(current)
        verify_live(current, retry=True)
    write_json(STATE_FILE, {**state, 'pending': None})


def activate(state, target, config):
    ensure_config(config)
    retain(state['current'])
    retain(target)
    pending = {**state, 'pending': {'target': target}}
    write_json(STATE_FILE, pending)
    try:
        replace_api(target)
        verify_live(target, retry=True)
    except ActivationUncertain:
        raise
    except (ReleaseError, KeyboardInterrupt) as error:
        try:
            recover(pending, config)
        except (ReleaseError, KeyboardInterrupt) as recovery_error:
            raise ReleaseError(f'activation failed; pending recovery remains ({recovery_error})') from None
        raise ReleaseError(f'activation failed; previous API restored ({error})') from None
    result = {**state, 'current': target, 'previous': state['current'], 'pending': None}
    write_json(STATE_FILE, result)
    return result


def print_status(state):
    print('HZ_RELEASE_CURRENT=' + state['current']['sha'])
    print('HZ_RELEASE_PREVIOUS=' + (state['previous']['sha'] if state['previous'] else ''))
    print('HZ_RELEASE_IMAGE=' + state['current']['image'])


def release(action, arguments):
    if action == 'check':
        require(len(arguments) <= 1 and (not arguments or valid(SHA, arguments[0])), 'usage: check [SHA]')
    elif action == 'promote':
        require(len(arguments) == 4 and all(valid(pattern, value) for pattern, value in
                zip((SHA, IMAGE, DIGEST, SHA), arguments)),
                'usage: promote SHA IMAGE_ID LAYERS_HASH EXPECTED_CURRENT_SHA')
    else:
        require(action == 'rollback' and len(arguments) == 1 and valid(SHA, arguments[0]),
                'usage: rollback SHA')

    state = read_state()
    if state and state['pending']:
        require(action == 'rollback' and arguments[0] == state['current']['sha'],
                'pending activation; roll back explicitly to ' + state['current']['sha'])
    config = production_config_hash()
    actual = live_migrations()
    schema = hash_bytes(json_bytes(actual))
    if state is not None:
        verify_saved_schema(state, schema)
        require(config == state['config'], 'production Compose configuration differs from verified release')

    if state and state['pending']:
        recover(state, config)
        print_status(state)
        return

    if action == 'promote' or (action == 'check' and arguments):
        verify_candidate_migrations(candidate_migrations(), actual)
    current = check_running(state)
    state = state or {'current': current, 'previous': None, 'schema': schema, 'config': config, 'pending': None}

    if action == 'check':
        verify_live(current)
        print_status(state)
        return
    if action == 'rollback':
        if arguments[0] == current['sha']:
            verify_live(current)
            print_status(state)
            return
        target = state['previous']
        require(target and target['sha'] == arguments[0], 'rollback requires the exact verified predecessor')
    else:
        sha, image, layers_hash, expected_current = arguments
        details = inspect_image(image)
        layers = details.get('layers')
        require(isinstance(layers, list) and len(layers) > 0 and all(valid(IMAGE, v) for v in layers) and
                hash_bytes(json_bytes(layers)) == layers_hash, 'candidate image layers hash mismatch')
        require(details['revision'] == sha, 'candidate image revision mismatch')
        target = {'sha': sha, 'image': image}
        if sha == current['sha']:
            require(target == current, 'image content differs for current SHA')
            verify_live(current)
            print_status(state)
            return
        require(current['sha'] == expected_current, 'current release changed after admission')
        verify_live(current)

    print_status(activate(state, target, config))


def interrupted(signum, frame):
    raise ReleaseError('release interrupted')


try:
    require(len(sys.argv) >= 2, 'usage: check [SHA] | promote SHA IMAGE_ID LAYERS_HASH EXPECTED_CURRENT_SHA | rollback SHA')
    safe_path(ROOT, stat.S_ISDIR)
    lock_path = ROOT / 'migration.lock'
    lock_fd = os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(lock_fd, 'rb') as lock:
        info = os.fstat(lock.fileno())
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022,
                'unsafe production migration lock')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReleaseError('production release/migration lock is held') from None
        signal.signal(signal.SIGTERM, interrupted)
        release(sys.argv[1], sys.argv[2:])
except ReleaseError as error:
    print(f'Hangzhou API release refused: {error}', file=sys.stderr)
    sys.exit(1)
except (OSError, ValueError, AttributeError, KeyError, TypeError, KeyboardInterrupt):
    # Do not expose Compose environment, HTTP response bodies or process stderr.
    print('Hangzhou API release refused: unable to read or persist verified release state', file=sys.stderr)
    sys.exit(1)
PY
