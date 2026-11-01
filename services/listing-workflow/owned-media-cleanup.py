from pathlib import Path
import re


def owned_locations(config, item):
    source = '/sdcard/DCIM/Camera/' + item['name']
    paths = [source]
    intent = item.get('moveIntent')
    if intent:
        album = config.get('phoneAlbum', {})
        expected = '/sdcard/DCIM/PDD_' + config['profile'] + '/' + item['name']
        if album.get('owner') != config['owner'] or intent != {'source': source, 'destination': expected, 'mediaId': item['mediaId']}: raise ValueError('MOVE_IDENTITY_CONFLICT')
        paths.append(expected)
    return paths


def observe_owned_location(config, item):
    paths = owned_locations(config, item)
    present = []
    for path in paths:
        result = adb(config, ['shell', 'test', '-e', path], check=False).returncode
        if result not in {0, 1}: raise ValueError('FILE_PRESENCE_UNKNOWN')
        if result == 0: present.append(path)
    raw = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media/' + item['mediaId'], '--projection', '_id:_data']).stdout.decode().strip()
    if raw == 'No result found.' and not present and item.get('deleteIntent') == {'mediaId': item['mediaId'], 'owner': config['owner'], 'paths': paths}:
        return None
    matches = re.findall(r'_id=(\d+), _data=([^\r\n]+)', raw)
    if len(matches) != 1 or matches[0][0] != item['mediaId']: raise ValueError('MEDIA_IDENTITY_UNKNOWN')
    path = matches[0][1].replace('/storage/emulated/0/', '/sdcard/', 1)
    if path not in paths: raise ValueError('MEDIA_LOCATION_CONFLICT')
    if present != [path]: raise ValueError('EXTRA_OR_FOREIGN_PATH_PRESENT')
    if adb(config, ['shell', 'sha256sum', path]).stdout.decode().split()[0] != item['sha256']: raise ValueError('OWNED_MEDIA_HASH_CHANGED')
    return path


def cleanup_owned_media(config):
    held(config)
    items = [x for x in config['ownedMedia'] if x.get('phonePlanned')]
    if any(not x.get('phoneVerified') or not x.get('absenceProvedAt') or not re.fullmatch(r'\d+', x.get('mediaId', '')) for x in items): raise ValueError('VERIFIED_MEDIA_REQUIRED')
    # An ID/path snapshot cannot prove an Android operation has terminated.
    # Unknown replies retain every artifact and both locks until separate recovery.
    if any(x.get('moveIntent') and not x.get('moveCommandFinished') for x in items): raise ValueError('MOVE_TERMINATION_PROOF_REQUIRED')
    observations = [(item, observe_owned_location(config, item)) for item in items]
    for item, path in observations:
        if path is not None:
            item['phonePath'] = path
            item['deleteIntent'] = {'mediaId': item['mediaId'], 'owner': config['owner'], 'paths': owned_locations(config, item)}
            store(Path(config['remoteRoot']) / 'config.json', config)
            adb(config, ['shell', 'content', 'delete', '--uri', 'content://media/external/images/media/' + item['mediaId']])
            if observe_owned_location(config, item) is not None: raise ValueError('PHONE_MEDIA_DELETE_UNCONFIRMED')
        item['phoneRemoved'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
    album = config.get('phoneAlbum')
    if album:
        if album.get('owner') != config['owner'] or album['path'] != '/sdcard/DCIM/PDD_' + config['profile']: raise ValueError('ALBUM_OWNER_CONFLICT')
        exists = adb(config, ['shell', 'test', '-e', album['path']], check=False).returncode
        if exists == 0:
            if adb(config, ['shell', 'ls', '-A', '--', album['path']]).stdout.decode().strip(): raise ValueError('ALBUM_NOT_EMPTY')
            adb(config, ['shell', 'rmdir', '--', album['path']])
        elif exists != 1: raise ValueError('ALBUM_PRESENCE_UNKNOWN')
        if adb(config, ['shell', 'test', '-e', album['path']], check=False).returncode != 1: raise ValueError('ALBUM_DELETE_UNCONFIRMED')
        album['cleanupComplete'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
    return {'ok': True, 'removedMediaIds': [x['mediaId'] for x in items], 'phoneArtifactsRemaining': []}
