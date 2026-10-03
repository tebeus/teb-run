#!/usr/bin/env python3
"""Prepara i PNG generati con AI per TEB RUN.

Rimuove lo sfondo (alfa già presente, chroma key, rembg, flood fill per
palette del bordo), ritaglia la trasparenza, divide le strip nei frame,
ridimensiona alla misura di tools/sprite-targets.json e scrive
public/sprites/ più il manifest.

Richiede solo Python 3 e Pillow. rembg è opzionale:
    python3 -m pip install rembg onnxruntime
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import deque

from PIL import Image, ImageChops, ImageFilter

try:  # opzionale: se manca si usa il flood fill
    import rembg  # type: ignore
except Exception:  # pragma: no cover - dipende dall'ambiente
    rembg = None


class SpriteError(Exception):
    """Errore di lavorazione con un messaggio leggibile per l'utente."""


# Soglia oltre la quale un pixel è considerato opaco.
ALPHA_THR = 16
CHROMA_KEY = (0, 255, 0)
CHROMA_TOL = 70
FLOOD_TOL = 26
BORDER_RING = 2
PALETTE_MERGE = 24
PALETTE_MIN_SHARE = 0.10
PALETTE_MAX = 4
# Immagini a tutto riquadro: non si isola nessuna componente, ogni pezzo conta.
FULL_BLEED_PREFIXES = (
    'bg_',
    'ending_',
    'ground_',
    'wall_',
    'map_full',
    'screen_',
    'transition_',
    'radio_panel',
)
FULL_BLEED_NAMES = ('asphalt',)
# Immagini che devono conservare il proprio sfondo: sono tessere piene o
# illustrazioni a tutto riquadro, non oggetti da scontornare (spec §13,
# "sfondo da tenere"). I muri (`wall_`) sono a tutto riquadro ma vanno
# scontornati sul lato, quindi stanno solo nella lista sopra.
KEEP_BACKGROUND_PREFIXES = (
    'ending_',
    'ground_',
    'map_full',
    'screen_',
    'transition_',
    'radio_panel',
)
KEEP_BACKGROUND_NAMES = ('asphalt',)


def hex_to_rgb(text: str) -> tuple[int, int, int]:
    value = text.strip().lstrip('#')
    if len(value) != 6:
        raise SpriteError(f'colore non valido: {text!r}, serve #rrggbb')
    try:
        return (int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16))
    except ValueError as exc:
        raise SpriteError(f'colore non valido: {text!r}, serve #rrggbb') from exc


def is_full_bleed(name: str) -> bool:
    return name.startswith(FULL_BLEED_PREFIXES) or name in FULL_BLEED_NAMES


def keeps_background(name: str) -> bool:
    return name.startswith(KEEP_BACKGROUND_PREFIXES) or name in KEEP_BACKGROUND_NAMES


def isolation_for(name: str) -> str:
    """Come pulire lo sprite: 'largest', 'specks' o 'none'."""
    if is_full_bleed(name):
        return 'none'
    if name == 'title_logo':
        return 'specks'
    return 'largest'


def near(c1, c2, tol: int) -> bool:
    return abs(c1[0] - c2[0]) <= tol and abs(c1[1] - c2[1]) <= tol and abs(c1[2] - c2[2]) <= tol


# ---------------------------------------------------------------------------
# Rimozione dello sfondo
# ---------------------------------------------------------------------------


def has_real_alpha(img: Image.Image) -> bool:
    """True se l'immagine ha un canale alfa con almeno un pixel trasparente."""
    if img.mode not in ('RGBA', 'LA'):
        return False
    low, _high = img.getchannel('A').getextrema()
    return low < ALPHA_THR


def corner_colors(img: Image.Image):
    w, h = img.size
    px = img.convert('RGB').load()
    return [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]


def is_chroma_background(img: Image.Image, key=CHROMA_KEY, tol: int = CHROMA_TOL) -> bool:
    """True se almeno tre angoli su quattro sono del colore chiave."""
    return sum(1 for c in corner_colors(img) if near(c, key, tol)) >= 3


def color_distance_mask(img: Image.Image, color, tol: int) -> Image.Image:
    """Maschera 'L': 255 dove ogni canale è entro `tol` da `color`."""
    rgb = img.convert('RGB')
    out = None
    for channel, value in zip(rgb.split(), color):
        flat = Image.new('L', rgb.size, value)
        diff = ImageChops.add(ImageChops.subtract(channel, flat), ImageChops.subtract(flat, channel))
        mask = diff.point(lambda v, t=tol: 255 if v <= t else 0)
        out = mask if out is None else ImageChops.multiply(out, mask)
    assert out is not None
    return out


def remove_chroma(img: Image.Image, key=CHROMA_KEY, tol: int = CHROMA_TOL) -> Image.Image:
    out = img.convert('RGBA')
    keep = ImageChops.invert(color_distance_mask(out, key, tol))
    out.putalpha(ImageChops.multiply(out.getchannel('A'), keep))
    return out


