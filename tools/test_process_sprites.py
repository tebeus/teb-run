"""Test delle funzioni pure di tools/process-sprites.py.

Esecuzione: python3 -m unittest discover -s tools -p 'test_*.py'
"""

import contextlib
import importlib.util
import io
import json
import pathlib
import unittest

from PIL import Image, ImageDraw

_SPEC = importlib.util.spec_from_file_location(
    'process_sprites', pathlib.Path(__file__).resolve().with_name('process-sprites.py')
)
assert _SPEC is not None and _SPEC.loader is not None
ps = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(ps)


def checkerboard(w, h, a=(253, 253, 253), b=(201, 202, 209), cell=8):
    """Finta trasparenza dipinta, come in art/raw/title_logo.png."""
    img = Image.new('RGB', (w, h))
    px = img.load()
    for y in range(h):
        for x in range(w):
            px[x, y] = a if ((x // cell) + (y // cell)) % 2 == 0 else b
    return img


def blob(img, box, color=(200, 30, 40, 255)):
    ImageDraw.Draw(img).rectangle(box, fill=color)
    return img


class TestAlphaAndChroma(unittest.TestCase):
    def test_has_real_alpha(self):
        self.assertFalse(ps.has_real_alpha(Image.new('RGB', (4, 4), (1, 2, 3))))
        self.assertFalse(ps.has_real_alpha(Image.new('RGBA', (4, 4), (1, 2, 3, 255))))
        img = Image.new('RGBA', (4, 4), (1, 2, 3, 255))
        img.putpixel((0, 0), (1, 2, 3, 0))
        self.assertTrue(ps.has_real_alpha(img))

    def test_chroma_detected_and_removed(self):
        img = Image.new('RGB', (32, 32), (0, 255, 0))
        blob(img, (10, 10, 21, 21), (200, 30, 40))
        self.assertTrue(ps.is_chroma_background(img))
        out = ps.remove_chroma(img)
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((15, 15))[3], 255)

    def test_chroma_not_detected_on_painted_background(self):
        self.assertFalse(ps.is_chroma_background(checkerboard(32, 32)))


class TestFloodFill(unittest.TestCase):
    def test_removes_painted_checkerboard_and_keeps_inner_white(self):
        img = checkerboard(64, 64)
        blob(img, (20, 20, 43, 43), (200, 30, 40))
        blob(img, (28, 28, 33, 33), (255, 255, 255))
        out = ps.remove_background_flood(img)
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((63, 63))[3], 0)
        self.assertEqual(out.getpixel((22, 22))[3], 255)
        self.assertEqual(out.getpixel((30, 30))[3], 255, 'il bianco interno non è connesso al bordo')

    def test_border_palette_keeps_only_dominant_colors(self):
        img = checkerboard(64, 64)
        blob(img, (0, 30, 1, 33), (12, 200, 90))  # colore raro sul bordo
        palette = ps.border_palette(img)
        self.assertEqual(len(palette), 2)
        for color in palette:
            self.assertTrue(
                ps.near(color, (253, 253, 253), 24) or ps.near(color, (201, 202, 209), 24), color
            )

    def test_remove_background_prefers_existing_alpha(self):
        img = Image.new('RGBA', (16, 16), (10, 20, 30, 0))
        blob(img, (4, 4, 11, 11))
        out, method = ps.remove_background(img)
        self.assertEqual(method, 'alpha')
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((6, 6))[3], 255)

    def test_remove_background_uses_chroma_then_floodfill(self):
        chroma = Image.new('RGB', (16, 16), (0, 255, 0))
        blob(chroma, (4, 4, 11, 11), (200, 30, 40))
        self.assertEqual(ps.remove_background(chroma)[1], 'chroma #00ff00')
        painted = checkerboard(32, 32)
        blob(painted, (10, 10, 21, 21), (200, 30, 40))
        self.assertEqual(ps.remove_background(painted, use_rembg=False)[1], 'floodfill')

    def test_explicit_chroma_color(self):
        img = Image.new('RGB', (16, 16), (255, 0, 255))
        blob(img, (4, 4, 11, 11), (20, 30, 40))
        out, method = ps.remove_background(img, mode='#ff00ff')
        self.assertEqual(method, 'chroma #ff00ff')
        self.assertEqual(out.getpixel((0, 0))[3], 0)
        self.assertEqual(out.getpixel((6, 6))[3], 255)


