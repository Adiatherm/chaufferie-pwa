#!/usr/bin/env python3
"""Generate simple icons for the PWA"""

def create_simple_svg(size):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 {size} {size}">
  <rect width="{size}" height="{size}" fill="#0f1923" rx="{size//8}"/>
  <text x="50%" y="54%" font-size="{int(size*0.55)}" text-anchor="middle" dominant-baseline="middle">🔥</text>
  <text x="50%" y="82%" font-size="{int(size*0.12)}" text-anchor="middle" fill="#f97316" font-family="Arial" font-weight="bold" letter-spacing="{size//60}">LOG</text>
</svg>'''

# Write SVGs as placeholder icons (browsers accept SVG in manifests too)
for size in [192, 512]:
    with open(f'icons/icon-{size}.svg', 'w') as f:
        f.write(create_simple_svg(size))
    print(f"Created icons/icon-{size}.svg")

# Create minimal 1x1 PNG fallback (actual icon will be SVG)
import struct, zlib

def create_minimal_png(size, color=(15, 25, 35)):
    def make_png(w, h, pixels):
        def pack_chunk(chunk_type, data):
            chunk_len = len(data)
            chunk_data = chunk_type + data
            crc = zlib.crc32(chunk_data) & 0xffffffff
            return struct.pack('>I', chunk_len) + chunk_data + struct.pack('>I', crc)
        
        sig = b'\x89PNG\r\n\x1a\n'
        ihdr_data = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
        ihdr = pack_chunk(b'IHDR', ihdr_data)
        
        raw = b''
        for row in pixels:
            raw += b'\x00' + bytes([c for px in row for c in px])
        compressed = zlib.compress(raw)
        idat = pack_chunk(b'IDAT', compressed)
        iend = pack_chunk(b'IEND', b'')
        return sig + ihdr + idat + iend
    
    # Simple colored square
    pixels = [[color for _ in range(w)] for _ in range(w := size)]
    return make_png(size, size, pixels)

for size in [192, 512]:
    with open(f'icons/icon-{size}.png', 'wb') as f:
        f.write(create_minimal_png(size, (15, 25, 35)))
    print(f"Created icons/icon-{size}.png")

print("Icons generated!")
