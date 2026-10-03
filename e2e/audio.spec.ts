// Verifica d'ascolto nel browser vero (spec §16). Non dice se un suono è
// bello: dice che c'è, che non è distorto e che il motore ha l'energia dove
// deve averla. Lo spettro di ogni campione finisce in e2e/out/ come PNG, da
// guardare quando un numero cambia e non si capisce perché.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { AudioSampleKind } from '../src/audio/offline';
import type { AudioSampleReport } from '../src/audio/analysis';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'out');

/** Sblocca l'audio con un tasto vero e aspetta che il bus sia in esecuzione. */
async function unlockAudio(page: Page): Promise<void> {
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun !== undefined);
  await page.keyboard.press('KeyM'); // muto: il gesto sblocca, il silenzio non disturba
  await page.keyboard.press('KeyM');
  await page.waitForFunction(() => window.__tebrun?.audio.available === true);
}

async function render(page: Page, kind: AudioSampleKind, seconds: number): Promise<AudioSampleReport> {
  const report = await page.evaluate(
    async ([k, s]) => {
      const hook = window.__tebrun?.renderAudioSample;
      if (hook === undefined) return null;
      return hook(k as AudioSampleKind, s as number);
    },
    [kind, seconds] as const,
  );
  expect(report, `nessun rapporto per ${kind}`).not.toBeNull();
  return report as AudioSampleReport;
}

/** Disegna i bin in un PNG, per poterli guardare. */
async function saveSpectrum(page: Page, kind: string, report: AudioSampleReport): Promise<void> {
  const dataUrl = await page.evaluate((bins) => {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return '';
    ctx.fillStyle = '#101018';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const top = Math.max(...bins, 1e-9);
    const width = canvas.width / bins.length;
    ctx.fillStyle = '#ffee55';
    bins.forEach((value, i) => {
      // Scala in decibel: lineare, i bassi schiaccerebbero tutto il resto.
      const db = 20 * Math.log10(Math.max(value, 1e-9) / top);
      const height = Math.max(1, ((db + 90) / 90) * canvas.height);
      ctx.fillRect(i * width, canvas.height - height, Math.max(1, width - 1), height);
    });
    return canvas.toDataURL('image/png');
  }, report.bins);
  if (dataUrl === '') return;
  mkdirSync(OUT_DIR, { recursive: true });
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  writeFileSync(join(OUT_DIR, `spectrum-${kind}.png`), Buffer.from(base64, 'base64'));
}

test.describe('verifica d\'ascolto', () => {
  test('il motore suona a tre velocità, non satura e ha i bassi', async ({ page }) => {
    await unlockAudio(page);
    const rates: { kind: AudioSampleKind; report: AudioSampleReport }[] = [];
    for (const kind of ['engine-idle', 'engine-mid', 'engine-full'] as const) {
      const report = await render(page, kind, 2);
      await saveSpectrum(page, kind, report);
      // C'è del suono: un motore muto è il difetto che questo test esiste per
      // trovare. Misurato con SAMPLED_ENGINE_MAX_LEVEL dopo la correzione I1
      // della revisione finale (−11 dBFS, non più −6): 0,046 al minimo,
      // 0,047 a metà, 0,095 a tutto gas.
      expect(report.rms, `${kind} rms`).toBeGreaterThan(0.03);
      // E non è distorto.
      expect(report.clipped, `${kind} campioni a fondo scala`).toBe(0);
      expect(report.peak, `${kind} picco`).toBeLessThan(0.9);
      rates.push({ kind, report });
    }
    const byKind = new Map(rates.map((r) => [r.kind, r.report]));
    const idle = byKind.get('engine-idle')!;
    const mid = byKind.get('engine-mid')!;
    const full = byKind.get('engine-full')!;

    // A tutto gas il picco deve stare intorno a SAMPLED_ENGINE_PEAK_DBFS
    // (−11 dBFS, cioè 0,282): misurato 0,274. Il valore precedente (−6 dBFS)
    // lasciava il motore 5-6 dB sopra la musica in RMS (Important 2 della
    // revisione finale): con −11 l'RMS a tutto gas (0,095) sta dentro
    // 0,8×-1,2× l'RMS dei tre brani (0,087-0,096).
    expect(full.peak, 'picco a tutto gas').toBeGreaterThan(0.2);
    expect(full.peak, 'picco a tutto gas').toBeLessThan(0.4);

    // È un rombo al minimo e a metà gas. A tutto gas **no**, e non è un
    // difetto: il playbackRate arriva a 2,4 e comprende l'innalzamento di +7
    // semitoni, quindi la fondamentale esce dalla banda sotto i 200 Hz.
    // Misurato: 0,984 al minimo, 0,968 a metà, 0,030 a tutto gas. Quindi si
    // confronta, invece di fissare una soglia che a tutto gas sarebbe falsa.
    expect(idle.lowRatio, 'energia bassa al minimo').toBeGreaterThan(0.5);
    expect(mid.lowRatio, 'energia bassa a metà gas').toBeGreaterThan(0.5);
    expect(idle.lowRatio, 'il minimo è più grave del pieno regime').toBeGreaterThan(
      full.lowRatio * 3,
    );

    // Più si va veloci, più il motore è forte. Fra minimo e metà gas la
    // differenza **non** si misura (0,046 contro 0,047): il volume sale, ma il
    // loop di velocità costante ha meno energia in banda del loop del minimo,
    // e le due cose si annullano. Fra metà gas e tutto gas si vede bene.
    expect(full.rms, 'a tutto gas più forte che al minimo').toBeGreaterThan(idle.rms * 1.5);
    expect(full.rms, 'a tutto gas più forte che a metà gas').toBeGreaterThan(mid.rms * 1.5);
  });

  test('i tre brani suonano, non saturano e usano tutta la banda', async ({ page }) => {
    await unlockAudio(page);
    for (const kind of ['song-0', 'song-1', 'song-2'] as const) {
      // Quattro battute: 7,9 s a 122 bpm, 10,4 s a 92, 7,0 s a 138. Dodici
      // secondi coprono il più lento con margine per la coda del riverbero.
      const report = await render(page, kind, 12);
      await saveSpectrum(page, kind, report);
      expect(report.rms, `${kind} rms`).toBeGreaterThan(0.01);
      // Senza l'attenuazione e il limitatore del task 7 questa riga è rossa:
      // misurato, *Mirrorball Mile* dava 1,0076 di picco e due campioni a
      // fondo scala (quattro alla seconda esecuzione, perché il rumore del
      // riverbero cambia). Con MUSIC_TRIM il picco sta intorno a 0,61.
      expect(report.clipped, `${kind} campioni a fondo scala`).toBe(0);
      expect(report.peak, `${kind} picco`).toBeLessThan(0.99);
      // `lowRatio` non è un'energia di banda, è un indice su un pettine di
      // sonde (vedi analysis.ts): su un brano tonale sta alto anche quando il
      // mix è pieno, e misurato dà 0,97 / 0,88 / 0,98. Serve solo a scoprire
      // un brano muto, non a giudicare l'equilibrio del mix: quindi una sola
      // soglia, in basso.
      expect(report.lowRatio, `${kind} energia bassa`).toBeGreaterThan(0.05);
    }
  });

  test('senza #debug il gancio non esiste', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Enter');
    expect(await page.evaluate(() => window.__tebrun)).toBeUndefined();
  });
});
