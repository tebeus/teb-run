"""Test delle funzioni pure di tools/process-audio.py.

Esecuzione: python3 -m unittest discover -s tools -p 'test_*.py'
"""

import array
import importlib.util
import math
import pathlib
import sys
import unittest

_SPEC = importlib.util.spec_from_file_location(
    'process_audio', pathlib.Path(__file__).resolve().with_name('process-audio.py')
)
assert _SPEC is not None and _SPEC.loader is not None
pa = importlib.util.module_from_spec(_SPEC)
# Il tool usa @dataclass: da Python 3.12 dataclasses risale a
# sys.modules[cls.__module__], quindi il modulo va registrato prima di eseguirlo,
# altrimenti @dataclass(frozen=True) muore con
# "AttributeError: 'NoneType' object has no attribute '__dict__'".
sys.modules['process_audio'] = pa
_SPEC.loader.exec_module(pa)


class TestGain(unittest.TestCase):
    def test_db_to_linear(self):
        self.assertAlmostEqual(pa.db_to_linear(0.0), 1.0)
        self.assertAlmostEqual(pa.db_to_linear(-6.0206), 0.5, places=4)
        self.assertAlmostEqual(pa.db_to_linear(-3.0), 0.70794578, places=6)

    def test_peak_amplitude(self):
        self.assertAlmostEqual(pa.peak_amplitude([0.0, 0.2, -0.5, 0.1]), 0.5)
        self.assertEqual(pa.peak_amplitude([]), 0.0)
        self.assertEqual(pa.peak_amplitude([0.0, 0.0]), 0.0)

    def test_normalize_brings_the_peak_to_the_target(self):
        out = pa.normalize([0.0, 0.1, -0.05], pa.TARGET_PEAK_DBFS)
        self.assertAlmostEqual(pa.peak_amplitude(out), pa.db_to_linear(pa.TARGET_PEAK_DBFS), places=6)

    def test_normalize_leaves_silence_alone(self):
        # Un file muto non si moltiplica per infinito.
        self.assertEqual(list(pa.normalize([0.0, 0.0], -3.0)), [0.0, 0.0])

    def test_normalize_attenuates_a_hot_file(self):
        out = pa.normalize([1.0, -1.0], -3.0)
        self.assertLess(pa.peak_amplitude(out), 1.0)


class TestCrossfadeLoop(unittest.TestCase):
    def test_shortens_by_the_fade_and_matches_head_to_tail(self):
        rate = 1000
        samples = [math.sin(i / 50.0) for i in range(rate)]
        out = pa.crossfade_loop(samples, rate, 0.1)  # 100 campioni di fade
        self.assertEqual(len(out), rate - 100)
        # La coda del risultato è stata mescolata con la testa: il salto fra
        # ultimo e primo campione non è più grande del passo tipico.
        step = max(abs(out[i + 1] - out[i]) for i in range(len(out) - 1))
        self.assertLessEqual(abs(out[0] - out[-1]), step * 3)

    def test_zero_fade_is_the_identity(self):
        samples = [0.1, 0.2, 0.3]
        self.assertEqual(list(pa.crossfade_loop(samples, 1000, 0.0)), samples)

    def test_fade_longer_than_the_file_is_refused(self):
        with self.assertRaises(pa.AudioError):
            pa.crossfade_loop([0.1, 0.2], 1000, 10.0)


class TestMusicManifest(unittest.TestCase):
    def test_title_from_filename(self):
        self.assertEqual(pa.title_from_filename('night_drive.mp3'), 'Night Drive')
        self.assertEqual(pa.title_from_filename('03 - Neon-Coast.ogg'), '03 Neon Coast')
        self.assertEqual(pa.title_from_filename('  spaced   out .flac'), 'Spaced Out')

    def test_music_manifest_sorts_and_keeps_only_audio(self):
        entries = pa.music_manifest(['b.mp3', 'a.ogg', 'readme.txt', 'manifest.json'])
        self.assertEqual([e['file'] for e in entries], ['a.ogg', 'b.mp3'])
        self.assertEqual([e['title'] for e in entries], ['A', 'B'])

    def test_music_manifest_refuses_a_name_with_a_separator(self):
        # Non dovrebbe capitare (i nomi vengono da os.listdir) ma il manifest
        # finisce in una fetch: meglio non scriverci mai un percorso.
        entries = pa.music_manifest(['ok.mp3', '../evil.mp3', 'sub/dir.mp3'])
        self.assertEqual([e['file'] for e in entries], ['ok.mp3'])

    def test_music_manifest_caps_the_list(self):
        many = [f'{i:03d}.mp3' for i in range(pa.MAX_CUSTOM_TRACKS + 10)]
        self.assertEqual(len(pa.music_manifest(many)), pa.MAX_CUSTOM_TRACKS)


class TestWavRoundTrip(unittest.TestCase):
    def test_read_and_write_keep_the_signal(self):
        import tempfile

        rate = 8000
        samples = [math.sin(2 * math.pi * 220 * i / rate) * 0.5 for i in range(rate)]
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / 'tone.wav'
            pa.write_wav(path, samples, rate)
            back, back_rate = pa.read_wav(path)
        self.assertEqual(back_rate, rate)
        self.assertEqual(len(back), len(samples))
        # 16 bit: l'errore di quantizzazione sta sotto 1/32768 per campione.
        self.assertLess(max(abs(a - b) for a, b in zip(samples, back)), 1e-4)

    def test_read_wav_refuses_a_missing_file(self):
        with self.assertRaises(pa.AudioError):
            pa.read_wav(pathlib.Path('/nonexistent/none.wav'))


class TestSourceTable(unittest.TestCase):
    def test_every_source_has_a_logical_name_and_exists_in_the_table(self):
        names = [s.out for s in pa.SOURCES]
        self.assertIn('engine_low', names)
        self.assertIn('engine_high', names)
        # Nessun campione di batteria: la batteria e' sintetizzata in codice.
        self.assertFalse([n for n in names if n.startswith('drums/')])
        self.assertEqual(len(names), len(set(names)))

    def test_only_the_engine_loops_get_a_crossfade(self):
        for source in pa.SOURCES:
            expected = source.out.startswith('engine_')
            self.assertEqual(source.loop_crossfade > 0, expected, source.out)


if __name__ == '__main__':
    unittest.main()
