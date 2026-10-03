// Fumo end to end del gioco vero, contro `npm run dev` (vedi
// playwright.config.ts). Niente finti: il browser carica gli sprite dal
// manifest, l'audio resta bloccato finché non arriva un tasto, e la strada
// del titolo è quella del motore.

import { expect, test, type Page } from '@playwright/test';
import { PROCEDURAL_ONLY, SPRITE_NAMES } from '../src/art/catalog';

// Conteggi derivati dal catalogo, non scritti a mano: il Set 2 del binario H
// e i Set 5-6 del binario I fanno crescere questi numeri, e un test che li
// fissa a mano diventa falso a ogni consegna di grafica. La regola vera è:
// ogni nome del catalogo che non sia solo procedurale arriva da un PNG, e
// niente manca.
const PROCEDURAL_COUNT = PROCEDURAL_ONLY.size;
const PNG_COUNT = SPRITE_NAMES.filter((name) => !PROCEDURAL_ONLY.has(name)).length;
const SPRITE_COUNT = SPRITE_NAMES.length;

/** Riquadro in coordinate del canvas logico 1280x720. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Banda di "PRESS ENTER": 11 caratteri 8x8 a scala 3, centrati, y 420. */
const PRESS_ENTER: Rect = { x: 506, y: 418, w: 268, h: 28 };
/**
 * Banda delle cifre del punteggio dell'HUD: `hud.ts` scrive SCORE nella
 * colonna centrale della riga in alto, 7 cifre bianche a scala 3 con origine
 * (430, 34), fra TIME a sinistra e LAP a destra. Non e' piu' l'angolo in alto
 * a sinistra: quello adesso e' l'etichetta TIME, che non e' bianca, quindi il
 * vecchio riquadro misurava zero sia al titolo sia in gara e l'asserzione non
 * distingueva piu' le due schermate. Misurato sul merge binario-hg: 0 pixel
 * quasi bianchi al titolo, 1386 in gara.
 */
const HUD_SCORE: Rect = { x: 428, y: 32, w: 172, h: 28 };

/** Quanti pixel quasi bianchi ci sono nel riquadro. */
async function whitePixels(page: Page, rect: Rect): Promise<number> {
  return page.evaluate((r) => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) count++;
    }
    return count;
  }, rect);
}

/** Impronta del frame: somma pesata di una griglia di pixel, per vedere se cambia. */
async function frameFingerprint(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(0, 0, 1280, 720).data;
    let sum = 0;
    // Un pixel ogni 997 componenti: primo, quindi il passo non si allinea
    // alle righe e il campione copre tutto il fotogramma.
    for (let i = 0; i < data.length; i += 997) sum = (sum + data[i] * (i % 251)) % 2147483647;
    return sum;
  });
}

/**
 * Riquadro attorno a una riga dell'elenco dei brani della radio: `radio.ts`
 * le disegna centrate a scala 2 (glifi 8x8, quindi 16 px alti) a
 * `y = 130 + i * 32` (binario J: l'elenco e' salito da 160 a 130 e il passo
 * e' sceso da 36 a 32 per far stare cinque righe fra il titolo e il
 * pannello), con un contorno di 1 px. Il riquadro e' strizzato attorno al
 * testo (il titolo piu' lungo e' 17 caratteri, 272 px, centrato su 640) e non
 * a tutta larghezza: da quando il pannello illustrato del binario H c'e'
 * davvero su disco, l'illustrazione del tramonto porta giallo suo in una
 * banda larga 1280 e la misura non direbbe piu' niente sull'evidenziazione.
 */
function radioRowRect(i: number): Rect {
  return { x: 490, y: 129 + i * 32, w: 300, h: 18 };
}

/**
 * Giallo dell'evidenziazione in una riga. Misurato sul merge binario-hg: la
 * riga scelta sta attorno a 1050 pixel, le altre sotto 150 (quei 150 sono il
 * tramonto dell'illustrazione dietro il testo grigio, non evidenziazione).
 * Le due soglie stanno in mezzo con un buon margine da entrambi i lati.
 */
const ROW_ON_MIN = 600;
const ROW_OFF_MAX = 300;

/** Quanti pixel del giallo di evidenziazione (#ffee55) ci sono nel riquadro. */
async function yellowPixels(page: Page, rect: Rect): Promise<number> {
  return page.evaluate((r) => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(r.x, r.y, r.w, r.h).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] < 120) count++;
    }
    return count;
  }, rect);
}

