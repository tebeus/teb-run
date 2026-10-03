#!/usr/bin/env python3
"""Porta un'immagine generata alla misura esatta richiesta e stampa metriche di controllo.

    python3 tools/set_postprocess.py SRC.png DST.png W H [--opaque] [--tile-x] [--tile-xy] [--clouds]

Passi: sfondo uniforme (bianco o verde) reso trasparente se serve; ritaglio centrale al
rapporto W:H; ridimensionamento LANCZOS a W x H (mai stirato); alfa binaria sui bordi
(sotto 32 -> 0, sopra 224 -> 255) per gli sprite; alfa piena per le immagini opache.
Stampa un JSON con: size, seam_x (differenza media bordo sinistro/destro, 0 = perfetto),
seam_y, top_alpha e bottom_alpha (per le nuvole devono essere 0), transparent_ratio.
"""
import json
import sys

from PIL import Image, ImageDraw


def flood_uniform_background(img: Image.Image, tol: int = 28) -> Image.Image:
    """Se non c'e' trasparenza e gli angoli sono uniformi (bianco o verde), svuota lo sfondo."""
    if img.getextrema()[3][0] < 255:
        return img
    w, h = img.size
    corners = [img.getpixel((0, 0)), img.getpixel((w - 1, 0)), img.getpixel((0, h - 1)), img.getpixel((w - 1, h - 1))]
    ref = corners[0][:3]
    if not all(max(abs(c[i] - ref[i]) for i in range(3)) <= tol for c in corners):
        return img
    is_white = min(ref) > 225
    is_green = ref[1] > 180 and ref[0] < 110 and ref[2] < 110
    if not (is_white or is_green):
        return img
    out = img.copy()
    # flood fill dai quattro angoli su una copia RGB, poi usa il risultato come maschera
    rgb = out.convert('RGB')
    marker = (255, 0, 255) if not (ref[0] > 200 and ref[2] > 200) else (0, 255, 255)
    for x, y in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
        ImageDraw.floodfill(rgb, (x, y), marker, thresh=tol)
    px = rgb.load()
    alpha = out.split()[3].load()
    for y in range(h):
        for x in range(w):
            if px[x, y] == marker:
                alpha[x, y] = 0
    out.putalpha(out.split()[3])
    return out


def center_crop(img: Image.Image, w: int, h: int) -> Image.Image:
    W, H = img.size
    target_h = round(W * h / w)
    if target_h <= H:
        top = (H - target_h) // 2
        return img.crop((0, top, W, top + target_h))
    target_w = round(H * w / h)
    left = (W - target_w) // 2
    return img.crop((left, 0, left + target_w, H))


