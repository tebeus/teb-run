"""Test di tools/webp-sprites.py.

Esecuzione: python3 -m unittest discover -s tools -p 'test_*.py'
"""

import importlib.util
import io
import json
import os
import pathlib
import random
import tempfile
import unittest
from contextlib import redirect_stdout

from PIL import Image

_SPEC = importlib.util.spec_from_file_location(
    'webp_sprites', pathlib.Path(__file__).resolve().with_name('webp-sprites.py')
)
assert _SPEC is not None and _SPEC.loader is not None
ws = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ws)


def png_bytes(image: Image.Image) -> bytes:
    out = io.BytesIO()
    image.save(out, 'PNG')
    return out.getvalue()


def noisy(w: int, h: int) -> Image.Image:
    """Un'illustrazione finta: rumore colorato, con un bordo trasparente."""
    rng = random.Random(7)
    image = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for y in range(4, h - 4):
        for x in range(4, w - 4):
            image.putpixel((x, y), (rng.randrange(256), rng.randrange(256), rng.randrange(256), 255))
    return image


class ConvertTest(unittest.TestCase):
    def test_flat_art_goes_lossless_and_keeps_every_pixel(self):
        image = Image.new('RGBA', (64, 32), (0, 0, 0, 0))
        for x in range(10, 50):
            for y in range(5, 25):
                image.putpixel((x, y), (255, 40, 90, 255))
        data, lossless = ws.convert(png_bytes(image))
        self.assertTrue(lossless)
        back = Image.open(io.BytesIO(data)).convert('RGBA')
        self.assertEqual(list(back.getdata()), list(image.getdata()))

    def test_noisy_art_goes_lossy_with_the_alpha_intact(self):
        image = noisy(96, 64)
        data, lossless = ws.convert(png_bytes(image))
        self.assertFalse(lossless)
        back = Image.open(io.BytesIO(data)).convert('RGBA')
        self.assertEqual(back.size, image.size)
        self.assertEqual(list(back.getchannel('A').getdata()), list(image.getchannel('A').getdata()))


class MainTest(unittest.TestCase):
    def test_writes_the_webp_files_and_reuses_the_cache(self):
        with tempfile.TemporaryDirectory() as tmp:
            src, out, cache = (os.path.join(tmp, d) for d in ('src', 'out', 'cache'))
            os.makedirs(src)
            noisy(40, 40).save(os.path.join(src, 'a_b.png'))
            for _ in range(2):
                buf = io.StringIO()
                with redirect_stdout(buf):
                    self.assertEqual(ws.main([src, out, cache, 'a_b.png']), 0)
                report = json.loads(buf.getvalue())
                self.assertEqual(report['a_b.png']['file'], 'a_b.webp')
                self.assertTrue(os.path.exists(os.path.join(out, 'a_b.webp')))
            self.assertEqual(len([f for f in os.listdir(cache) if f.endswith('.webp')]), 1)

    def test_refuses_paths_and_non_png_names(self):
        with tempfile.TemporaryDirectory() as tmp, redirect_stdout(io.StringIO()):
            self.assertEqual(ws.main([tmp, tmp, tmp, '../x.png']), 2)
            self.assertEqual(ws.main([tmp, tmp, tmp, 'x.jpg']), 2)


if __name__ == '__main__':
    unittest.main()
