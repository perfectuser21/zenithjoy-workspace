from pathlib import Path
import re
import time


def organize_owned_album(config):
    held(config)
    profile = config['profile']
    if not re.fullmatch(r'pdd[0-9a-f]{32}', profile): raise ValueError('INVALID_ALBUM_OWNER')
    if config.get('albumMoveAttempted'): raise ValueError('ALBUM_MOVE_REQUIRES_READBACK')
    items = config['ownedMedia']
    if not items or any(not x.get('phoneVerified') or not re.fullmatch(r'\d+', x.get('mediaId', '')) for x in items): raise ValueError('VERIFIED_MEDIA_REQUIRED')
    if len({x['mediaId'] for x in items}) != len(items) or len({x['name'] for x in items}) != len(items): raise ValueError('DUPLICATE_MEDIA_IDENTITY')
    if any(x['phonePath'] != '/sdcard/DCIM/Camera/' + x['name'] for x in items): raise ValueError('UNEXPECTED_MEDIA_SOURCE')
    album = 'PDD_' + profile
    path = '/sdcard/DCIM/' + album
    relative = 'DCIM/' + album + '/'
    if adb(config, ['shell', 'test', '-e', path], check=False).returncode != 1: raise ValueError('ALBUM_ALREADY_EXISTS_OR_UNKNOWN')
    rows = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id', '--where', "relative_path='" + relative + "'"]).stdout.decode().strip()
    if rows != 'No result found.': raise ValueError('ALBUM_MEDIA_ALREADY_EXISTS_OR_UNKNOWN')
    for item in items:
        if media_identity(config, item) != item['mediaId'] or adb(config, ['shell', 'sha256sum', item['phonePath']]).stdout.decode().split()[0] != item['sha256']: raise ValueError('OWNED_MEDIA_CHANGED')
    config['albumMoveAttempted'] = True
    config['phoneAlbum'] = {'name': album, 'path': path, 'relativePath': relative, 'owner': config['owner'], 'absenceProvedAt': time.time(), 'verified': False}
    store(Path(config['remoteRoot']) / 'config.json', config)
    for item in items:
        destination = path + '/' + item['name']
        item['moveIntent'] = {'source': item['phonePath'], 'destination': destination, 'mediaId': item['mediaId']}
        store(Path(config['remoteRoot']) / 'config.json', config)
        try:
            reply = adb(config, ['shell', 'content', 'update', '--uri', 'content://media/external/images/media/' + item['mediaId'], '--bind', 'relative_path:s:' + relative])
            item['moveReceipt'] = {'stdoutHex': reply.stdout.hex(), 'returncode': reply.returncode, 'remoteExitConfirmed': getattr(reply, 'remoteExitConfirmed', False)}
            if reply.returncode != 0 or not item['moveReceipt']['remoteExitConfirmed']:
                error = ValueError('MOVE_TERMINATION_PROOF_REQUIRED'); error.remoteUnknown = True
                raise error
        except Exception as error:
            if not getattr(error, 'remoteUnknown', False):
                item['moveCommandFinished'] = True
                store(Path(config['remoteRoot']) / 'config.json', config)
            raise
        item['moveCommandFinished'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
        if reply.stdout.strip() not in {b'', b'Updated 1 rows.'}: raise ValueError('ALBUM_MOVE_RECEIPT_UNCONFIRMED')
        raw = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media/' + item['mediaId'], '--projection', '_id:_data']).stdout.decode()
        expected = '/storage/emulated/0/DCIM/' + album + '/' + item['name']
        matches = re.findall(r'_id=(\d+), _data=([^\r\n]+)', raw)
        if matches != [(item['mediaId'], expected)]: raise ValueError('ALBUM_MOVE_IDENTITY_UNCONFIRMED')
        if adb(config, ['shell', 'sha256sum', destination]).stdout.decode().split()[0] != item['sha256']: raise ValueError('ALBUM_MOVE_HASH_MISMATCH')
        if adb(config, ['shell', 'test', '-e', item['phonePath']], check=False).returncode != 1: raise ValueError('ALBUM_SOURCE_REMAINS_OR_UNKNOWN')
        item['phonePath'] = destination
        item['albumVerified'] = True
        item['moveResolved'] = True
        store(Path(config['remoteRoot']) / 'config.json', config)
    native = adb(config, ['shell', 'content', 'query', '--uri', 'content://media/external/images/media', '--projection', '_id:bucket_id:bucket_display_name:relative_path:_data:_display_name', '--where', "relative_path='" + relative + "'"]).stdout.decode()
    if sorted(re.findall(r'_id=(\d+)', native)) != sorted(x['mediaId'] for x in items): raise ValueError('ALBUM_MEMBERSHIP_CONFLICT')
    files = adb(config, ['shell', 'ls', '-A', '--', path]).stdout.decode().splitlines()
    if sorted(files) != sorted(x['name'] for x in items): raise ValueError('ALBUM_FILES_CONFLICT')
    config['phoneAlbum']['nativeMetadataRaw'] = native
    config['phoneAlbum']['bucketMetadataValidated'] = False
    config['phoneAlbum']['verified'] = True
    store(Path(config['remoteRoot']) / 'config.json', config)
    return {'album': config['phoneAlbum'], 'media': items}
