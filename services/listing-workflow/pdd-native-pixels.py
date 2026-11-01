import hashlib
import struct
import zlib


def png_rgba(raw, expected_size=None):
    if raw[:8] != b'\x89PNG\r\n\x1a\n' or len(raw) > 24 * 1024 * 1024:
        raise ValueError('UNSAFE_PNG')
    offset, compressed, header, ended = 8, bytearray(), None, False
    while offset < len(raw):
        if offset + 12 > len(raw): raise ValueError('TRUNCATED_PNG')
        length = int.from_bytes(raw[offset:offset + 4], 'big')
        kind, data = raw[offset + 4:offset + 8], raw[offset + 8:offset + 8 + length]
        end = offset + 12 + length
        if end > len(raw) or zlib.crc32(kind + data) != int.from_bytes(raw[end - 4:end], 'big'): raise ValueError('PNG_CRC_MISMATCH')
        if kind == b'IHDR':
            if header is not None or offset != 8 or length != 13: raise ValueError('UNSAFE_PNG_HEADER')
            header = struct.unpack('>IIBBBBB', data)
        elif kind == b'IDAT': compressed.extend(data)
        elif kind == b'IEND':
            if length or end != len(raw): raise ValueError('UNSAFE_PNG_END')
            ended = True
            break
        offset = end
    if not ended or not header or header[2:] != (8, 6, 0, 0, 0): raise ValueError('UNSUPPORTED_PNG_FORMAT')
    width, height = header[:2]
    if expected_size is not None and (width, height) != tuple(expected_size): raise ValueError('PNG_DIMENSION_MISMATCH')
    if not 0 < width <= 4096 or not 0 < height <= 8192: raise ValueError('UNSAFE_PNG_BOUNDS')
    stride = width * 4
    expected = (stride + 1) * height
    decoder = zlib.decompressobj()
    pixels = decoder.decompress(bytes(compressed), expected + 1)
    if len(pixels) != expected or not decoder.eof or decoder.unused_data: raise ValueError('UNSAFE_PNG_STREAM')
    prior, output = bytearray(stride), bytearray()
    for y in range(height):
        row_start = y * (stride + 1)
        mode = pixels[row_start]
        row = bytearray(pixels[row_start + 1:row_start + 1 + stride])
        if mode not in {0, 1, 2, 3, 4}: raise ValueError('UNSAFE_PNG_FILTER')
        if mode:
            for i in range(stride):
                left, up, corner = (row[i - 4] if i >= 4 else 0), prior[i], (prior[i - 4] if i >= 4 else 0)
                if mode == 1: value = left
                elif mode == 2: value = up
                elif mode == 3: value = (left + up) // 2
                else:
                    p = left + up - corner
                    a, b, c = abs(p - left), abs(p - up), abs(p - corner)
                    value = left if a <= b and a <= c else up if b <= c else corner
                row[i] = (row[i] + value) & 255
        prior = row
        output.extend(row)
    return width, height, bytes(output)


def crop_sha_from_rgba(decoded, bounds, masks=()):
    if type(decoded) is not tuple or len(decoded) != 3: raise ValueError('UNSAFE_RGBA_FRAME')
    width, height, pixels = decoded
    if type(width) is not int or type(height) is not int or not 0 < width <= 4096 or not 0 < height <= 8192 or type(pixels) is not bytes or len(pixels) != width * height * 4: raise ValueError('UNSAFE_RGBA_FRAME')
    if len(bounds) != 4 or any(type(x) is not int for x in bounds): raise ValueError('UNSAFE_PNG_BOUNDS')
    x1, y1, x2, y2 = bounds
    if not 0 <= x1 < x2 <= width or not 0 <= y1 < y2 <= height: raise ValueError('UNSAFE_PNG_CROP')
    for box in masks:
        if len(box) != 4 or any(type(x) is not int for x in box) or not 0 <= box[0] < box[2] <= width or not 0 <= box[1] < box[3] <= height: raise ValueError('UNSAFE_PNG_MASK')
    stride, digest = width * 4, hashlib.sha256()
    for y in range(y1, y2):
        row = bytearray(pixels[y * stride:(y + 1) * stride])
        for mx1, my1, mx2, my2 in masks:
            if my1 <= y < my2: row[mx1 * 4:mx2 * 4] = bytes((mx2 - mx1) * 4)
        digest.update(row[x1 * 4:x2 * 4])
    return digest.hexdigest()


def png_crop_sha(raw, bounds, masks=(), expected_size=None):
    return crop_sha_from_rgba(png_rgba(raw, expected_size), bounds, masks)