def border_palette(
    img: Image.Image,
    ring: int = BORDER_RING,
    merge: int = PALETTE_MERGE,
    min_share: float = PALETTE_MIN_SHARE,
    max_colors: int = PALETTE_MAX,
):
    """Colori dominanti dell'anello di bordo, raggruppati per vicinanza.

    Sulla scacchiera dipinta del logo trova esattamente i due grigi della
    scacchiera e lascia fuori i colori del soggetto che sfiorano il bordo.
    """
    px = img.convert('RGB').load()
    w, h = img.size
    clusters: list[list] = []
    total = 0

    def add(color):
        nonlocal total
        total += 1
        for cluster in clusters:
            if near(cluster[0], color, merge):
                cluster[1] += 1
                return
        clusters.append([color, 1])

    for x in range(w):
        for y in range(min(ring, h)):
            add(px[x, y])
            add(px[x, h - 1 - y])
    for y in range(h):
        for x in range(min(ring, w)):
            add(px[x, y])
            add(px[w - 1 - x, y])
    clusters.sort(key=lambda cluster: -cluster[1])
    if total == 0:
        return []
    return [cluster[0] for cluster in clusters[:max_colors] if cluster[1] >= min_share * total]


def flood_from_border(candidate, w: int, h: int) -> bytearray:
    """Riempimento a scanline dai bordi sui pixel candidati (0/non 0)."""
    reached = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))
    while stack:
        x, y = stack.pop()
        row = y * w
        if not candidate[row + x] or reached[row + x]:
            continue
        x0 = x
        while x0 > 0 and candidate[row + x0 - 1] and not reached[row + x0 - 1]:
            x0 -= 1
        x1 = x
        while x1 + 1 < w and candidate[row + x1 + 1] and not reached[row + x1 + 1]:
            x1 += 1
        for xx in range(x0, x1 + 1):
            reached[row + xx] = 1
        for ny in (y - 1, y + 1):
            if 0 <= ny < h:
                nrow = ny * w
                for xx in range(x0, x1 + 1):
                    if candidate[nrow + xx] and not reached[nrow + xx]:
                        stack.append((xx, ny))
    return reached


def remove_background_flood(img: Image.Image, tol: int = FLOOD_TOL) -> Image.Image:
    """Rimuove lo sfondo dipinto: riempimento dai bordi sui colori del bordo.

    Limiti da tenere presenti: se il soggetto tocca il bordo dell'immagine con
    un colore che è anche dello sfondo, il riempimento entra nel soggetto;
    se lo sfondo ha più di quattro colori dominanti, ne resta qualcuno.
    """
    out = img.convert('RGBA')
    palette = border_palette(out)
    if not palette:
        return out
    candidate = None
    for color in palette:
        mask = color_distance_mask(out, color, tol)
        candidate = mask if candidate is None else ImageChops.lighter(candidate, mask)
    assert candidate is not None
    w, h = out.size
    reached = flood_from_border(candidate.tobytes(), w, h)
    keep = Image.frombytes('L', (w, h), bytes(0 if v else 255 for v in reached))
    out.putalpha(ImageChops.multiply(out.getchannel('A'), keep))
    return out


def remove_background(img: Image.Image, mode: str = 'auto', tol: int = FLOOD_TOL, use_rembg: bool = True):
    """Catena della spec §13. Ritorna (immagine RGBA, nome del metodo)."""
    if mode.startswith('#'):
        return remove_chroma(img, hex_to_rgb(mode), CHROMA_TOL), f'chroma {mode.lower()}'
    if mode == 'keep':
        return img.convert('RGBA'), 'alpha'
    if mode != 'auto':
        raise SpriteError(f'background {mode!r} non riconosciuto: usa "auto", "keep" o #rrggbb')
    if has_real_alpha(img):
        return img.convert('RGBA'), 'alpha'
    if is_chroma_background(img):
        return remove_chroma(img), 'chroma #00ff00'
    if use_rembg and rembg is not None:
        return rembg.remove(img.convert('RGBA')), 'rembg'
    return remove_background_flood(img, tol), 'floodfill'


# ---------------------------------------------------------------------------
# Ritaglio, componenti, strip
# ---------------------------------------------------------------------------


def alpha_mask(img: Image.Image, thr: int = ALPHA_THR, radius: int = 0) -> Image.Image:
    mask = img.convert('RGBA').getchannel('A').point(lambda v, t=thr: 255 if v >= t else 0)
    if radius > 0:
        mask = mask.filter(ImageFilter.MaxFilter(2 * radius + 1))
    return mask


def alpha_bbox(img: Image.Image, thr: int = ALPHA_THR):
    return alpha_mask(img, thr).getbbox()


def trim_alpha(img: Image.Image, thr: int = ALPHA_THR):
    bbox = alpha_bbox(img, thr)
    return img.convert('RGBA').crop(bbox) if bbox else None


def label_components(mask: Image.Image):
    """Componenti connesse 4-vicini: lista di (pixel, bbox), non ordinata."""
    w, h = mask.size
    px = mask.load()
    seen = bytearray(w * h)
    out = []
    for y0 in range(h):
        row = y0 * w
        for x0 in range(w):
            if not px[x0, y0] or seen[row + x0]:
                continue
            queue = deque([(x0, y0)])
            seen[row + x0] = 1
            pixels = []
            minx = maxx = x0
            miny = maxy = y0
            while queue:
                x, y = queue.popleft()
                pixels.append((x, y))
                if x < minx:
                    minx = x
                if x > maxx:
                    maxx = x
                if y < miny:
                    miny = y
                if y > maxy:
                    maxy = y
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and not seen[ny * w + nx]:
                        seen[ny * w + nx] = 1
                        queue.append((nx, ny))
            out.append((pixels, (minx, miny, maxx, maxy)))
    return out


