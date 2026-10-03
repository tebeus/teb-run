#!/usr/bin/env python3
"""Prepara i campioni audio CC0 di TEB RUN.

Normalizza a -3 dBFS di picco i WAV di art/audio-raw/, dà ai due loop del
motore un crossfade fra coda e testa perché il punto di loop non si senta, e
scrive public/audio/ più il manifest che audio/samples.ts legge.

Serve solo Python 3. Se `ffmpeg` è nel PATH scrive OGG Vorbis (qualità 6),
altrimenti WAV a 16 bit, e il manifest riporta i nomi che ha scritto davvero.

    python3 tools/process-audio.py            # campioni del gioco
    python3 tools/process-audio.py --music     # manifest dei brani personali
"""

from __future__ import annotations

import argparse
import array
import json
import math
import os
import pathlib
import shutil
import subprocess
import sys
import wave
from dataclasses import dataclass

# numpy non serve: nove file da meno di cinque secondi si normalizzano in
# Python puro in pochi millisecondi, e così il tool gira dove gira Python.
try:  # opzionale, solo per velocità su file grandi
    import numpy as _np  # type: ignore
except Exception:  # pragma: no cover - dipende dall'ambiente
    _np = None


class AudioError(Exception):
    """Errore di lavorazione con un messaggio leggibile per l'utente."""


# Spec §13a: picco a -3 dBFS, non a 0, per lasciare spazio al mix.
TARGET_PEAK_DBFS = -3.0
# Crossfade del punto di loop dei due file del motore (REPORT.md consiglia
# 50-100 ms: il materiale è rumore a banda larga, non un ciclo periodico).
ENGINE_LOOP_CROSSFADE = 0.08
# Qualità di ffmpeg per il Vorbis: 6 su 10, circa 160 kbps.
OGG_QUALITY = '6'
# Quanti brani personali entrano nel manifest (spec §13a, task 9).
MAX_CUSTOM_TRACKS = 32
MUSIC_EXTENSIONS = ('.mp3', '.ogg', '.oga', '.m4a', '.wav', '.flac')


@dataclass(frozen=True)
class Source:
    """Un file di art/audio-raw/ e il nome logico con cui il gioco lo chiede."""

    src: str
    out: str
    loop_crossfade: float = 0.0


# La batteria e' sintetizzata in codice (src/audio/synth.ts, SYNTH_DRUM_VOICES):
# i campioni del pacchetto eJay sono stati tolti perche' la loro licenza ne
# vieta la ridistribuzione dentro un software o su un sito.
SOURCES: tuple[Source, ...] = (
    Source('engine/engine_low_idle_loop.wav', 'engine_low', ENGINE_LOOP_CROSSFADE),
    Source('engine/engine_high_speed_loop.wav', 'engine_high', ENGINE_LOOP_CROSSFADE),
)


# ---------------------------------------------------------------------------
# Funzioni pure
# ---------------------------------------------------------------------------


def db_to_linear(db: float) -> float:
    return 10.0 ** (db / 20.0)


def peak_amplitude(samples) -> float:
    peak = 0.0
    for value in samples:
        magnitude = abs(value)
        if magnitude > peak:
            peak = magnitude
    return peak


def normalize(samples, target_dbfs: float = TARGET_PEAK_DBFS):
    """Riscala perché il picco stia esattamente a `target_dbfs`.

    Un file muto resta muto: moltiplicarlo non lo rende più forte, e il
    rapporto sarebbe una divisione per zero.
    """
    peak = peak_amplitude(samples)
    if peak <= 0.0:
        return list(samples)
    gain = db_to_linear(target_dbfs) / peak
    return [value * gain for value in samples]


def crossfade_loop(samples, rate: int, seconds: float):
    """Mescola la coda nella testa e accorcia il file di `seconds`.

    Il risultato, riprodotto in loop, non ha discontinuità al punto di
    giunzione: l'ultimo campione e il primo appartengono alla stessa
    dissolvenza. `seconds` a zero non tocca niente.
    """
    data = list(samples)
    fade = int(round(seconds * rate))
    if fade <= 0:
        return data
    if fade * 2 >= len(data):
        raise AudioError(
            f'crossfade di {seconds}s ({fade} campioni) troppo lungo per {len(data)} campioni'
        )
    body = data[: len(data) - fade]
    tail = data[len(data) - fade :]
    for i in range(fade):
        # Rampa lineare: il peso della coda scende da 1 a 0 mentre quello
        # della testa sale. Alla giunzione i due pesi si scambiano, quindi
        # non c'è salto.
        w = (i + 1) / (fade + 1)
        body[i] = body[i] * w + tail[i] * (1.0 - w)
    return body


def title_from_filename(name: str) -> str:
    """Titolo leggibile dal nome del file: niente estensione, niente separatori."""
    stem = os.path.splitext(name)[0]
    words = stem.replace('_', ' ').replace('-', ' ').split()
    return ' '.join(word[:1].upper() + word[1:] for word in words)


def is_plain_name(name: str) -> bool:
    """Vero solo per un nome di file semplice: nessun percorso, nessun `..`."""
    return name not in ('', '.', '..') and '/' not in name and '\\' not in name


