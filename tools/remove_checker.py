#!/usr/bin/env python3
"""Toglie uno sfondo "a scacchi" dipinto (finta trasparenza) dalle immagini generate.

    python3 tools/remove_checker.py FILE.png [FILE.png ...]    # modifica sul posto

Riempie dai bordi i pixel chiari e poco saturi (grigi e bianchi dello scacchiera) connessi
al bordo, li rende trasparenti, poi binarizza l'alfa del contorno. Se l'immagine ha gia'
una trasparenza vera sui bordi non tocca niente. Stampa, per ogni file, la frazione resa
trasparente.
"""
import sys
from collections import deque

from PIL import Image


def is_bg(p) -> bool:
    r, g, b = p[:3]
    return min(r, g, b) >= 110 and max(r, g, b) - min(r, g, b) <= 14


def process(path: str) -> str:
    img = Image.open(path).convert('RGBA')
    w, h = img.size
    px = img.load()
    border = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)] + \
             [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)]
    transparent_border = sum(1 for x, y in border if px[x, y][3] < 32) / len(border)
    if transparent_border > 0.9:
        return 'gia\' trasparente, invariato'
    bg_border = sum(1 for x, y in border if is_bg(px[x, y])) / len(border)
    if bg_border < 0.8:
        return f'bordo non a scacchi ({bg_border:.0%}), invariato'
    seen = bytearray(w * h)
    q = deque()
    for x, y in border:
        if is_bg(px[x, y]) and not seen[y * w + x]:
            seen[y * w + x] = 1
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not seen[ny * w + nx] and is_bg(px[nx, ny]):
                seen[ny * w + nx] = 1
                q.append((nx, ny))
    cleared = 0
    for i, s in enumerate(seen):
        if s:
            x, y = i % w, i // w
            r, g, b, _ = px[x, y]
            px[x, y] = (r, g, b, 0)
            cleared += 1
    # un pixel di alone grigio attorno al contorno: via anche quello
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if px[x, y][3] and is_bg(px[x, y]) and any(px[x + dx, y + dy][3] == 0 for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    img.save(path)
    return f'scacchi rimossi, {cleared / (w * h):.0%} trasparente'


if __name__ == '__main__':
    for f in sys.argv[1:]:
        print(f, '->', process(f))