def component_area(pixels, base_px) -> int:
    """Pixel della componente che sono opachi nella maschera non dilatata."""
    return sum(1 for x, y in pixels if base_px[x, y])


def keep_largest_component(img: Image.Image, radius: int = 3, thr: int = ALPHA_THR):
    """Tiene solo la componente più grande. Ritorna (immagine, n componenti).

    `radius` dilata la maschera prima di raggruppare, così le parti vicine
    dello stesso oggetto (il braccio di un lampione, il palo di un cartello)
    restano insieme; l'area invece si misura sui pixel davvero opachi.
    """
    out = img.convert('RGBA')
    components = label_components(alpha_mask(out, thr, radius))
    if len(components) <= 1:
        return out, len(components)
    base_px = alpha_mask(out, thr).load()
    components.sort(key=lambda c: component_area(c[0], base_px), reverse=True)
    keep = Image.new('L', out.size, 0)
    kp = keep.load()
    for x, y in components[0][0]:
        kp[x, y] = 255
    out.putalpha(ImageChops.multiply(out.getchannel('A'), keep))
    return out, len(components)


def drop_small_components(img: Image.Image, min_area: int = 0, radius: int = 3, thr: int = ALPHA_THR):
    """Cancella le componenti sotto `min_area` pixel, tiene tutte le altre.

    Serve per le illustrazioni composte da più pezzi (il logo ha le barre di
    velocità staccate dalle lettere) dove `keep_largest_component` butterebbe
    via troppo, ma i granelli lasciati dalla rimozione dello sfondo vanno via.
    Con `min_area = 0` la soglia è lo 0,05% dei pixel dell'immagine.
    """
    out = img.convert('RGBA')
    limit = min_area if min_area > 0 else max(16, int(out.size[0] * out.size[1] * 0.0005))
    components = label_components(alpha_mask(out, thr, radius))
    base_px = alpha_mask(out, thr).load()
    big = [c for c in components if component_area(c[0], base_px) >= limit]
    if len(big) == len(components):
        return out
    keep = Image.new('L', out.size, 0)
    kp = keep.load()
    for pixels, _bbox in big:
        for x, y in pixels:
            kp[x, y] = 255
    out.putalpha(ImageChops.multiply(out.getchannel('A'), keep))
    return out


def clear_component_at(img: Image.Image, point, radius: int = 1, thr: int = ALPHA_THR):
    """Cancella la componente che contiene `point`. Ritorna (immagine, n px)."""
    out = img.convert('RGBA')
    mask = alpha_mask(out, thr, radius)
    w, h = out.size
    px = mask.load()
    x0, y0 = int(point[0]), int(point[1])
    if not (0 <= x0 < w and 0 <= y0 < h) or not px[x0, y0]:
        raise SpriteError(f'ignoreAt {tuple(point)}: non è su un pixel opaco del foglio')
    queue = deque([(x0, y0)])
    seen = {(x0, y0)}
    clear = Image.new('L', (w, h), 255)
    cp = clear.load()
    while queue:
        x, y = queue.popleft()
        cp[x, y] = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < w and 0 <= ny < h and px[nx, ny] and (nx, ny) not in seen:
                seen.add((nx, ny))
                queue.append((nx, ny))
    out.putalpha(ImageChops.multiply(out.getchannel('A'), clear))
    return out, len(seen)


def column_segments(mask: Image.Image):
    """Intervalli di colonne che contengono almeno un pixel opaco."""
    w, h = mask.size
    px = mask.load()
    segments = []
    start = None
    for x in range(w):
        filled = False
        for y in range(h):
            if px[x, y]:
                filled = True
                break
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            segments.append((start, x - 1))
            start = None
    if start is not None:
        segments.append((start, w - 1))
    return segments


def split_frames(img: Image.Image, frames: int, thr: int = ALPHA_THR):
    """Divide una strip nei frame: per colonne vuote, o in parti uguali."""
    if frames <= 1:
        return [img.convert('RGBA')]
    rgba = img.convert('RGBA')
    w, h = rgba.size
    segments = column_segments(alpha_mask(rgba, thr))
    if len(segments) == frames:
        return [rgba.crop((s, 0, e + 1, h)) for s, e in segments]
    step = w / frames
    return [rgba.crop((int(i * step), 0, int((i + 1) * step), h)) for i in range(frames)]


# ---------------------------------------------------------------------------
# Scala e composizione
# ---------------------------------------------------------------------------


def fit_size(sw: int, sh: int, bw: int, bh: int):
    """Misura che entra in (bw, bh) conservando le proporzioni."""
    if sw <= 0 or sh <= 0:
        return (1, 1)
    scale = min(bw / sw, bh / sh)
    return (max(1, round(sw * scale)), max(1, round(sh * scale)))


