// Il manifest e i PNG stanno nel repository (binario G, task 1): questo test
// legge `public/sprites` dal disco, non un finto, così un file dimenticato in
// un commit si vede subito invece che in una galleria magenta.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { PROCEDURAL_ONLY, SPRITE_NAMES, STRIPS } from '../../src/art/catalog';
import { manifestWarnings, parseManifest, pickSource, STAGE_BG_NAMES, type Manifest } from '../../src/core/assets';
import { NO_ART } from '../helpers/art';

const SPRITES_DIR = fileURLToPath(new URL('../../public/sprites/', import.meta.url));
const MANIFEST_PATH = join(SPRITES_DIR, 'manifest.json');

const readManifest = (): Manifest => parseManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
const pngFiles = (): string[] => readdirSync(SPRITES_DIR).filter((name) => name.endsWith('.png')).sort();

/** I nomi del catalogo che devono avere un PNG: tutti tranne i soli procedurali. */
const pngNames = (): string[] => SPRITE_NAMES.filter((name) => !PROCEDURAL_ONLY.has(name));

describe.skipIf(NO_ART)('public/sprites nel repository', () => {
  test('the manifest exists and parses', () => {
    expect(existsSync(MANIFEST_PATH), MANIFEST_PATH).toBe(true);
    expect(Object.keys(readManifest()).length).toBeGreaterThan(0);
  });

  test('every manifest entry points at a file that is really there and is not empty', () => {
    const manifest = readManifest();
    for (const [name, entry] of Object.entries(manifest)) {
      const path = join(SPRITES_DIR, entry.file);
      expect(existsSync(path), `${name} -> ${entry.file}`).toBe(true);
      expect(statSync(path).size, `${name} -> ${entry.file}`).toBeGreaterThan(0);
      expect(entry.w, name).toBeGreaterThan(0);
      expect(entry.h, name).toBeGreaterThan(0);
    }
  });

  test('every strip in the manifest declares exactly the frames the catalog expects', () => {
    const manifest = readManifest();
    for (const [file, names] of Object.entries(STRIPS)) {
      const entry = manifest[file];
      if (entry === undefined) {
        // La strip è stata consegnata come singoli file (il caso attuale):
        // non c'è una voce "file" da controllare, ma ogni frame elencato
        // deve comunque avere una voce propria nel manifest, o questo test
        // non verifica niente per l'intera consegna a singoli file.
        for (const name of names) {
          expect(manifest[name], `${file} -> ${name} (consegnato come file singolo)`).toBeDefined();
        }
        continue;
      }
      expect(entry.frames, `${file} frames`).toBe(names.length);
      // una strip larga meno di un pixel per frame non si può tagliare
      expect(entry.w, `${file} width`).toBeGreaterThanOrEqual(names.length);
    }
  });

  test('the manifest raises no warnings against the catalog and sprite-targets', () => {
    expect(manifestWarnings(readManifest())).toEqual([]);
  });

  test('every catalog name that is not procedural-only resolves to a PNG', () => {
    const manifest = readManifest();
    const procedural = new Set<string>();
    const missing: string[] = [];
    for (const name of pngNames()) {
      const source = pickSource(name, manifest, procedural);
      if (source.kind !== 'png') missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  test('the procedural-only names have no PNG, so nobody generated one by mistake', () => {
    const manifest = readManifest();
    for (const name of PROCEDURAL_ONLY) {
      expect(manifest[name], name).toBeUndefined();
    }
  });

  test('there are no orphan PNG files: every file on disk is in the manifest', () => {
    const manifest = readManifest();
    const referenced = new Set(Object.values(manifest).map((entry) => entry.file));
    const orphans = pngFiles().filter((file) => !referenced.has(file));
    expect(orphans).toEqual([]);
  });

  test('the counts match: one PNG per name that needs one, one file per strip', () => {
    // Una strip e' un solo PNG che copre piu' nomi di catalogo
    // (`npc_seagull` da' `npc_seagull_0..2`): i nomi in piu' non hanno un
    // file proprio, quindi non entrano nel conto dei file.
    const manifest = readManifest();
    const extraStripFrames = Object.entries(STRIPS)
      .filter(([file]) => manifest[file] !== undefined)
      .reduce((sum, [, names]) => sum + names.length - 1, 0);
    // Più gli sfondi facoltativi di tappa (`bg_<id>_far`, consegna v2): un
    // PNG e una voce ciascuno, fuori dal catalogo di proposito.
    const stageBgs = STAGE_BG_NAMES.filter((name) => manifest[name] !== undefined).length;
    expect(stageBgs).toBe(10);
    expect(pngFiles()).toHaveLength(pngNames().length - extraStripFrames + stageBgs);
    expect(Object.keys(manifest)).toHaveLength(pngNames().length - extraStripFrames + stageBgs);
  });
});
