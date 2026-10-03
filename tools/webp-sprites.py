#!/usr/bin/env python3
"""Converte in WebP i PNG degli sprite, per le build site e portal.

I PNG di public/sprites/ restano la sorgente nel repo: questo passo li legge
e scrive i .webp nella cartella della build (lo chiama vite.config.ts, mai a
mano sui PNG di public/). Ogni PNG diventa un WebP con l'alfa conservata:

- con perdita, qualità QUALITY, alfa senza perdita (alpha_quality 100), per
  le illustrazioni e le texture;
- senza perdita quando pesa meno di quello con perdita, o poco più
  (LOSSLESS_SLACK), come la grafica a pochi colori, i bordi e i loghi piccoli.

Le conversioni restano in una cache fuori da git (di solito
node_modules/.cache/teb-webp/), con il nome dato dallo sha256 del PNG e dei
parametri: la seconda build non riconverte niente.

    python3 tools/webp-sprites.py SRC_DIR OUT_DIR CACHE_DIR FILE.png [FILE.png ...]

Stampa su stdout una riga JSON: {"FILE.png": {"file": "FILE.webp", "lossless": bool, "png": n, "webp": n}}.
Richiede Pillow con il supporto WebP (python3 -m pip install Pillow).
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, features

QUALITY = 90
METHOD = 6
# Senza perdita se non pesa più del 15% di quello con perdita.
LOSSLESS_SLACK = 1.15
PARAMS = f"v1 q{QUALITY} m{METHOD} slack{LOSSLESS_SLACK}"


def encode(image: Image.Image, lossless: bool) -> bytes:
    out = io.BytesIO()
    if lossless:
        image.save(out, "WEBP", lossless=True, quality=100, method=METHOD, exact=False)
    else:
        image.save(out, "WEBP", quality=QUALITY, alpha_quality=100, method=METHOD)
    return out.getvalue()


def convert(png_bytes: bytes) -> tuple[bytes, bool]:
    """Il WebP più adatto per un PNG: con perdita, o senza se conviene. Pura."""
    image = Image.open(io.BytesIO(png_bytes))
    image.load()
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    lossy = encode(image, False)
    lossless = encode(image, True)
    if len(lossless) <= len(lossy) * LOSSLESS_SLACK:
        return lossless, True
    return lossy, False


def job(args: tuple[str, str, str, str]) -> tuple[str, dict]:
    src_dir, out_dir, cache_dir, name = args
    with open(os.path.join(src_dir, name), "rb") as fh:
        png_bytes = fh.read()
    key = hashlib.sha256(PARAMS.encode() + b"\0" + png_bytes).hexdigest()
    cached = os.path.join(cache_dir, f"{key}.webp")
    flag = os.path.join(cache_dir, f"{key}.lossless")
    if not os.path.exists(cached):
        data, lossless = convert(png_bytes)
        tmp = f"{cached}.{os.getpid()}.tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        if lossless:
            open(flag, "wb").close()
        os.replace(tmp, cached)
    webp_name = name[: -len(".png")] + ".webp"
    shutil.copyfile(cached, os.path.join(out_dir, webp_name))
    return name, {
        "file": webp_name,
        "lossless": os.path.exists(flag),
        "png": len(png_bytes),
        "webp": os.path.getsize(cached),
    }


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(__doc__, file=sys.stderr)
        return 2
    if not features.check("webp"):
        print("webp-sprites: Pillow senza supporto WebP", file=sys.stderr)
        return 1
    src_dir, out_dir, cache_dir, *names = argv
    bad = [n for n in names if not n.endswith(".png") or "/" in n or "\\" in n]
    if bad:
        print(f"webp-sprites: nomi non validi: {bad}", file=sys.stderr)
        return 2
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(cache_dir, exist_ok=True)
    jobs = [(src_dir, out_dir, cache_dir, n) for n in names]
    if len(jobs) <= 4:
        # Pochi file (o la cache piena): niente processi in più.
        results = dict(map(job, jobs))
    else:
        with ProcessPoolExecutor() as pool:
            results = dict(pool.map(job, jobs))
    print(json.dumps(results, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