class TestTrimAndComponents(unittest.TestCase):
    def test_trim_alpha(self):
        img = Image.new('RGBA', (20, 20), (0, 0, 0, 0))
        blob(img, (5, 6, 9, 11))
        self.assertEqual(ps.alpha_bbox(img), (5, 6, 10, 12))
        self.assertEqual(ps.trim_alpha(img).size, (5, 6))

    def test_trim_of_empty_image_is_none(self):
        self.assertIsNone(ps.trim_alpha(Image.new('RGBA', (8, 8), (0, 0, 0, 0))))

    def test_keep_largest_component_drops_the_speck(self):
        img = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(img, (2, 2, 17, 17))
        blob(img, (35, 15, 37, 17))
        out, count = ps.keep_largest_component(img)
        self.assertEqual(count, 2)
        self.assertEqual(out.getpixel((5, 5))[3], 255)
        self.assertEqual(out.getpixel((36, 16))[3], 0)
        self.assertEqual(ps.trim_alpha(out).size, (16, 16))

    def test_keep_largest_merges_nearby_parts(self):
        img = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(img, (2, 2, 9, 17))
        blob(img, (12, 2, 19, 17))  # a 3 px: la dilatazione le unisce
        out, count = ps.keep_largest_component(img, radius=3)
        self.assertEqual(count, 1)
        self.assertEqual(out.getpixel((15, 5))[3], 255)

    def test_drop_small_components_keeps_the_separate_big_pieces(self):
        img = Image.new('RGBA', (60, 40), (0, 0, 0, 0))
        blob(img, (2, 2, 21, 21))
        blob(img, (35, 2, 54, 21))
        blob(img, (30, 35, 31, 36))
        out = ps.drop_small_components(img, min_area=50)
        self.assertEqual(out.getpixel((10, 10))[3], 255)
        self.assertEqual(out.getpixel((45, 10))[3], 255)
        self.assertEqual(out.getpixel((30, 35))[3], 0)

    def test_drop_small_components_default_threshold(self):
        img = Image.new('RGBA', (100, 100), (0, 0, 0, 0))
        blob(img, (10, 10, 59, 59))
        blob(img, (90, 90, 91, 91))
        out = ps.drop_small_components(img)
        self.assertEqual(out.getpixel((30, 30))[3], 255)
        self.assertEqual(out.getpixel((90, 90))[3], 0)

    def test_clear_component_at(self):
        img = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(img, (2, 2, 9, 17))
        blob(img, (25, 2, 35, 17))
        out, size = ps.clear_component_at(img, (30, 8))
        self.assertGreater(size, 100)
        self.assertEqual(out.getpixel((30, 8))[3], 0)
        self.assertEqual(out.getpixel((5, 5))[3], 255)

    def test_clear_component_at_needs_an_opaque_pixel(self):
        img = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
        with self.assertRaises(ps.SpriteError):
            ps.clear_component_at(img, (5, 5))


class TestSplitAndFit(unittest.TestCase):
    def test_split_frames_by_transparent_columns(self):
        img = Image.new('RGBA', (34, 10), (0, 0, 0, 0))
        for i in range(3):
            blob(img, (i * 12 + 1, 1, i * 12 + 8, 8))
        parts = ps.split_frames(img, 3)
        self.assertEqual(len(parts), 3)
        self.assertEqual([p.size[0] for p in parts], [8, 8, 8])

    def test_split_frames_falls_back_to_equal_slices(self):
        img = Image.new('RGBA', (30, 10), (0, 0, 0, 0))
        blob(img, (0, 0, 29, 9))
        parts = ps.split_frames(img, 3)
        self.assertEqual([p.size[0] for p in parts], [10, 10, 10])

    def test_split_frames_one_frame_is_identity(self):
        img = Image.new('RGBA', (10, 10), (0, 0, 0, 0))
        self.assertEqual(ps.split_frames(img, 1)[0].size, (10, 10))

    def test_fit_size_preserves_aspect(self):
        self.assertEqual(ps.fit_size(200, 100, 100, 100), (100, 50))
        self.assertEqual(ps.fit_size(100, 200, 100, 100), (50, 100))
        self.assertEqual(ps.fit_size(50, 50, 100, 100), (100, 100))
        self.assertEqual(ps.fit_size(300, 520, 300, 520), (300, 520))
        self.assertEqual(ps.fit_size(0, 0, 10, 10), (1, 1))

    def test_pad_cell_anchors_at_the_bottom(self):
        img = Image.new('RGBA', (4, 4), (255, 0, 0, 255))
        cell = ps.pad_cell(img, 10, 10, 'bottom')
        self.assertEqual(cell.size, (10, 10))
        self.assertEqual(cell.getpixel((5, 8))[3], 255)
        self.assertEqual(cell.getpixel((5, 1))[3], 0)

    def test_mirror_tile_doubles_and_matches_edges(self):
        img = Image.new('RGBA', (6, 3), (0, 0, 0, 0))
        blob(img, (0, 0, 1, 2), (10, 20, 30, 255))
        out = ps.mirror_tile(img)
        self.assertEqual(out.size, (12, 3))
        self.assertEqual(out.getpixel((0, 1)), out.getpixel((11, 1)))