/** Quanti pixel non neri ha tutto il fotogramma: zero significa canvas vuoto. */
async function nonBlackPixels(page: Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.getElementById('game') as HTMLCanvasElement | null;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return -1;
    const data = ctx.getImageData(0, 0, 1280, 720).data;
    let count = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 8 || data[i + 1] > 8 || data[i + 2] > 8) count++;
    }
    return count;
  });
}

/** Raccoglie gli errori della pagina: console.error e eccezioni non gestite. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** Apre il gioco col gancio di diagnostica e aspetta che sia pronto. */
async function openGame(page: Page): Promise<void> {
  await page.goto('/#debug');
  await page.waitForFunction(() => window.__tebrun !== undefined);
}

const screenName = (page: Page): Promise<string | undefined> =>
  page.evaluate(() => window.__tebrun?.app.name);

/**
 * La tendina di `ui/transition.ts` copre la schermata nuova per
 * `WIPE_S = 0.4` s con un velo scuro al 50%: ogni misura di pixel fatta
 * subito dopo un cambio di schermata leggerebbe il velo e non la
 * schermata. Si aspetta che la tendina sia finita.
 */
async function afterWipe(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}

test.describe('TEB RUN', () => {
  test('il titolo si disegna, la strada scorre e PRESS ENTER lampeggia', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    expect(await screenName(page)).toBe('title');

    // Il canvas non è vuoto: la strada in autopilota è già disegnata.
    expect(await nonBlackPixels(page)).toBeGreaterThan(100_000);

    // Il lampeggio è a circa 1 Hz: campionando 3 s si vedono sia acceso
    // (la scritta vale circa 1800 pixel bianchi) sia spento (solo i
    // cordoli della strada, poche centinaia).
    const counts: number[] = [];
    for (let i = 0; i < 24; i++) {
      counts.push(await whitePixels(page, PRESS_ENTER));
      await page.waitForTimeout(120);
    }
    expect(Math.max(...counts), `campioni: ${counts.join(',')}`).toBeGreaterThan(1000);
    expect(Math.min(...counts), `campioni: ${counts.join(',')}`).toBeLessThan(800);

    await page.screenshot({ path: 'e2e/out/title.png' });
    expect(errors).toEqual([]);
  });

  test('titolo -> radio -> gara con ENTER, e l\'HUD compare', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);

    const titleScore = await whitePixels(page, HUD_SCORE);

    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await afterWipe(page);
    await page.screenshot({ path: 'e2e/out/radio.png' });

    // Il primo brano è evidenziato di default: right deve spostare
    // l'evidenziazione al secondo, non solo cambiare qualche pixel a caso.
    // `poll` e non una misura sola: appena cambiata schermata c'è la tendina
    // di `ui/transition.ts` (WIPE_S = 0.4 s), il cui velo scurisce il giallo.
    await expect.poll(() => yellowPixels(page, radioRowRect(0))).toBeGreaterThan(ROW_ON_MIN);
    expect(await yellowPixels(page, radioRowRect(1))).toBeLessThan(ROW_OFF_MAX);

    // .press() è keydown+keyup troppo rapidi per un gioco che campiona
    // l'input a ogni requestAnimationFrame: right è un'azione "held",
    // rilevata sul fronte di salita di actions.right, non su un tasto
    // momentaneo. .down()/.up() garantisce che almeno un fotogramma la vede giù.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(50);
    await page.keyboard.up('ArrowRight');
    await expect
      .poll(() => yellowPixels(page, radioRowRect(1)))
      .toBeGreaterThan(ROW_ON_MIN);
    expect(await yellowPixels(page, radioRowRect(0))).toBeLessThan(ROW_OFF_MAX);

    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    await afterWipe(page);

    // L'HUD scrive il punteggio a sei cifre in alto a sinistra: nel titolo
    // quella banda è cielo, in gara è testo bianco.
    await expect.poll(() => whitePixels(page, HUD_SCORE)).toBeGreaterThan(300);
    expect(await whitePixels(page, HUD_SCORE)).toBeGreaterThan(titleScore + 200);

    await page.screenshot({ path: 'e2e/out/race.png' });
    expect(errors).toEqual([]);
  });

  test('venti secondi di guida senza eccezioni e con il fotogramma che cambia', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');

    await page.keyboard.down('ShiftLeft');
    await page.keyboard.up('ShiftLeft'); // marcia alta: la cambiata è momentanea
    await page.keyboard.down('ArrowUp');

    const prints: number[] = [];
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(1000);
      prints.push(await frameFingerprint(page));
    }
    await page.keyboard.up('ArrowUp');

    // Venti impronte a un secondo di distanza: il gioco non si è fermato.
    expect(new Set(prints).size, `impronte: ${prints.join(',')}`).toBeGreaterThan(15);
    // e si sta ancora giocando, non si è finiti in una schermata di errore
    expect(['race', 'ending', 'gameOver', 'nameEntry']).toContain(await screenName(page));
    await page.screenshot({ path: 'e2e/out/driving.png' });
    expect(errors).toEqual([]);
  });

  test('il gancio #debug espone app, audio, assets e snapshot, e non manca nessun PNG', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);

    const handles = await page.evaluate(() => {
      const debug = window.__tebrun;
      if (debug === undefined) return null;
      return {
        keys: Object.keys(debug).sort(),
        name: debug.app.name,
        stats: debug.assets.stats,
        audioAvailable: typeof debug.audio.available,
        snapshotAtTitleIsNull: debug.snapshot() === null,
      };
    });
    expect(handles).not.toBeNull();
    // Il brief di questo passo elenca solo ['app', 'assets', 'audio',
    // 'snapshot'], ma `renderAudioSample` c'è già (task audio precedente) ed
    // è condizionale: resta nell'elenco. `setStartTimeLimit` serve al test
    // del checkpoint (revisione finale K), `car` alla scelta dell'auto (Set 7),
    // `mode` alla scelta della modalità (due livelli di difficoltà), `device`
    // ai comandi a schermo e al tocco (lancio, punti 7 e 14), `setStartStage`
    // agli screenshot dei controlli touch su sfondi chiari e scuri.
    expect(handles?.keys).toEqual([
      'app',
      'assets',
      'audio',
      'car',
      'device',
      'mode',
      'renderAudioSample',
      'setStartStage',
      'setStartTimeLimit',
      'snapshot',
    ]);
    expect(handles?.name).toBe('title');
    expect(handles?.audioAvailable).toBe('boolean');
    // Tutti i nomi del catalogo risolti: quelli con un PNG dal manifest, i
    // soli procedurali disegnati da codice, zero mancanti.
    expect(handles?.stats).toEqual({ png: PNG_COUNT, procedural: PROCEDURAL_COUNT, missing: 0 });
    // Al titolo non e' ancora stato costruito nessun motore di gara vero.
    // Si porta di qua il solo booleano: uno snapshot intero sono 300
    // segmenti, e non c'e' ragione di farli attraversare il ponte.
    expect(handles?.snapshotAtTitleIsNull).toBe(true);

    // Senza #debug il gancio non esiste: non è una porta aperta in produzione.
    await page.goto('/');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__tebrun === undefined)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('la radio mostra CAR: e C cicla le cinque auto, anche nell\'anteprima', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await afterWipe(page);
    const car = (): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.car());
    expect(await car()).toBe('new');
    // Riquadro dell'anteprima e della scritta, a sinistra dell'elenco
    // (`RADIO_CAR_X` 150, largo 170, fino alla riga di `CAR:`).
    const clip = { x: 60, y: 120, width: 180, height: 145 };
    const before = await page.screenshot({ clip });
    await page.keyboard.press('KeyC');
    await expect.poll(car).toBe('classic');
    const classic = await page.screenshot({ clip });
    expect(classic.equals(before)).toBe(false);
    await page.screenshot({ path: 'e2e/out/radio-car.png' });
    await page.keyboard.press('KeyC');
    await expect.poll(car).toBe('retro');
    const retro = await page.screenshot({ clip });
    expect(retro.equals(classic)).toBe(false);
    await page.keyboard.press('KeyC');
    await expect.poll(car).toBe('sport');
    const sport = await page.screenshot({ clip });
    expect(sport.equals(retro)).toBe(false);
    expect(sport.equals(before)).toBe(false);
    await page.keyboard.press('KeyC');
    await expect.poll(car).toBe('super');
    const superCar = await page.screenshot({ clip });
    expect(superCar.equals(sport)).toBe(false);
    expect(superCar.equals(before)).toBe(false);
    // La scelta si ricorda: ricaricando la pagina resta la supercar.
    await page.reload();
    await page.waitForFunction(() => window.__tebrun !== undefined);
    expect(await car()).toBe('super');
    expect(errors).toEqual([]);
  });

  test('?car= sceglie l\'auto all\'avvio: new, classic, retro, sport, super; un valore ignoto ricade sulla nuova', async ({ page }) => {
    for (const choice of ['classic', 'retro', 'sport', 'super', 'new'] as const) {
      await page.goto(`/?car=${choice}#debug`);
      await page.waitForFunction(() => window.__tebrun !== undefined);
      expect(await page.evaluate(() => window.__tebrun?.car())).toBe(choice);
    }
    // Uno storage con un valore ignoto, senza `?car=`, vale l'auto nuova.
    await page.evaluate(() => localStorage.setItem('tebrun.car.v1', 'nonexistent'));
    await page.goto('/#debug');
    await page.waitForFunction(() => window.__tebrun !== undefined);
    expect(await page.evaluate(() => window.__tebrun?.car())).toBe('new');
  });

  test('la radio mostra MODE: accanto a CAR:, e D passa da NORMAL a HARD e ritorno', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await afterWipe(page);
    const mode = (): Promise<string | undefined> => page.evaluate(() => window.__tebrun?.mode());
    expect(await mode()).toBe('normal');
    // Riquadro della scritta, specchiato rispetto a quello di `CAR:`
    // (`RADIO_MODE_X` = 1130, riga di `CAR:` e del suo tasto).
    const clip = { x: 1020, y: 244, width: 220, height: 44 };
    const normal = await page.screenshot({ clip });
    await page.keyboard.press('KeyD');
    await expect.poll(mode).toBe('hard');
    const hard = await page.screenshot({ clip });
    expect(hard.equals(normal)).toBe(false);
    // D non tocca l'auto.
    expect(await page.evaluate(() => window.__tebrun?.car())).toBe('new');
    await page.screenshot({ path: 'e2e/out/radio-mode.png' });
    // La scelta si ricorda.
    await page.reload();
    await page.waitForFunction(() => window.__tebrun !== undefined);
    expect(await mode()).toBe('hard');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('KeyD');
    await expect.poll(mode).toBe('normal');
    expect(errors).toEqual([]);
  });

  test('?mode=hard arriva alla gara: tappa in HARD con il suo tempo; senza, NORMAL', async ({ page }) => {
    const errors = watchErrors(page);
    const stageOf = () =>
      page.evaluate(() => {
        const stage = window.__tebrun?.snapshot()?.stage;
        return stage === undefined ? null : { id: stage.id, mode: stage.mode ?? 'normal', timeLimit: stage.timeLimit };
      });
    for (const [query, want, limit] of [
      ['?mode=hard', 'hard', 75],
      ['', 'normal', 80],
    ] as const) {
      await page.goto(`/${query}#debug`);
      await page.waitForFunction(() => window.__tebrun !== undefined);
      expect(await page.evaluate(() => window.__tebrun?.mode())).toBe(want);
      await page.keyboard.press('Enter');
      await expect.poll(() => screenName(page)).toBe('radio');
      await page.keyboard.press('Enter');
      await expect.poll(() => screenName(page)).toBe('race');
      expect(await stageOf()).toEqual({ id: '0-0', mode: want, timeLimit: limit });
      // Senza `?mode=` vale quella ricordata: la si riporta a NORMAL qui.
      if (want === 'hard') await page.evaluate(() => localStorage.setItem('tebrun.mode.v1', 'normal'));
    }
    expect(errors).toEqual([]);
  });

  test('la galleria di sviluppo mostra tutti gli sprite del catalogo e nessuno mancante', async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto('/dev/galleria.html');
    const summary = page.locator('#summary');
    await expect(summary).toContainText(`${SPRITE_COUNT} sprite`);
    await expect(summary).toContainText(`${PNG_COUNT} png`);
    await expect(summary).toContainText('0 mancanti');
    await page.screenshot({ path: 'e2e/out/galleria.png', fullPage: false });
    expect(errors).toEqual([]);
  });

  /**
   * Porta il gioco dal titolo alla gara, tendina compresa. Con
   * `startTimeLimit` la tappa di partenza ha quel tempo invece della tabella.
   */
  async function enterRace(page: Page, startTimeLimit?: number): Promise<void> {
    await openGame(page);
    if (startTimeLimit !== undefined) {
      await page.evaluate((seconds) => window.__tebrun?.setStartTimeLimit(seconds), startTimeLimit);
    }
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('radio');
    await page.keyboard.press('Enter');
    await expect.poll(() => screenName(page)).toBe('race');
    // La tendina copre la gara per 0,4 s: chi misura pixel subito dopo
    // leggerebbe il velo (spec §11).
    await afterWipe(page);
  }

  /** Il campo `countdown` dello snapshot, o null. */
  const countdownOf = (page: Page): Promise<number | null | undefined> =>
    page.evaluate(() => window.__tebrun?.snapshot()?.countdown ?? null);

  test('il conto alla rovescia tiene l\'auto ferma e poi dà il GO', async ({ page }) => {
    const errors = watchErrors(page);
    await enterRace(page);

    // Appena entrati il conto è quasi tre, e il gas tenuto non muove nulla.
    const first = await countdownOf(page);
    // Soglia a 1.5 e non a 2: fra l'ingresso in gara e la prima lettura
    // passano gli intervalli di `expect.poll`, e il conto misurato a
    // ~0,6 s valeva già 2,72. A 2 il margine era di poche centinaia di ms.
    expect(first, `countdown iniziale: ${first}`).toBeGreaterThan(1.5);
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(1500);
    const speedDuring = await page.evaluate(() => window.__tebrun?.snapshot()?.player.speed ?? -1);
    expect(speedDuring).toBe(0);
    const during = await countdownOf(page);
    expect(during).toBeLessThan(first!);
    expect(during).toBeGreaterThan(0);
    await page.screenshot({ path: 'e2e/out/countdown.png' });

    // Dopo il via l'auto parte e il campo sparisce.
    await expect.poll(() => countdownOf(page), { timeout: 15_000 }).toBeNull();
    await expect
      .poll(() => page.evaluate(() => window.__tebrun?.snapshot()?.player.speed ?? 0), { timeout: 10_000 })
      .toBeGreaterThan(0);
    await page.keyboard.up('ArrowUp');
    await page.screenshot({ path: 'e2e/out/go.png' });
    expect(errors).toEqual([]);
  });

  test('il portale di partenza è davanti al giocatore al primo fotogramma', async ({ page }) => {
    const errors = watchErrors(page);
    await enterRace(page);
    const names = await page.evaluate(() => {
      const snap = window.__tebrun?.snapshot();
      if (!snap) return null;
      return snap.segments.flatMap((seg) => seg.sprites.map((p) => p.name));
    });
    expect(names).not.toBeNull();
    // Il portale sta sul segmento `CROWD_START`, dentro la fetta visibile a
    // z = 0:
    // quindi è disegnato, non solo piazzato (spec §4.4e).
    expect(names).toContain('race_start_gantry');
    expect(names).toContain('race_flag_left');
    await page.screenshot({ path: 'e2e/out/start-gantry.png' });
    expect(errors).toEqual([]);
  });

  test('al checkpoint compare EXTEND TIME con i secondi aggiunti', async ({ page }) => {
    // Con qualche incidente (6-9 s l'uno) la tappa chiede fino a 2,4 min: la soglia
    // di `playwright.config.ts` non lascerebbe margine al carico.
    test.setTimeout(300_000);
    const errors = watchErrors(page);
    // Il test misura il checkpoint, non l'autopilota: con i 3256 segmenti di
    // 0-0 e i suoi 74 s (tarati sul pilota esperto, terzo collaudo
    // utente), questo autopilota finisce il tempo molto prima del traguardo. Con 999 s arriva sempre, e i secondi aggiunti
    // restano quelli della tabella, perché il gancio tocca solo la partenza.
    await enterRace(page, 999);
    await page.keyboard.down('ArrowUp');
    // Un autopilota nella pagina, guidato dallo snapshot. Quattro cose
    // misurate qui, che un gas tenuto da solo non copre:
    // - il conto alla rovescia scarta le azioni, quindi la marcia alta va
    //   innestata **dopo** il via: `press('ShiftLeft')` prima del GO si
    //   perde e l'auto resta a 161 km/h, troppo lenta per la tappa;
    // - dopo un incidente la marcia torna bassa, quindi si reinnesta ogni
    //   volta che lo snapshot dice `lo`;
    // - a tavoletta e senza sterzare la centrifuga porta fuori strada a
    //   ogni curva; il bersaglio e' una **corsia** (0.85) e non il centro,
    //   perche' nella zona di bivio il centro e' l'isola con le barriere;
    // - nelle curve strette sopra 205 km/h frena, come il pilota prudente
    //   di `tests/helpers/prudent-driver.ts` (curvatura 2, 70% di 293):
    //   meno incidenti, quindi una durata del test piu' prevedibile;
    // - il banner del checkpoint dura 2 s, meno degli intervalli crescenti
    //   di `expect.poll`: i secondi aggiunti si agganciano nella pagina.
    await page.evaluate(() => {
      const TARGET = 0.85;
      const BRAKE_CURVE = 2;
      const BRAKE_KMH = 205;
      const latch = window as unknown as { __checkpointExtend?: number };
      const fire = (type: string, code: string): void => {
        // `dispatchEvent` ritorna un booleano: senza corpo a blocco
        // l'arrow lo ritorna e TS rifiuta l'annotazione `: void`.
        window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      };
      window.setInterval(() => {
        const snap = window.__tebrun?.snapshot();
        if (snap === null || snap === undefined) return;
        if (snap.banner === 'checkpoint' && snap.extendTime !== undefined) {
          latch.__checkpointExtend = snap.extendTime;
        }
        if (snap.countdown !== undefined) return;
        if (snap.player.gear === 'lo') {
          fire('keydown', 'ShiftLeft');
          fire('keyup', 'ShiftLeft');
        }
        const curve = Math.max(0, ...snap.segments.slice(4, 17).map((seg) => Math.abs(seg.curve)));
        fire(curve >= BRAKE_CURVE && snap.kmh > BRAKE_KMH ? 'keydown' : 'keyup', 'ArrowDown');
        fire('keyup', 'ArrowLeft');
        fire('keyup', 'ArrowRight');
        if (snap.player.x > TARGET + 0.05) fire('keydown', 'ArrowLeft');
        else if (snap.player.x < TARGET - 0.05) fire('keydown', 'ArrowRight');
      }, 60);
    });
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as unknown as { __checkpointExtend?: number }).__checkpointExtend ?? 0,
          ),
        { timeout: 240_000 },
      )
      .toBeGreaterThan(30);
    await page.screenshot({ path: 'e2e/out/extend-time.png' });
    await page.keyboard.up('ArrowUp');
    expect(errors).toEqual([]);
  });

  test('il ciclo attrattivo passa dal titolo alla gara alla mappa, e poi alla classifica', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    expect(await screenName(page)).toBe('title');

    // Fase 0, l'illustrazione con il logo.
    await page.waitForTimeout(1500);
    const phase0 = await frameFingerprint(page);
    await page.screenshot({ path: 'e2e/out/attract-title.png' });

    // Fase 1, la strada in autopilota: dopo 12 s.
    await page.waitForTimeout(12_000);
    const phase1 = await frameFingerprint(page);
    await page.screenshot({ path: 'e2e/out/attract-demo.png' });
    expect(phase1).not.toBe(phase0);
    expect(await screenName(page)).toBe('title');

    // Fase 2, la mappa illustrata: dopo altri 12 s.
    await page.waitForTimeout(12_000);
    const phase2 = await frameFingerprint(page);
    await page.screenshot({ path: 'e2e/out/attract-map.png' });
    expect(phase2).not.toBe(phase1);
    expect(await screenName(page)).toBe('title');

    // Fine del ciclo: la classifica.
    await expect.poll(() => screenName(page), { timeout: 20_000 }).toBe('scores');
    await page.screenshot({ path: 'e2e/out/attract-scores.png' });
    expect(errors).toEqual([]);
  });

  test('un tasto azzera il ciclo attrattivo e riporta al titolo', async ({ page }) => {
    const errors = watchErrors(page);
    await openGame(page);
    await page.waitForTimeout(13_000); // siamo nella fase della gara
    const demo = await frameFingerprint(page);
    // Un tasto che non conferma: la freccia sinistra.
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(100);
    await page.keyboard.up('ArrowLeft');
    await page.waitForTimeout(1500);
    const back = await frameFingerprint(page);
    expect(back).not.toBe(demo);
    expect(await screenName(page)).toBe('title');
    expect(errors).toEqual([]);
  });
});