def fit_into(img: Image.Image, bw: int, bh: int) -> Image.Image:
    return img.convert('RGBA').resize(fit_size(img.size[0], img.size[1], bw, bh), Image.LANCZOS)


def pad_cell(img: Image.Image, bw: int, bh: int, anchor: str = 'bottom') -> Image.Image:
    """Centra l'immagine in una cella bw x bh trasparente."""
    cell = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    x = max(0, (bw - img.size[0]) // 2)
    y = max(0, bh - img.size[1]) if anchor == 'bottom' else max(0, (bh - img.size[1]) // 2)
    cell.alpha_composite(img.convert('RGBA'), (x, y))
    return cell


def mirror_tile(img: Image.Image) -> Image.Image:
    """Affianca l'immagine al suo specchio: i due bordi esterni combaciano."""
    rgba = img.convert('RGBA')
    w, h = rgba.size
    out = Image.new('RGBA', (w * 2, h), (0, 0, 0, 0))
    out.alpha_composite(rgba, (0, 0))
    out.alpha_composite(rgba.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    return out


# ---------------------------------------------------------------------------
# Disposizione sui fogli
# ---------------------------------------------------------------------------


def cluster_rows(boxes):
    """Raggruppa i box in righe per centro verticale, ogni riga ordinata per x."""
    rows: list[list] = []
    for box in sorted(boxes, key=lambda b: (b[1] + b[3]) / 2):
        cy = (box[1] + box[3]) / 2
        placed = False
        for row in rows:
            top = min(b[1] for b in row)
            bottom = max(b[3] for b in row)
            if top <= cy <= bottom:
                row.append(box)
                placed = True
                break
        if not placed:
            rows.append([box])
    for row in rows:
        row.sort(key=lambda b: b[0])
    return rows


def cells_from_cuts(box, cuts):
    """Celle (x0, y0, x1, y1) fra tagli consecutivi, limitate al box."""
    x0, y0, x1, y1 = box
    cells = []
    for i in range(len(cuts) - 1):
        a = max(x0, min(int(cuts[i]), x1))
        b = max(x0, min(int(cuts[i + 1]), x1))
        cells.append((a, y0, b, y1))
    return cells


# ---------------------------------------------------------------------------
# Pipeline
# ---------------------------------------------------------------------------


def load_json(path: str):
    try:
        with open(path, encoding='utf-8') as handle:
            return json.load(handle)
    except OSError as exc:
        raise SpriteError(f'{path}: non si riesce a leggere ({exc})') from exc
    except ValueError as exc:
        raise SpriteError(f'{path}: JSON non valido ({exc})') from exc


def load_targets(path: str):
    data = load_json(path)
    if not isinstance(data, dict):
        raise SpriteError(f'{path}: serve un oggetto nome -> {{w, h, frames?}}')
    for name, target in data.items():
        if not isinstance(target, dict) or 'w' not in target or 'h' not in target:
            raise SpriteError(f'{path}: la voce {name} non ha w e h')
    return data


def size_warnings(name: str, sw: int, sh: int, target) -> list[str]:
    """Avvisi su ingrandimento eccessivo e proporzioni molto diverse."""
    out = []
    upscale = max(target['w'] / max(1, sw), target['h'] / max(1, sh))
    if upscale > 2:
        out.append(
            f'{name}: sorgente {sw}x{sh} per un target {target["w"]}x{target["h"]}, '
            f'ingrandimento {upscale:.1f}x: l\'immagine sarà sfocata'
        )
    src_aspect = sw / max(1, sh)
    target_aspect = target['w'] / max(1, target['h'])
    ratio = max(src_aspect / target_aspect, target_aspect / src_aspect)
    if ratio > 1.6:
        out.append(
            f'{name}: proporzioni molto diverse dal target '
            f'({src_aspect:.2f} contro {target_aspect:.2f}): resterà molto più piccolo del riquadro'
        )
    return out


def warn_size_for(name: str, trimmed: Image.Image, target, mirror: bool) -> list[str]:
    """Avvisi sulla misura che l'immagine avrà davvero, specchiatura inclusa.

    `process_sprite` raddoppia la larghezza dei `bg_*` con `--mirror`: senza
    questa correzione gli avvisi sulle proporzioni degli sfondi sarebbero falsi
    allarmi (misurati: 4 dei 10 `bg_*` avvisavano a torto).
    """
    width = trimmed.size[0] * (2 if mirror and name.startswith('bg_') else 1)
    return size_warnings(name, width, trimmed.size[1], target)


def process_sprite(img: Image.Image, name: str, target, mirror: bool = False, isolate=None) -> Image.Image:
    """Isola, ritaglia, eventualmente specchia e porta alla misura finale.

    `isolate`: None usa `isolation_for(name)`, altrimenti 'largest', 'specks'
    o 'none'.
    """
    work = img.convert('RGBA')
    mode = isolation_for(name) if isolate is None else isolate
    if mode == 'largest':
        work, _count = keep_largest_component(work)
    elif mode == 'specks':
        work = drop_small_components(work)
    elif mode != 'none':
        raise SpriteError(f'{name}: isolate {mode!r} non valido')
    trimmed = trim_alpha(work)
    if trimmed is None:
        raise SpriteError(f'{name}: dopo la rimozione dello sfondo non resta nessun pixel opaco')
    exact = target.get('trim', True) is False
    if exact:
        # Consegnata già alla misura esatta, margini trasparenti compresi
        # (le nuvole: i bordi vuoti tengono la cucitura e la quota nel cielo),
        # e già ciclica: niente ritaglio e niente specchio, che metterebbe
        # una giunzione simmetrica in mezzo alla panoramica.
        trimmed = work
    if mirror and name.startswith('bg_') and not exact:
        trimmed = mirror_tile(trimmed)
    return fit_into(trimmed, target['w'], target['h'])


def process_strip(img: Image.Image, target) -> Image.Image:
    """Strip: frame di uguale larghezza, ognuno appoggiato in basso."""
    frames = int(target.get('frames', 1))
    if frames < 2:
        raise SpriteError('process_strip vuole un target con frames >= 2')
    cell_w = int(target['w'])
    cell_h = int(target['h'])
    out = Image.new('RGBA', (cell_w * frames, cell_h), (0, 0, 0, 0))
    for index, part in enumerate(split_frames(img, frames)):
        trimmed = trim_alpha(part)
        if trimmed is None:
            raise SpriteError(f'frame {index} della strip è vuoto')
        cell = pad_cell(fit_into(trimmed, cell_w, cell_h), cell_w, cell_h, 'bottom')
        out.alpha_composite(cell, (index * cell_w, 0))
    return out


def save_sprite(out_dir: str, name: str, img: Image.Image, frames: int = 1):
    os.makedirs(out_dir, exist_ok=True)
    file_name = f'{name}.png'
    img.save(os.path.join(out_dir, file_name))
    entry = {'file': file_name, 'w': img.size[0], 'h': img.size[1]}
    if frames > 1:
        entry['frames'] = frames
    return entry


def write_manifest(out_dir: str, entries):
    """Riscrive il manifest unendo le voci nuove e scartando i PNG scomparsi."""
    path = os.path.join(out_dir, 'manifest.json')
    existing = {}
    if os.path.exists(path):
        try:
            with open(path, encoding='utf-8') as handle:
                loaded = json.load(handle)
            if isinstance(loaded, dict):
                existing = loaded
        except (OSError, ValueError):
            existing = {}
    existing.update(entries)
    kept = {
        key: value
        for key, value in sorted(existing.items())
        if isinstance(value, dict) and os.path.exists(os.path.join(out_dir, value.get('file', f'{key}.png')))
    }
    os.makedirs(out_dir, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as handle:
        json.dump(kept, handle, indent=2, sort_keys=True)
        handle.write('\n')
    return kept


def find_raw_files(raw_dir: str):
    """(stem, path) dei PNG in `raw_dir`, esclusi quelli che iniziano con _."""
    out = []
    if not os.path.isdir(raw_dir):
        return out
    for entry in sorted(os.listdir(raw_dir)):
        if not entry.lower().endswith('.png') or entry.startswith('_'):
            continue
        stem = entry[:-4]
        out.append((stem, os.path.join(raw_dir, entry)))
    return out


def process_raw_file(path: str, stem: str, target, out_dir: str, mirror: bool):
    """Un file di `art/raw`: ritorna (voci di manifest, avvisi, riga di report)."""
    source = Image.open(path)
    background_mode = 'keep' if keeps_background(stem) else 'auto'
    # Il target può forzare la catena, come `background` di un foglio: una
    # tessera piena senza alfa (`wall_rock_grey`) va tenuta intera, o il
    # riempimento dai bordi la bucherebbe.
    background_mode = str(target.get('background', background_mode))
    cleaned, method = remove_background(source, background_mode)
    frames = int(target.get('frames', 1))
    warnings = []
    if frames > 1 and target.get('trim', True) is False:
        # Strip consegnata già a celle della misura giusta, stessa scala in
        # ogni cella: si tiene com'è, senza ritagliare e riscalare i frame
        # uno per uno (lo farebbe pulsare).
        image = fit_into(cleaned, int(target['w']) * frames, int(target['h']))
        entry = save_sprite(out_dir, stem, image, frames)
        line = f'{stem}: strip di {frames} frame da {image.size[0] // frames}x{image.size[1]} tenuta intera ({method})'
        return {stem: entry}, warnings, line
    if frames > 1:
        for index, part in enumerate(split_frames(cleaned, frames)):
            piece = trim_alpha(part)
            if piece is not None:
                warnings.extend(warn_size_for(f'{stem} frame {index}', piece, target, False))
        image = process_strip(cleaned, target)
        entry = save_sprite(out_dir, stem, image, frames)
        per_frame = (image.size[0] // frames, image.size[1])
        line = f'{stem}: strip di {frames} frame da {per_frame[0]}x{per_frame[1]} ({method})'
    else:
        trimmed = trim_alpha(cleaned)
        if trimmed is None:
            raise SpriteError('dopo la rimozione dello sfondo non resta nessun pixel opaco')
        if target.get('trim', True) is not False:
            warnings.extend(warn_size_for(stem, trimmed, target, mirror))
        image = process_sprite(cleaned, stem, target, mirror=mirror)
        entry = save_sprite(out_dir, stem, image)
        line = f'{stem}: {image.size[0]}x{image.size[1]} ({method})'
    return {stem: entry}, warnings, line


def process_frame_group(items):
    """Frame di uno stesso oggetto (target con `group`): una scala sola.

    `items` è una lista di (nome, immagine, target). Ogni frame si isola e si
    ritaglia sul proprio contenuto, poi si appoggia in basso in un riquadro
    alto quanto il frame più alto del gruppo; tutti si scalano dello stesso
    fattore, così escono alti uguali e l'oggetto non cambia misura da un
    frame all'altro (spec §4.4 punto 5: l'auto non cresce quando sterza).
    Ritorna una lista di (nome, immagine).
    """
    heights = {int(target['h']) for _name, _img, target in items}
    if len(heights) != 1:
        raise SpriteError(f'gruppo {items[0][2].get("group")}: altezze diverse nei target {sorted(heights)}')
    out_h = heights.pop()
    max_w = min(int(target['w']) for _name, _img, target in items)
    pieces = []
    for name, img, _target in items:
        work, _count = keep_largest_component(img.convert('RGBA'))
        trimmed = trim_alpha(work)
        if trimmed is None:
            raise SpriteError(f'{name}: dopo la rimozione dello sfondo non resta nessun pixel opaco')
        pieces.append((name, trimmed))
    common_h = max(piece.size[1] for _name, piece in pieces)
    widest = max(piece.size[0] for _name, piece in pieces)
    factor = min(out_h / common_h, max_w / widest)
    out = []
    for name, piece in pieces:
        cell = Image.new('RGBA', (piece.size[0], common_h), (0, 0, 0, 0))
        cell.alpha_composite(piece, (0, common_h - piece.size[1]))
        size = (max(1, round(piece.size[0] * factor)), max(1, round(common_h * factor)))
        out.append((name, cell.resize(size, Image.LANCZOS)))
    return out


# ---------------------------------------------------------------------------
# Fogli con più oggetti
# ---------------------------------------------------------------------------

SKIP_NAME = '_skip'
SHEET_MIN_AREA = 400


def _int_box(value, where: str):
    if not isinstance(value, list) or len(value) != 4:
        raise SpriteError(f'{where}: box deve essere [x0, y0, x1, y1]')
    try:
        box = tuple(int(v) for v in value)
    except (TypeError, ValueError) as exc:
        raise SpriteError(f'{where}: box con valori non interi') from exc
    if box[0] >= box[2] or box[1] >= box[3]:
        raise SpriteError(f'{where}: box {box} vuoto o rovesciato')
    return box


def load_sheet_config_dict(raw, where: str):
    """Valida la configurazione di un foglio. Vedi tools/README.md."""
    if not isinstance(raw, dict):
        raise SpriteError(f'{where}: serve un oggetto JSON')
    background = raw.get('background', 'auto')
    if not isinstance(background, str) or (
        background not in ('auto', 'keep') and not background.startswith('#')
    ):
        raise SpriteError(f'{where}: background {background!r} non valido: "auto", "keep" o #rrggbb')
    if background.startswith('#'):
        hex_to_rgb(background)
    has_groups = isinstance(raw.get('groups'), list)
    has_rows = isinstance(raw.get('rows'), list)
    if has_groups == has_rows:
        raise SpriteError(f'{where}: serve esattamente uno fra "groups" e "rows"')

    ignore = []
    for point in raw.get('ignoreAt', []) or []:
        if not isinstance(point, list) or len(point) != 2:
            raise SpriteError(f'{where}: ignoreAt vuole coppie [x, y]')
        ignore.append([int(point[0]), int(point[1])])

    cfg = {
        'background': background,
        'ignoreAt': ignore,
        'minArea': int(raw.get('minArea', SHEET_MIN_AREA)),
    }

    if has_rows:
        rows = []
        for index, row in enumerate(raw['rows']):
            if not isinstance(row, list) or not row or not all(isinstance(n, str) for n in row):
                raise SpriteError(f'{where}: riga {index} deve essere una lista di nomi')
            rows.append(list(row))
        cfg['rows'] = rows
        return cfg

    groups = []
    for index, group in enumerate(raw['groups']):
        where_group = f'{where}: gruppo {index}'
        if not isinstance(group, dict):
            raise SpriteError(f'{where_group}: serve un oggetto')
        names = group.get('names')
        if not isinstance(names, list) or not names or not all(isinstance(n, str) for n in names):
            raise SpriteError(f'{where_group}: names deve essere una lista di nomi')
        box = _int_box(group.get('box'), where_group)
        entry = {'box': box, 'names': list(names), 'keepAll': bool(group.get('keepAll', False))}
        if 'target' in group:
            if not isinstance(group['target'], str):
                raise SpriteError(f'{where_group}: target deve essere il nome di una voce di sprite-targets.json')
            entry['target'] = group['target']
        if 'cuts' in group:
            cuts = group['cuts']
            if not isinstance(cuts, list) or len(cuts) != len(names) + 1:
                raise SpriteError(
                    f'{where_group}: cuts deve avere {len(names) + 1} valori '
                    f'({len(names)} nomi + 1), ne ha {len(cuts) if isinstance(cuts, list) else "nessuno"}'
                )
            try:
                cuts = [int(v) for v in cuts]
            except (TypeError, ValueError) as exc:
                raise SpriteError(f'{where_group}: cuts con valori non interi') from exc
            if any(cuts[i] > cuts[i + 1] for i in range(len(cuts) - 1)):
                raise SpriteError(f'{where_group}: cuts non è crescente: {cuts}')
            entry['cuts'] = cuts
        groups.append(entry)
    cfg['groups'] = groups
    return cfg


def load_sheet_config(path: str):
    return load_sheet_config_dict(load_json(path), path)


def find_sheet_config(raw_dir: str, sheets_dir: str, stem: str):
    """Configurazione del foglio: prima accanto all'immagine, poi in tools/sheets."""
    for candidate in (os.path.join(raw_dir, 'sheets', f'{stem}.json'), os.path.join(sheets_dir, f'{stem}.json')):
        if os.path.exists(candidate):
            return candidate
    return None


def find_sheets(raw_dir: str):
    """(stem, path) dei fogli in `raw_dir/sheets`."""
    folder = os.path.join(raw_dir, 'sheets')
    out = []
    if not os.path.isdir(folder):
        return out
    for entry in sorted(os.listdir(folder)):
        if entry.lower().endswith('.png') and not entry.startswith('_'):
            out.append((entry[:-4], os.path.join(folder, entry)))
    return out


def _describe(boxes) -> str:
    return ', '.join(f'({b[0]},{b[1]})-({b[2]},{b[3]})' for b in boxes)


def sheet_cells(sheet: Image.Image, cfg):
    """(nome, box, gruppo) per ogni cella del foglio, in ordine di lettura."""
    if 'groups' in cfg:
        out = []
        for group in cfg['groups']:
            box = group['box']
            cuts = group.get('cuts')
            if cuts is None:
                boxes = [
                    (b[0], b[1], b[2] + 1, b[3] + 1)
                    for _pixels, b in _sheet_components(sheet, box, cfg['minArea'])
                ]
                boxes.sort(key=lambda b: b[0])
                if len(boxes) != len(group['names']):
                    raise SpriteError(
                        f'gruppo con box {box}: trovati {len(boxes)} oggetti per {len(group["names"])} '
                        f'nomi. Box trovati: {_describe(boxes)}'
                    )
            else:
                boxes = cells_from_cuts(box, cuts)
            for name, cell_box in zip(group['names'], boxes):
                out.append((name, cell_box, group))
        return out

    components = _sheet_components(sheet, (0, 0, sheet.size[0], sheet.size[1]), cfg['minArea'])
    rows = cluster_rows([b for _pixels, b in components])
    if len(rows) != len(cfg['rows']):
        raise SpriteError(
            f'il foglio ha {len(rows)} righe di oggetti ma la configurazione ne elenca '
            f'{len(cfg["rows"])}. Righe trovate: '
            + '; '.join(_describe(row) for row in rows)
        )
    out = []
    for index, (row, names) in enumerate(zip(rows, cfg['rows'])):
        if len(row) != len(names):
            raise SpriteError(
                f'riga {index}: {len(row)} oggetti per {len(names)} nomi. Box trovati: {_describe(row)}'
            )
        for name, box in zip(names, row):
            out.append((name, (box[0], box[1], box[2] + 1, box[3] + 1), {'keepAll': False}))
    return out


def _sheet_components(sheet: Image.Image, box, min_area: int):
    """Componenti connesse dentro `box`, con i box riportati in coordinate foglio."""
    crop = sheet.crop((box[0], box[1], box[2], box[3]))
    found = label_components(alpha_mask(crop, ALPHA_THR, 1))
    out = []
    for pixels, bbox in found:
        if len(pixels) < min_area:
            continue
        out.append((pixels, (bbox[0] + box[0], bbox[1] + box[1], bbox[2] + box[0], bbox[3] + box[1])))
    return out


def resolve_target(name: str, group, targets):
    """Misura finale di una cella: il target del gruppo o quello del nome."""
    key = group.get('target') or name
    target = targets.get(key)
    if target is None:
        raise SpriteError(
            f'{name}: nessuna misura per {key!r} in sprite-targets.json; '
            'controlla il nome (probabile refuso) oppure aggiungi "target" al gruppo del foglio'
        )
    return {'w': int(target['w']), 'h': int(target['h'])}


def process_sheet(path: str, cfg, targets, out_dir: str, mirror: bool = False, only=None, singles=frozenset()):
    """Lavora un foglio intero. Ritorna (voci, avvisi, righe di report, metodo).

    `singles`: nomi che hanno un file singolo in `art/raw`. Il file singolo
    vince sulla cella del foglio, che viene saltata: i fogli sono le
    consegne vecchie, i file singoli quelle che le sostituiscono.
    """
    sheet = Image.open(path)
    cleaned, method = remove_background(sheet, cfg['background'])
    for point in cfg['ignoreAt']:
        cleaned, _size = clear_component_at(cleaned, point)
    images = []
    warnings = []
    label = os.path.basename(path)
    for name, box, group in sheet_cells(cleaned, cfg):
        if name == SKIP_NAME:
            continue
        if only is not None and name not in only:
            continue
        if name in singles:
            continue
        target = resolve_target(name, group, targets)
        work = cleaned.crop((box[0], box[1], box[2], box[3]))
        mode = 'none' if group.get('keepAll', False) else isolation_for(name)
        if mode == 'largest':
            work, _count = keep_largest_component(work)
        elif mode == 'specks':
            work = drop_small_components(work)
        trimmed = trim_alpha(work)
        if trimmed is None:
            raise SpriteError(f'{name}: la cella {box} del foglio {label} è vuota')
        warnings.extend(warn_size_for(name, trimmed, target, mirror))
        image = process_sprite(work, name, target, mirror=mirror, isolate='none')
        images.append((name, image))
    # Si scrive su disco solo dopo che ogni cella è stata elaborata con successo,
    # così un errore a metà foglio non lascia PNG orfani e non finti "scritti".
    entries = {}
    lines = []
    for name, image in images:
        entries[name] = save_sprite(out_dir, name, image)
        lines.append(f'{name}: {image.size[0]}x{image.size[1]} da {label}')
    return entries, warnings, lines, method


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description='Prepara i PNG di art/raw per public/sprites (vedi tools/README.md).'
    )
    parser.add_argument('--raw', default='art/raw', help='cartella delle immagini originali')
    parser.add_argument('--out', default='public/sprites', help='cartella di destinazione')
    parser.add_argument('--targets', default='tools/sprite-targets.json', help='misure finali')
    parser.add_argument('--only', nargs='*', default=None, help='lavora solo questi nomi')
    parser.add_argument('--mirror', action='store_true', help='rendi ciclici gli sfondi bg_* specchiandoli')
    parser.add_argument('--quiet', action='store_true', help='stampa solo avvisi ed errori')
    parser.add_argument('--sheets-dir', default='tools/sheets', help='configurazioni dei fogli')
    parser.add_argument('--no-sheets', action='store_true', help='non lavorare i fogli')
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    try:
        targets = load_targets(args.targets)
    except SpriteError as exc:
        print(f'ERRORE {exc}', file=sys.stderr)
        return 2
    only = set(args.only) if args.only else None
    entries = {}
    warnings = []
    errors = []
    lines = []
    raw_files = find_raw_files(args.raw)
    singles = frozenset(stem for stem, _path in raw_files if stem in targets)
    groups: dict[str, list] = {}
    for stem, path in raw_files:
        if only is not None and stem not in only:
            continue
        if stem not in targets:
            warnings.append(f'{stem}: nessuna misura in {args.targets}, lo salto')
            continue
        if targets[stem].get('group'):
            groups.setdefault(str(targets[stem]['group']), []).append((stem, path))
            continue
        try:
            new_entries, new_warnings, line = process_raw_file(path, stem, targets[stem], args.out, args.mirror)
        except (SpriteError, OSError) as exc:
            errors.append(f'{stem}: {exc}')
            continue
        entries.update(new_entries)
        warnings.extend(new_warnings)
        lines.append(line)
    for group, members in sorted(groups.items()):
        # Un gruppo si lavora intero: la scala comune dipende da tutti i
        # frame, quindi con --only basta nominarne uno.
        if only is not None:
            members = [(stem, path) for stem, path in raw_files if targets.get(stem, {}).get('group') == group]
        try:
            items = []
            for stem, path in members:
                cleaned, _method = remove_background(Image.open(path), 'auto')
                items.append((stem, cleaned, targets[stem]))
            for stem, image in process_frame_group(items):
                entries[stem] = save_sprite(args.out, stem, image)
                lines.append(f'{stem}: {image.size[0]}x{image.size[1]} (gruppo {group})')
        except (SpriteError, OSError) as exc:
            errors.append(f'gruppo {group}: {exc}')
    if not args.no_sheets:
        for stem, path in find_sheets(args.raw):
            config_path = find_sheet_config(args.raw, args.sheets_dir, stem)
            if config_path is None:
                warnings.append(
                    f'foglio {stem}: nessuna configurazione in {args.raw}/sheets/{stem}.json '
                    f'né in {args.sheets_dir}/{stem}.json, lo salto'
                )
                continue
            try:
                cfg = load_sheet_config(config_path)
                sheet_entries, sheet_warnings, sheet_lines, method = process_sheet(
                    path, cfg, targets, args.out, args.mirror, only, singles
                )
            except (SpriteError, OSError) as exc:
                errors.append(f'foglio {stem}: {exc}')
                continue
            entries.update(sheet_entries)
            warnings.extend(sheet_warnings)
            lines.extend(sheet_lines)
            lines.append(f'foglio {stem}: {len(sheet_entries)} sprite ({method})')
    manifest = write_manifest(args.out, entries)
    if not args.quiet:
        for line in lines:
            print(line)
        print(f'{len(entries)} sprite scritti in {args.out}, manifest con {len(manifest)} voci')
    for warning in warnings:
        print(f'WARN {warning}')
    for error in errors:
        print(f'ERRORE {error}', file=sys.stderr)
    return 1 if errors else 0


if __name__ == '__main__':
    raise SystemExit(main())