class TestLayout(unittest.TestCase):
    def test_cluster_rows_by_vertical_overlap(self):
        boxes = [(0, 0, 10, 10), (20, 2, 30, 12), (0, 40, 10, 50), (20, 42, 30, 52)]
        rows = ps.cluster_rows(boxes)
        self.assertEqual(len(rows), 2)
        self.assertEqual([len(r) for r in rows], [2, 2])
        self.assertEqual([b[0] for b in rows[0]], [0, 20])

    def test_cells_from_cuts(self):
        cells = ps.cells_from_cuts((10, 5, 90, 60), [10, 40, 90])
        self.assertEqual(cells, [(10, 5, 40, 60), (40, 5, 90, 60)])

    def test_cells_from_cuts_clamps_to_the_box(self):
        cells = ps.cells_from_cuts((10, 5, 50, 60), [0, 30, 99])
        self.assertEqual(cells, [(10, 5, 30, 60), (30, 5, 50, 60)])

    def test_hex_to_rgb(self):
        self.assertEqual(ps.hex_to_rgb('#00ff00'), (0, 255, 0))
        self.assertEqual(ps.hex_to_rgb('#AABBCC'), (170, 187, 204))
        with self.assertRaises(ps.SpriteError):
            ps.hex_to_rgb('verde')


class TestPipeline(unittest.TestCase):
    def test_size_warnings(self):
        target = {'w': 320, 'h': 200}
        self.assertEqual(ps.size_warnings('a', 320, 200, target), [])
        up = ps.size_warnings('a', 100, 64, target)
        self.assertEqual(len(up), 1)
        self.assertIn('3.2x', up[0])
        aspect = ps.size_warnings('a', 100, 300, target)
        self.assertTrue(any('proporzioni' in m for m in aspect))

    def test_size_warnings_use_the_post_mirror_width(self):
        img = Image.new('RGBA', (307, 64), (0, 0, 0, 0))
        blob(img, (0, 0, 306, 63))
        trimmed = ps.trim_alpha(img)
        target = {'w': 2048, 'h': 260}
        without = ps.warn_size_for('bg_beach_near', trimmed, target, False)
        with_mirror = ps.warn_size_for('bg_beach_near', trimmed, target, True)
        self.assertTrue(any('proporzioni' in m for m in without))
        self.assertFalse(any('proporzioni' in m for m in with_mirror), with_mirror)
        self.assertTrue(any('ingrandimento' in m for m in with_mirror), 'l\'ingrandimento resta')
        self.assertEqual(
            ps.warn_size_for('traffic_van', trimmed, target, True),
            ps.warn_size_for('traffic_van', trimmed, target, False),
            'la specchiatura riguarda solo i bg_*',
        )

    def test_process_sprite_isolates_and_fits(self):
        img = Image.new('RGBA', (60, 60), (0, 0, 0, 0))
        blob(img, (10, 10, 29, 19))
        blob(img, (55, 55, 57, 57))
        out = ps.process_sprite(img, 'traffic_van', {'w': 100, 'h': 100})
        self.assertEqual(out.size, (100, 50))

    def test_process_sprite_keeps_every_part_of_a_background(self):
        img = Image.new('RGBA', (60, 20), (0, 0, 0, 0))
        blob(img, (0, 10, 29, 19))
        blob(img, (40, 12, 59, 19))
        out = ps.process_sprite(img, 'bg_beach_far', {'w': 120, 'h': 40})
        self.assertEqual(out.size, (120, 20))
        self.assertGreater(out.getpixel((110, 15))[3], 0, 'la seconda isola non va buttata')

    def test_mirror_only_applies_to_backgrounds(self):
        img = Image.new('RGBA', (20, 10), (0, 0, 0, 0))
        blob(img, (0, 0, 9, 9))
        plain = ps.process_sprite(img, 'traffic_van', {'w': 40, 'h': 40}, mirror=True)
        mirrored = ps.process_sprite(img, 'bg_beach_far', {'w': 40, 'h': 40}, mirror=True)
        self.assertEqual(plain.size, (40, 40))
        self.assertEqual(mirrored.size, (40, 20))

    def test_process_sprite_on_empty_image_raises(self):
        with self.assertRaises(ps.SpriteError):
            ps.process_sprite(Image.new('RGBA', (10, 10), (0, 0, 0, 0)), 'x', {'w': 10, 'h': 10})

    def test_process_strip_makes_equal_cells(self):
        img = Image.new('RGBA', (34, 12), (0, 0, 0, 0))
        for i in range(3):
            blob(img, (i * 12 + 1, 1, i * 12 + 8, 6 + i))
        out = ps.process_strip(img, {'w': 20, 'h': 10, 'frames': 3})
        self.assertEqual(out.size, (60, 10))
        for i in range(3):
            self.assertIsNotNone(ps.alpha_bbox(out.crop((i * 20, 0, i * 20 + 20, 10))))