def fit_sprite(img: Image.Image, w: int, h: int) -> Image.Image:
    """Sprite singolo: inquadra l'oggetto intero (riquadro dei pixel visibili), lo scala
    per stare dentro W x H senza deformarlo e lo appoggia in basso al centro. Mai tagliato."""
    bbox = img.split()[3].point(lambda v: 255 if v > 32 else 0).getbbox()
    if bbox:
        img = img.crop(bbox)
    scale = min(w / img.width, h / img.height)
    nw, nh = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    out.paste(img, ((w - nw) // 2, h - nh))
    return out


def make_seamless(img: Image.Image, search: int = 220, band: int = 12) -> Image.Image:
    """Rende ripetibile in orizzontale una striscia: cerca la coppia di colonne, una vicino al
    bordo sinistro e una vicino al destro, che si somigliano di piu' (confronto in alfa
    premoltiplicata, sulla fascia dove c'e' disegno), taglia li' e sfuma solo pochi pixel.
    Niente specchiatura, niente immagini fantasma."""
    w, h = img.size
    if w <= search * 3:
        return img
    pm = img.convert('RGBa')
    px = pm.load()
    step = max(1, h // 160)
    rows = range(0, h, step)

    def col(x):
        return [px[x, y] for y in rows]

    lefts = {x: col(x) for x in range(0, search, 2)}
    best = None
    for xr in range(w - search, w - band, 2):
        cr = col(xr)
        for xl, cl in lefts.items():
            d = sum(abs(a[i] - b[i]) for a, b in zip(cl, cr) for i in range(4))
            if best is None or d < best[0]:
                best = (d, xl, xr)
    _, xl, xr = best
    out = pm.crop((xl, 0, xr, h))
    ow = out.width
    head = out.crop((0, 0, band, h))
    tail = pm.crop((xr, 0, xr + band, h))  # cio' che seguirebbe il bordo destro
    for x in range(band):
        tcol = x / (band - 1)
        colx = Image.blend(tail.crop((x, 0, x + 1, h)), head.crop((x, 0, x + 1, h)), tcol)
        out.paste(colx, (x, 0))
    return out.convert('RGBA')


def fade_top(img: Image.Image, px: int = 40) -> Image.Image:
    a = img.split()[3].load()
    w, h = img.size
    for y in range(min(px, h)):
        k = y / px
        for x in range(w):
            a[x, y] = int(a[x, y] * k)
    img.putalpha(img.split()[3])
    return img


def fit_strip(img: Image.Image, w: int, h: int, margin_top: bool) -> Image.Image:
    """Strisce ripetibili molto larghe: tiene l'intera fascia verticale del contenuto,
    affianca copie dell'immagine (che si ripete senza cucitura) finche' il rapporto basta,
    poi scala senza deformare e centra in verticale su fondo trasparente.
    Non taglia mai il contenuto in alto o in basso."""
    mask = img.split()[3].point(lambda v: 255 if v > 96 else 0)
    if margin_top:
        # nuvole: taglia in due colonne vuote, cosi' gli estremi sono cielo e la
        # ripetizione non ha cuciture anche se il generatore non ha fatto combaciare i bordi
        cols = [mask.crop((x, 0, x + 1, mask.height)).getbbox() is None for x in range(mask.width)]
        if not (cols[0] and cols[-1]) and any(cols):
            left = next(x for x in range(mask.width) if cols[x])
            right = next(x for x in range(mask.width - 1, -1, -1) if cols[x])
            if right - left > mask.width * 0.5:
                img = img.crop((left, 0, right + 1, img.height))
                mask = mask.crop((left, 0, right + 1, mask.height))
    bbox = mask.getbbox()
    if bbox:
        img = img.crop((0, bbox[1], img.width, bbox[3]))
    band_h = img.height
    pad = 0.05 if margin_top else 0.0  # nuvole: bordo alto e basso liberi
    need_ratio = w / (h * (1 - 2 * pad))
    copies = 1
    max_copies = 6 if margin_top else 2  # terreno: al massimo due copie, poi si taglia dall'alto
    while img.width * copies / band_h < need_ratio and copies < max_copies:
        copies += 1
    wide = Image.new('RGBA', (img.width * copies, band_h), (0, 0, 0, 0))
    for i in range(copies):
        wide.paste(img, (i * img.width, 0))
    scale = w / wide.width
    new_h = max(1, round(band_h * scale))
    wide = wide.resize((w, new_h), Image.LANCZOS)
    out = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    if new_h <= h:
        top = (h - new_h) // 2 if margin_top else h - new_h  # non-nuvole: appoggiate in basso
        out.paste(wide, (0, top))
    else:
        # troppo alta: riduci ancora mantenendo la larghezza piena con una copia in piu'
        out = wide.crop((0, new_h - h, w, new_h)) if not margin_top else wide.crop((0, (new_h - h) // 2, w, (new_h - h) // 2 + h))
        if not margin_top:
            # sfumatura verso il trasparente in cima, cosi' il taglio non si vede
            fade = min(40, h // 4)
            a = out.split()[3].load()
            for y in range(fade):
                k = y / fade
                for x in range(w):
                    a[x, y] = int(a[x, y] * k)
            out.putalpha(out.split()[3])
    return out


def binarize_alpha(img: Image.Image) -> Image.Image:
    a = img.split()[3].point(lambda v: 0 if v < 32 else (255 if v > 224 else v))
    img.putalpha(a)
    return img


def seam(img: Image.Image, axis: str) -> float:
    rgb = img.convert('RGBA')
    w, h = rgb.size
    px = rgb.load()
    total, n = 0, 0
    if axis == 'x':
        pairs = ((px[0, y], px[w - 1, y]) for y in range(h))
    else:
        pairs = ((px[x, 0], px[x, h - 1]) for x in range(w))
    for a, b in pairs:
        if a[3] == 0 and b[3] == 0:
            continue
        total += sum(abs(a[i] - b[i]) for i in range(4)) / 4
        n += 1
    return round(total / n, 1) if n else 0.0


def main() -> int:
    if len(sys.argv) < 5:
        print(__doc__)
        return 2
    src, dst, w, h = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
    flags = set(sys.argv[5:])
    img = Image.open(src).convert('RGBA')
    if '--opaque' not in flags:
        img = flood_uniform_background(img)
    if '--crossfade' in flags:
        img = make_seamless(img)
    if '--tile-x' in flags and '--opaque' not in flags and w / h > 4:
        img = fit_strip(img, w, h, margin_top=('--clouds' in flags))
        if '--fade-top' in flags:
            img = fade_top(img)
    elif '--opaque' not in flags and '--tile-x' not in flags and '--tile-xy' not in flags:
        img = fit_sprite(img, w, h)
    else:
        img = center_crop(img, w, h)
        img = img.resize((w, h), Image.LANCZOS)
    if '--opaque' in flags:
        img = img.convert('RGB').convert('RGBA')
    else:
        img = binarize_alpha(img)
    img.save(dst)
    alpha = img.split()[3]
    hist = alpha.histogram()
    metrics = {
        'size': list(img.size),
        'transparent_ratio': round(hist[0] / (w * h), 3),
        'seam_x': seam(img, 'x') if ('--tile-x' in flags or '--tile-xy' in flags) else None,
        'seam_y': seam(img, 'y') if '--tile-xy' in flags else None,
    }
    if '--clouds' in flags:
        top = alpha.crop((0, 0, w, 1)).getextrema()[1]
        bottom = alpha.crop((0, h - 1, w, h)).getextrema()[1]
        metrics['top_alpha'] = top
        metrics['bottom_alpha'] = bottom
    print(json.dumps(metrics))
    return 0


if __name__ == '__main__':
    sys.exit(main())