def music_manifest(names) -> list[dict]:
    """Voci del manifest dei brani personali, ordinate per nome di file."""
    entries: list[dict] = []
    for name in sorted(names):
        if not is_plain_name(name):
            continue
        if not name.lower().endswith(MUSIC_EXTENSIONS):
            continue
        entries.append({'file': name, 'title': title_from_filename(name)})
        if len(entries) >= MAX_CUSTOM_TRACKS:
            break
    return entries


# ---------------------------------------------------------------------------
# Lettura e scrittura WAV
# ---------------------------------------------------------------------------


def read_wav(path: pathlib.Path) -> tuple[list[float], int]:
    """WAV PCM 16 bit → campioni float in -1..1, mono (i canali si mediano)."""
    try:
        with wave.open(str(path), 'rb') as handle:
            channels = handle.getnchannels()
            width = handle.getsampwidth()
            rate = handle.getframerate()
            raw = handle.readframes(handle.getnframes())
    except (OSError, wave.Error) as exc:
        raise AudioError(f'{path}: non è un WAV leggibile ({exc})') from exc
    if width != 2:
        raise AudioError(f'{path}: {width * 8} bit per campione, ne servono 16')
    values = array.array('h')
    values.frombytes(raw)
    if sys.byteorder == 'big':  # pragma: no cover - il WAV è little endian
        values.byteswap()
    if channels == 1:
        return [value / 32768.0 for value in values], rate
    mono: list[float] = []
    for i in range(0, len(values) - channels + 1, channels):
        mono.append(sum(values[i : i + channels]) / (channels * 32768.0))
    return mono, rate


def write_wav(path: pathlib.Path, samples, rate: int) -> None:
    """Campioni float in -1..1 → WAV PCM 16 bit mono, con clamp."""
    values = array.array('h')
    for value in samples:
        clamped = -1.0 if value < -1.0 else (1.0 if value > 1.0 else value)
        values.append(int(round(clamped * 32767.0)))
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(values.tobytes())


def have_ffmpeg() -> bool:
    return shutil.which('ffmpeg') is not None


def encode_ogg(wav_path: pathlib.Path, ogg_path: pathlib.Path) -> None:
    ogg_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
        '-i', str(wav_path), '-c:a', 'libvorbis', '-q:a', OGG_QUALITY, str(ogg_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise AudioError(f'ffmpeg su {wav_path.name}: {result.stderr.strip()}')


# ---------------------------------------------------------------------------
# Comandi
# ---------------------------------------------------------------------------


def process_samples(raw_dir: pathlib.Path, out_dir: pathlib.Path, quiet: bool) -> int:
    """Lavora SOURCES e scrive il manifest. Ritorna il numero di errori."""
    manifest: dict[str, str] = {}
    failures = 0
    use_ogg = have_ffmpeg()
    if not use_ogg and not quiet:
        print('ffmpeg non trovato: scrivo WAV invece di OGG')
    for source in SOURCES:
        src_path = raw_dir / source.src
        try:
            samples, rate = read_wav(src_path)
            samples = crossfade_loop(samples, rate, source.loop_crossfade)
            samples = normalize(samples)
            wav_path = out_dir / f'{source.out}.wav'
            write_wav(wav_path, samples, rate)
            if use_ogg:
                ogg_path = out_dir / f'{source.out}.ogg'
                encode_ogg(wav_path, ogg_path)
                wav_path.unlink()
                manifest[source.out] = f'{source.out}.ogg'
            else:
                manifest[source.out] = f'{source.out}.wav'
            if not quiet:
                seconds = len(samples) / rate
                print(f'OK   {source.out}: {seconds:.2f}s a {rate} Hz, picco {TARGET_PEAK_DBFS} dBFS')
        except AudioError as exc:
            print(f'ERR  {source.out}: {exc}', file=sys.stderr)
            failures += 1
    manifest_path = out_dir / 'manifest.json'
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + '\n', encoding='utf8')
    if not quiet:
        print(f'manifest: {manifest_path} ({len(manifest)} voci)')
    return failures


def process_music(music_dir: pathlib.Path, quiet: bool) -> int:
    """Elenca i brani personali. La cartella assente non è un errore."""
    if not music_dir.is_dir():
        if not quiet:
            print(f'{music_dir} non esiste: nessun brano personale')
        return 0
    entries = music_manifest(os.listdir(music_dir))
    path = music_dir / 'manifest.json'
    path.write_text(json.dumps(entries, indent=2) + '\n', encoding='utf8')
    if not quiet:
        for entry in entries:
            print(f'OK   {entry["file"]} -> {entry["title"]}')
        print(f'manifest: {path} ({len(entries)} brani)')
    return 0


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--raw', default='art/audio-raw', help='cartella delle sorgenti CC0')
    parser.add_argument('--out', default='public/audio', help='cartella di destinazione')
    parser.add_argument('--music', action='store_true', help='rigenera il manifest dei brani personali')
    parser.add_argument('--music-dir', default='public/music/custom', help='cartella dei brani personali')
    parser.add_argument('--quiet', action='store_true', help='stampa solo gli errori')
    return parser


def main(argv=None) -> int:
    args = build_arg_parser().parse_args(argv)
    if args.music:
        return process_music(pathlib.Path(args.music_dir), args.quiet)
    failures = process_samples(pathlib.Path(args.raw), pathlib.Path(args.out), args.quiet)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