class TestManifestAndCli(unittest.TestCase):
    def setUp(self):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        (self.root / 'art' / 'raw').mkdir(parents=True)
        (self.root / 'public' / 'sprites').mkdir(parents=True)
        self.targets_path = self.root / 'targets.json'
        self.targets_path.write_text(
            '{"traffic_van": {"w": 60, "h": 40}, "player_strip_turn": {"w": 20, "h": 20, "frames": 3}}',
            encoding='utf-8',
        )

    def tearDown(self):
        self._tmp.cleanup()

    def test_write_manifest_sorts_merges_and_drops_missing(self):
        out = str(self.root / 'public' / 'sprites')
        (self.root / 'public' / 'sprites' / 'b.png').write_bytes(b'x')
        ps.write_manifest(out, {'b': {'file': 'b.png', 'w': 2, 'h': 2}})
        (self.root / 'public' / 'sprites' / 'a.png').write_bytes(b'x')
        kept = ps.write_manifest(out, {'a': {'file': 'a.png', 'w': 1, 'h': 1}})
        self.assertEqual(list(kept), ['a', 'b'])
        (self.root / 'public' / 'sprites' / 'b.png').unlink()
        kept = ps.write_manifest(out, {})
        self.assertEqual(list(kept), ['a'])
        text = (self.root / 'public' / 'sprites' / 'manifest.json').read_text(encoding='utf-8')
        self.assertTrue(text.endswith('\n'))

    def test_cli_processes_a_chroma_png_and_a_strip(self):
        single = Image.new('RGB', (80, 80), (0, 255, 0))
        blob(single, (20, 30, 59, 49), (200, 30, 40))
        single.save(self.root / 'art' / 'raw' / 'traffic_van.png')
        strip = Image.new('RGB', (90, 30), (0, 255, 0))
        for i in range(3):
            blob(strip, (i * 30 + 5, 5, i * 30 + 24, 24), (30, 40, 200))
        strip.save(self.root / 'art' / 'raw' / 'player_strip_turn.png')

        code = ps.main(
            [
                '--raw',
                str(self.root / 'art' / 'raw'),
                '--out',
                str(self.root / 'public' / 'sprites'),
                '--targets',
                str(self.targets_path),
                '--quiet',
            ]
        )
        self.assertEqual(code, 0)
        out_dir = self.root / 'public' / 'sprites'
        self.assertTrue((out_dir / 'traffic_van.png').exists())
        with Image.open(out_dir / 'traffic_van.png') as im:
            self.assertEqual(im.size, (60, 30))
        with Image.open(out_dir / 'player_strip_turn.png') as im:
            self.assertEqual(im.size, (60, 20))
        manifest = json.loads((out_dir / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['traffic_van'], {'file': 'traffic_van.png', 'w': 60, 'h': 30})
        self.assertEqual(manifest['player_strip_turn']['frames'], 3)

    def test_cli_ignores_files_without_a_target(self):
        img = Image.new('RGB', (20, 20), (0, 255, 0))
        blob(img, (5, 5, 14, 14), (10, 10, 10))
        img.save(self.root / 'art' / 'raw' / 'sconosciuto.png')
        # main() stampa sempre le righe WARN anche con --quiet: le catturiamo
        # per non sporcare lo stdout della suite di test.
        with contextlib.redirect_stdout(io.StringIO()):
            code = ps.main(
                [
                    '--raw',
                    str(self.root / 'art' / 'raw'),
                    '--out',
                    str(self.root / 'public' / 'sprites'),
                    '--targets',
                    str(self.targets_path),
                    '--quiet',
                ]
            )
        self.assertEqual(code, 0)
        self.assertFalse((self.root / 'public' / 'sprites' / 'sconosciuto.png').exists())

    def test_ending_files_keep_their_background(self):
        """Un ending_* a piena tela non deve perdere lo sfondo per il flood fill (Important 1)."""
        img = Image.new('RGB', (128, 48))
        sky = (135, 206, 235)
        ground = (34, 139, 34)
        px = img.load()
        for y in range(48):
            color = sky if y < 24 else ground
            for x in range(128):
                px[x, y] = color
        path = self.root / 'ending_1.png'
        img.save(path)
        target = {'w': 128, 'h': 48}
        out_dir = str(self.root / 'endout')
        entries, _warnings, _line = ps.process_raw_file(str(path), 'ending_1', target, out_dir, False)
        self.assertEqual((entries['ending_1']['w'], entries['ending_1']['h']), (128, 48))
        with Image.open(pathlib.Path(out_dir) / 'ending_1.png') as im:
            im = im.convert('RGBA')
            self.assertEqual(im.getpixel((5, 5))[3], 255, 'il cielo non va eroso')
            self.assertEqual(im.getpixel((5, 45))[3], 255, 'il terreno non va eroso')

    def test_ground_textures_keep_their_background(self):
        """ground_* e asphalt sono tessere piene: nessun pixel va eroso."""
        img = Image.new('RGB', (64, 64))
        px = img.load()
        for y in range(64):
            for x in range(64):
                px[x, y] = (227, 193, 120) if (x // 8 + y // 8) % 2 == 0 else (201, 164, 92)
        for stem in ('ground_beach', 'asphalt'):
            path = self.root / f'{stem}.png'
            img.save(path)
            out_dir = str(self.root / 'texout')
            entries, _warnings, _line = ps.process_raw_file(str(path), stem, {'w': 64, 'h': 64}, out_dir, False)
            self.assertEqual((entries[stem]['w'], entries[stem]['h']), (64, 64))
            with Image.open(pathlib.Path(out_dir) / f'{stem}.png') as im:
                im = im.convert('RGBA')
                for point in ((0, 0), (63, 0), (0, 63), (63, 63), (32, 32)):
                    self.assertEqual(im.getpixel(point)[3], 255, f'{stem} {point} non va eroso')

    def test_walls_are_full_bleed_but_lose_the_chroma(self):
        """wall_* perde il verde ma conserva tutte le sue parti separate."""
        img = Image.new('RGB', (64, 64), (0, 255, 0))
        blob(img, (2, 20, 20, 40), (120, 60, 40, 255))
        blob(img, (44, 20, 62, 40), (120, 60, 40, 255))
        path = self.root / 'wall_rock_red.png'
        img.save(path)
        out_dir = str(self.root / 'wallout')
        entries, _warnings, _line = ps.process_raw_file(str(path), 'wall_rock_red', {'w': 64, 'h': 64}, out_dir, False)
        self.assertIn('wall_rock_red', entries)
        with Image.open(pathlib.Path(out_dir) / 'wall_rock_red.png') as im:
            im = im.convert('RGBA')
            w, h = im.size
            left = im.getpixel((int(w * 0.1), h // 2))
            right = im.getpixel((int(w * 0.9), h // 2))
            self.assertEqual(left[3], 255, 'la parte sinistra deve restare')
            self.assertEqual(right[3], 255, 'la parte destra non va buttata via')

    def test_cli_only_filters_by_name(self):
        for stem in ('traffic_van',):
            img = Image.new('RGB', (40, 40), (0, 255, 0))
            blob(img, (5, 5, 34, 24), (10, 10, 10))
            img.save(self.root / 'art' / 'raw' / f'{stem}.png')
        code = ps.main(
            [
                '--raw',
                str(self.root / 'art' / 'raw'),
                '--out',
                str(self.root / 'public' / 'sprites'),
                '--targets',
                str(self.targets_path),
                '--only',
                'player_strip_turn',
                '--quiet',
            ]
        )
        self.assertEqual(code, 0)
        self.assertFalse((self.root / 'public' / 'sprites' / 'traffic_van.png').exists())

    def _main(self, *extra):
        with contextlib.redirect_stdout(io.StringIO()):
            return ps.main(
                [
                    '--raw',
                    str(self.root / 'art' / 'raw'),
                    '--out',
                    str(self.root / 'public' / 'sprites'),
                    '--targets',
                    str(self.targets_path),
                    '--quiet',
                    *extra,
                ]
            )

    def test_frame_group_shares_one_scale_and_one_height(self):
        self.targets_path.write_text(
            json.dumps({n: {'w': 100, 'h': 40, 'group': 'car'} for n in ('car_a', 'car_b', 'car_c')}),
            encoding='utf-8',
        )
        # Tre frame dello stesso oggetto: alto 40, basso 20, largo 60.
        for stem, box in (('car_a', (10, 10, 29, 49)), ('car_b', (10, 30, 29, 49)), ('car_c', (5, 20, 64, 49))):
            img = Image.new('RGBA', (80, 60), (0, 0, 0, 0))
            blob(img, box)
            img.save(self.root / 'art' / 'raw' / f'{stem}.png')
        self.assertEqual(self._main('--only', 'car_b'), 0)
        out_dir = self.root / 'public' / 'sprites'
        sizes = {}
        for stem in ('car_a', 'car_b', 'car_c'):
            with Image.open(out_dir / f'{stem}.png') as im:
                sizes[stem] = im.size
                if stem == 'car_b':
                    # Il frame basso è appoggiato in basso, sopra resta vuoto.
                    self.assertEqual(im.getpixel((5, 2))[3], 0)
                    self.assertEqual(im.getpixel((5, im.size[1] - 2))[3], 255)
        # Stessa altezza per tutti, e la stessa scala: 40 px sorgente -> 40.
        self.assertEqual({h for _w, h in sizes.values()}, {40})
        self.assertEqual(sizes['car_a'][0], 20)
        self.assertEqual(sizes['car_c'][0], 60)

    def test_frame_group_shrinks_all_frames_to_fit_the_widest(self):
        items = [
            ('a', blob(Image.new('RGBA', (80, 60), (0, 0, 0, 0)), (0, 0, 19, 39)), {'w': 30, 'h': 40, 'group': 'g'}),
            ('b', blob(Image.new('RGBA', (80, 60), (0, 0, 0, 0)), (0, 0, 59, 19)), {'w': 30, 'h': 40, 'group': 'g'}),
        ]
        out = dict(ps.process_frame_group(items))
        self.assertEqual(out['b'].size, (30, 20))
        self.assertEqual(out['a'].size, (10, 20))

    def test_trim_false_keeps_the_delivered_canvas(self):
        self.targets_path.write_text('{"bg_x_clouds": {"w": 40, "h": 20, "trim": false}}', encoding='utf-8')
        img = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(img, (10, 5, 29, 12))
        img.save(self.root / 'art' / 'raw' / 'bg_x_clouds.png')
        self.assertEqual(self._main(), 0)
        with Image.open(self.root / 'public' / 'sprites' / 'bg_x_clouds.png') as im:
            self.assertEqual(im.size, (40, 20))

    def test_trim_false_is_not_mirrored_either(self):
        self.targets_path.write_text('{"bg_x_clouds": {"w": 40, "h": 20, "trim": false}}', encoding='utf-8')
        img = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(img, (2, 5, 9, 12))
        img.save(self.root / 'art' / 'raw' / 'bg_x_clouds.png')
        self.assertEqual(self._main('--mirror'), 0)
        with Image.open(self.root / 'public' / 'sprites' / 'bg_x_clouds.png') as im:
            self.assertEqual(im.size, (40, 20))
            # Specchiata, la macchia comparirebbe anche a destra.
            self.assertEqual(ps.alpha_bbox(im), (2, 5, 10, 13))

    def test_trim_false_strip_keeps_every_cell_at_the_same_scale(self):
        self.targets_path.write_text('{"npc_bird": {"w": 30, "h": 20, "frames": 3, "trim": false}}', encoding='utf-8')
        img = Image.new('RGBA', (90, 20), (0, 0, 0, 0))
        blob(img, (5, 5, 14, 9))
        blob(img, (32, 2, 57, 17))
        blob(img, (70, 8, 79, 12))
        img.save(self.root / 'art' / 'raw' / 'npc_bird.png')
        self.assertEqual(self._main(), 0)
        out = self.root / 'public' / 'sprites' / 'npc_bird.png'
        with Image.open(out) as im:
            self.assertEqual(im.size, (90, 20))
            self.assertEqual(ps.alpha_bbox(im.crop((0, 0, 30, 20))), (5, 5, 15, 10))
        manifest = json.loads((self.root / 'public' / 'sprites' / 'manifest.json').read_text(encoding='utf-8'))
        self.assertEqual(manifest['npc_bird']['frames'], 3)

    def test_target_background_keep_leaves_an_opaque_tile_whole(self):
        self.targets_path.write_text('{"wall_x": {"w": 32, "h": 32, "background": "keep"}}', encoding='utf-8')
        img = Image.new('RGB', (32, 32), (120, 120, 120))
        blob(img, (8, 8, 23, 23), (60, 60, 60))
        img.save(self.root / 'art' / 'raw' / 'wall_x.png')
        self.assertEqual(self._main(), 0)
        with Image.open(self.root / 'public' / 'sprites' / 'wall_x.png') as im:
            self.assertEqual(im.size, (32, 32))
            self.assertEqual(im.getchannel('A').getextrema(), (255, 255))

    def test_a_single_file_wins_over_the_sheet_cell_with_the_same_name(self):
        self.targets_path.write_text('{"traffic_van": {"w": 60, "h": 40}}', encoding='utf-8')
        single = Image.new('RGBA', (60, 40), (0, 0, 0, 0))
        blob(single, (5, 5, 54, 34), (10, 200, 10, 255))
        single.save(self.root / 'art' / 'raw' / 'traffic_van.png')
        sheets = self.root / 'art' / 'raw' / 'sheets'
        sheets.mkdir()
        sheet = Image.new('RGBA', (40, 20), (0, 0, 0, 0))
        blob(sheet, (2, 2, 17, 17), (200, 10, 10, 255))
        sheet.save(sheets / 'old.png')
        (sheets / 'old.json').write_text(
            json.dumps({'background': 'keep', 'groups': [{'box': [0, 0, 40, 20], 'cuts': [0, 20], 'names': ['traffic_van']}]}),
            encoding='utf-8',
        )
        self.assertEqual(self._main(), 0)
        with Image.open(self.root / 'public' / 'sprites' / 'traffic_van.png') as im:
            self.assertEqual(im.size, (60, 36))
            self.assertEqual(im.getpixel((30, 18))[:3], (10, 200, 10))


TOOLS =pathlib.Path(__file__).resolve().parent


def synthetic_sheet(rows, blob_w=20, blob_h=20, gap=10, top=10, row_gap=30):
    """Foglio finto: `rows` è il numero di oggetti per riga."""
    width = 40 + max(rows) * (blob_w + gap)
    height = top + len(rows) * (blob_h + row_gap)
    img = Image.new('RGBA', (width, height), (0, 0, 0, 0))
    boxes = []
    for r, count in enumerate(rows):
        y = top + r * (blob_h + row_gap)
        for c in range(count):
            x = 20 + c * (blob_w + gap)
            blob(img, (x, y, x + blob_w - 1, y + blob_h - 1))
            boxes.append((x, y, x + blob_w - 1, y + blob_h - 1))
    return img, boxes


class TestSheets(unittest.TestCase):
    def setUp(self):
        import tempfile

        self._tmp = tempfile.TemporaryDirectory()
        self.root = pathlib.Path(self._tmp.name)
        self.out = self.root / 'out'
        self.out.mkdir()
        self.targets = {
            'alpha': {'w': 40, 'h': 40},
            'beta': {'w': 40, 'h': 40},
            'gamma': {'w': 40, 'h': 40},
        }

    def tearDown(self):
        self._tmp.cleanup()

    def test_groups_with_cuts_produce_one_file_per_name(self):
        sheet, _boxes = synthetic_sheet([3])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict(
            {
                'background': 'keep',
                'groups': [
                    {
                        'box': [0, 0, sheet.size[0], 40],
                        'cuts': [0, 45, 75, sheet.size[0]],
                        'names': ['alpha', 'beta', 'gamma'],
                    }
                ],
            },
            'memoria',
        )
        entries, warnings, lines, method = ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertEqual(method, 'alpha')
        self.assertEqual(sorted(entries), ['alpha', 'beta', 'gamma'])
        self.assertEqual(len(lines), 3)
        for name in entries:
            self.assertTrue((self.out / f'{name}.png').exists())
            with Image.open(self.out / f'{name}.png') as im:
                self.assertEqual(im.size, (40, 40))
        self.assertTrue(all('ingrandimento' in w for w in warnings))

    def test_skip_name_is_discarded(self):
        sheet, _boxes = synthetic_sheet([2])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict(
            {
                'background': 'keep',
                'groups': [
                    {'box': [0, 0, sheet.size[0], 40], 'cuts': [0, 45, sheet.size[0]], 'names': ['_skip', 'beta']}
                ],
            },
            'memoria',
        )
        entries, _w, _l, _m = ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertEqual(list(entries), ['beta'])
        self.assertFalse((self.out / '_skip.png').exists())

    def test_cuts_length_must_match_names(self):
        with self.assertRaises(ps.SpriteError) as ctx:
            ps.load_sheet_config_dict(
                {'groups': [{'box': [0, 0, 10, 10], 'cuts': [0, 5, 10], 'names': ['alpha']}]}, 'memoria'
            )
        self.assertIn('cuts', str(ctx.exception))
        self.assertIn('gruppo 0', str(ctx.exception))

    def test_auto_rows_mode_matches_components(self):
        sheet, _boxes = synthetic_sheet([2, 2])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict(
            {'background': 'keep', 'rows': [['alpha', 'beta'], ['gamma', '_skip']]}, 'memoria'
        )
        entries, _w, _l, _m = ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertEqual(sorted(entries), ['alpha', 'beta', 'gamma'])

    def test_auto_rows_mode_reports_the_mismatch_with_the_boxes(self):
        sheet, _boxes = synthetic_sheet([3])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict({'background': 'keep', 'rows': [['alpha', 'beta']]}, 'memoria')
        with self.assertRaises(ps.SpriteError) as ctx:
            ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        message = str(ctx.exception)
        self.assertIn('riga 0', message)
        self.assertIn('3 oggetti', message)
        self.assertIn('2 nomi', message)
        self.assertEqual(message.count(')-('), 3, 'il messaggio elenca i tre box trovati')
        self.assertEqual(sorted(f.name for f in self.out.iterdir()), [], 'nessun file scritto')

    def test_mid_sheet_failure_leaves_no_orphan_files(self):
        """Un fallimento a metà foglio non deve lasciare PNG orfani (Minor 3)."""
        sheet, _boxes = synthetic_sheet([3])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict(
            {
                'background': 'keep',
                'groups': [
                    {
                        'box': [0, 0, sheet.size[0], 40],
                        'cuts': [0, 45, 75, sheet.size[0]],
                        'names': ['alpha', 'beta', 'nome_sbagliato'],
                    }
                ],
            },
            'memoria',
        )
        with self.assertRaises(ps.SpriteError):
            ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertEqual(sorted(f.name for f in self.out.iterdir()), [], 'nessun PNG orfano dopo il fallimento')

    def test_auto_rows_mode_reports_a_row_count_mismatch(self):
        sheet, _boxes = synthetic_sheet([2, 2])
        path = self.root / 'sheet.png'
        sheet.save(path)
        cfg = ps.load_sheet_config_dict({'background': 'keep', 'rows': [['alpha', 'beta']]}, 'memoria')
        with self.assertRaises(ps.SpriteError) as ctx:
            ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertIn('2 righe', str(ctx.exception))
        self.assertEqual(sorted(f.name for f in self.out.iterdir()), [], 'nessun file scritto')

    def test_ignore_at_removes_an_object(self):
        sheet, boxes = synthetic_sheet([2])
        path = self.root / 'sheet.png'
        sheet.save(path)
        centre = ((boxes[1][0] + boxes[1][2]) // 2, (boxes[1][1] + boxes[1][3]) // 2)
        cfg = ps.load_sheet_config_dict(
            {'background': 'keep', 'ignoreAt': [list(centre)], 'rows': [['alpha']]}, 'memoria'
        )
        entries, _w, _l, _m = ps.process_sheet(str(path), cfg, self.targets, str(self.out))
        self.assertEqual(list(entries), ['alpha'])

    def test_background_mode_must_be_valid(self):
        with self.assertRaises(ps.SpriteError):
            ps.load_sheet_config_dict({'background': 'magia', 'rows': [['alpha']]}, 'memoria')

    def test_shipped_cars_italian_config_is_consistent(self):
        cfg = ps.load_sheet_config(str(TOOLS / 'sheets' / 'cars_italian.json'))
        targets = ps.load_targets(str(TOOLS / 'sprite-targets.json'))
        self.assertEqual([len(row) for row in cfg['rows']], [4, 4])
        wanted = [name for row in cfg['rows'] for name in row if name != ps.SKIP_NAME]
        self.assertEqual(wanted, ['traffic_coupe', 'traffic_offroad'])
        for name in wanted:
            self.assertIn(name, targets)
        self.assertEqual([row[0] for row in cfg['rows']], wanted, 'la vista da dietro è la prima di ogni riga')

    def test_shipped_sheet_config_is_consistent(self):
        cfg = ps.load_sheet_config(str(TOOLS / 'sheets' / 'sheet_clean.json'))
        targets = ps.load_targets(str(TOOLS / 'sprite-targets.json'))
        self.assertEqual(len(cfg['groups']), 11)
        names = [name for group in cfg['groups'] for name in group['names']]
        self.assertEqual(len(names), 63)
        self.assertEqual(len(set(names)) + names.count(ps.SKIP_NAME) - 1, 63)
        for group in cfg['groups']:
            for name in group['names']:
                if name == ps.SKIP_NAME:
                    continue
                target = ps.resolve_target(name, group, targets)
                self.assertGreater(target['w'], 0)
                self.assertEqual(sorted(target), ['h', 'w'], 'resolve_target non propaga frames')
        self.assertEqual(cfg['ignoreAt'], [[1230, 200]])


if __name__ == '__main__':
    unittest.main()
