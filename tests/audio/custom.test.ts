import { describe, expect, test, vi } from 'vitest';
import {
  CUSTOM_BASE,
  customTrackUrl,
  loadCustomManifest,
  MAX_CUSTOM_TRACKS,
  parseCustomManifest,
} from '../../src/audio/custom';

describe('parseCustomManifest', () => {
  test('keeps well formed entries', () => {
    expect(
      parseCustomManifest([
        { file: 'night_drive.mp3', title: 'Night Drive' },
        { file: 'coast.ogg', title: 'Coast' },
      ]),
    ).toEqual([
      { file: 'night_drive.mp3', title: 'Night Drive' },
      { file: 'coast.ogg', title: 'Coast' },
    ]);
  });

  test('anything that is not an array is no tracks at all', () => {
    for (const raw of [null, undefined, 42, 'x', { file: 'a.mp3' }]) {
      expect(parseCustomManifest(raw)).toEqual([]);
    }
  });

  test('drops an entry whose file would leave the folder', () => {
    const tracks = parseCustomManifest([
      { file: '../../etc/passwd', title: 'Nope' },
      { file: 'sub/dir.mp3', title: 'Nope' },
      { file: '/absolute.mp3', title: 'Nope' },
      { file: 'https://example.com/x.mp3', title: 'Nope' },
      { file: '//example.com/x.mp3', title: 'Nope' },
      { file: 'ok.mp3', title: 'Ok' },
    ]);
    expect(tracks).toEqual([{ file: 'ok.mp3', title: 'Ok' }]);
  });

  test('drops an entry with a missing or empty field', () => {
    expect(
      parseCustomManifest([
        { file: 'a.mp3' },
        { title: 'B' },
        { file: '', title: 'C' },
        { file: 'd.mp3', title: '   ' },
        { file: 'e.mp3', title: 42 },
      ]),
    ).toEqual([]);
  });

  test('refuses a file with no audio extension', () => {
    expect(parseCustomManifest([{ file: 'notes.txt', title: 'Notes' }])).toEqual([]);
    expect(parseCustomManifest([{ file: 'song.MP3', title: 'Song' }])).toHaveLength(1);
  });

  test('caps the list, so a folder with a thousand files cannot fill the screen', () => {
    const many = Array.from({ length: MAX_CUSTOM_TRACKS + 50 }, (_, i) => ({
      file: `${i}.mp3`,
      title: `T${i}`,
    }));
    expect(parseCustomManifest(many)).toHaveLength(MAX_CUSTOM_TRACKS);
  });

  test('trims the title but keeps the file name exact', () => {
    expect(parseCustomManifest([{ file: 'a.mp3', title: '  Spaced  ' }])).toEqual([
      { file: 'a.mp3', title: 'Spaced' },
    ]);
  });
});

describe('customTrackUrl', () => {
  test('joins the base and a plain file name', () => {
    expect(customTrackUrl(CUSTOM_BASE, 'night_drive.mp3')).toBe('/music/custom/night_drive.mp3');
  });

  test('encodes the characters that would break the URL', () => {
    expect(customTrackUrl(CUSTOM_BASE, 'my song #1.mp3')).toBe('/music/custom/my%20song%20%231.mp3');
  });

  test('null for anything that is not a plain file name', () => {
    for (const bad of ['../x.mp3', 'a/b.mp3', '/x.mp3', 'https://e.com/x.mp3', '', '.', '..']) {
      expect(customTrackUrl(CUSTOM_BASE, bad), bad).toBeNull();
    }
  });
});

describe('loadCustomManifest', () => {
  test('returns the tracks of a good manifest', async () => {
    const tracks = await loadCustomManifest({
      fetchJson: () => Promise.resolve([{ file: 'a.mp3', title: 'A' }]),
      log: () => {},
    });
    expect(tracks).toEqual([{ file: 'a.mp3', title: 'A' }]);
  });

  test('a missing manifest is no tracks, not a rejection', async () => {
    const log = vi.fn();
    await expect(
      loadCustomManifest({ fetchJson: () => Promise.reject(new Error('HTTP 404')), log }),
    ).resolves.toEqual([]);
    expect(log).toHaveBeenCalled();
  });

  test('a fetch that throws synchronously is no tracks either', async () => {
    await expect(
      loadCustomManifest({
        fetchJson: () => {
          throw new TypeError('Failed to parse URL');
        },
        log: () => {},
      }),
    ).resolves.toEqual([]);
  });
});
