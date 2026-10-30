/**
 * Tempo base per livello, in secondi. **Deroga a spec §8** (era 75, 65, 62,
 * 60, 58): con quei valori il pilota prudente del test della taratura
 * (`tests/game/balance.test.ts`) non finisce nessuno dei 16 percorsi, perché
 * il modello della spec non paga schianti, urti, fuori strada né derapate,
 * che costano 6-12 s a tappa.
 *
 * Il punto di partenza proposto dal binario G, [79, 78, 77, 76, 75], era
 * misurato **prima** che questo stesso binario portasse dentro la centrifuga
 * più forte e la frenata più leggera in curva di spec §5/§9 (Step 0 di
 * questo task: `CENTRIFUGAL` 0,3→0,42, `CURVE_DRAG` 0,03→0,012,
 * `SKID_ANY_SPEED` 0,85→0,95, `SKID_DECEL` −MAX_SPEED/6→−MAX_SPEED/12, pesi
 * `curveHard` e `chicane` più alti): con quella fisica e [79, 78, 77, 76, 75]
 * nessuno dei 16 percorsi chiude (margine peggiore per livello 9,6 / 8,6 /
 * 0,1 / 0 / 0 s). Ritarati con `DRIVER_DT = 1 / 20`, tre giri del ciclo di
 * taratura: [91, 90, 89, 88, 87], margine peggiore per livello 21,6 / 32,6 /
 * 36,1 / 39,1 / 19,4 s, 16 percorsi su 16.
 *
 * **Fix round 1 (stessa deroga, riduzione uniforme).** Quei margini sono
 * troppo larghi per un gioco che deve restare tirato come i racer arcade dell'epoca. Il
 * tempo di guida reale per tappa (indipendente dalla tabella, ricavato dai
 * margini: `timeSpent = margine_prec + T[livello] − margine`) cresce da
 * 69,4 s (livello 0) a 106,7 s (livello 4, il traguardo, +21,7 s sul livello
 * 3): con `T` strettamente decrescente e il riporto ai checkpoint, i margini
 * dei livelli bassi sono per costruzione la riserva che paga la tappa
 * finale, come nei racer arcade dell'epoca — non possono stare tutti in una finestra
 * stretta senza spostare la leva della lunghezza delle tappe
 * (`LENGTH_PER_DIFFICULTY`, non toccata qui). Applicata una riduzione
 * **uniforme** di 3 s a tutta la tabella (resta decrescente, invariante di
 * spec §8): margine peggiore per livello 18,6 / 26,6 / 27,1 / 27,1 / 4,4 s,
 * 16 percorsi su 16 — 4 s di riduzione (a [87, 86, 85, 84, 83]) porta il
 * livello 4 a 0,0 s (game over su almeno un percorso), quindi 3 è il δ intero
 * più grande che tiene il margine peggiore ≥ 4 s. Il pilota prudente è più
 * lento di un umano medio (frena in ogni curva stretta, non taglia le
 * traiettorie): i margini reali di un giocatore saranno più larghi di
 * questi.
 *
 * **Fix round 2 (deroga: collaudo utente "troppo facile, troppi secondi").**
 * Le tappe si allungano ~20 % (`game/stages.ts`, `BASE_LENGTH_SEGMENTS`
 * 2200→2640, `LENGTH_PER_DIFFICULTY` 400→480): a parità di tabella il tempo
 * di guida reale cresce della stessa proporzione e i margini del fix round 1
 * (18,3 / 34,9 / 35,6 / 33,6 / 17,1 s, ultima misura del binario K) sarebbero
 * scalati anche loro, ancora troppo larghi. Bersaglio nuovo: margine peggiore
 * **fra 4 e 7 s per ogni livello**, non solo il minimo globale — il difetto
 * segnalato dal collaudo era "troppi secondi", non solo "il livello più
 * facile ha troppi secondi".
 *
 * Misurato il tempo di guida reale per tappa (indipendente dalla tabella,
 * `timeSpent = margine_prec + timeLimit_tappa − margine`, sul motore vero,
 * peggiore sui 16 percorsi): 83,1 / 84,7 / 104,1 / 106,0 / 124,9 s. Il salto
 * grosso è al livello 2 (+19,4 s sul livello 1): è dove entra per la prima
 * volta un tema a strada strette (`alpine`, Pine Pass, `lanes: 3, roadHalf:
 * 0.8`), che costa più tempo al pilota prudente indipendentemente dalla
 * difficoltà numerica. Un secondo salto (+18,9 s) arriva al livello 4
 * (deserto e alpino di nuovo, più lo sconto ×0,92 di `HARD_TIME_FACTOR` che
 * non basta a compensarlo).
 *
 * Con un riporto ai checkpoint e un bersaglio di margine stretto (4-7 s) a
 * **ogni** livello, `timeLimit_tappa` deve restare vicino al tempo di guida
 * reale di quel livello — non può più solo scendere: dove il tempo di guida
 * salta in su, la tabella deve salire con lui, altrimenti il margine crolla
 * sotto 4 e la tappa non chiude. **Non è più decrescente**: la deroga di
 * spec §8 (tabella sempre in calo, "i secondi aggiunti ai checkpoint sono
 * meno del tempo della prima tappa") cede al bersaglio più stringente del
 * collaudo, con lo stesso spirito — tempo scarso, non abbondante — ma
 * applicato tappa per tappa invece che in un'unica curva discendente. Livelli
 * 0→1 restano in calo (89, 84: qui il tempo di guida non salta); 1→2 e 3→4
 * salgono (84→105, 105→136) per assorbire i due salti di sopra; 2→3 resta
 * piatto (105, 105: il tempo di guida cresce solo di 1,9 s lì). Misurato
 * sui 16 percorsi: margine peggiore per livello **5,9 / 5,2 / 6,1 / 5,1 /
 * 5,3 s**, tutti dentro 4-7, nessun game over. Rimisurato dopo la revisione
 * finale K (punta della Y larga 1,7, tratti di superficie fuori dall'uscita
 * dal bivio), stessa tabella: **5,9 / 5,2 / 6,3 / 6,4 / 6,7 s**.
 *
 * **Fix round 3 (deroga: secondo collaudo utente "ancora troppo facile").**
 * Tappe ancora +20 % (`BASE_LENGTH_SEGMENTS` 2640→3170,
 * `LENGTH_PER_DIFFICULTY` 480→576) e il riferimento della taratura non è
 * più il pilota prudente ma il pilota **bravo** di
 * `tests/helpers/skilled-driver.ts` (gas pieno, freno solo sulle curve dure
 * e solo quanto basta, corda in curva, corsia libera): il prudente è molto
 * più lento di chi gioca (nel motore il gas vince sul freno, quindi la sua
 * frenata in curva non frena; sterza in piena curva, e ogni sterzata in
 * curva sopra il 60 % è una derapata). Tempo di guida peggiore per livello
 * sui 16 percorsi, alle lunghezze nuove: bravo **80,1 / 77,5 / 111,7 /
 * 100,7 / 133,2 s**, prudente 99,6 / 101,7 / 138,5 / 132,1 / 153,3 s.
 *
 * Bersaglio: margine peggiore del bravo **fra 3 e 6 s a ogni livello**,
 * col vincolo che il prudente chiuda comunque **la prima tappa** su tutti i
 * percorsi (il gioco resta avvicinabile). I due vincoli si contraddicono al
 * livello 0: 0-0 è la stessa tappa su tutti i percorsi, il prudente ci mette
 * 99,6 s e il bravo 80,1, quindi un limite che lasci al bravo al più 6 s
 * (86) ferma il prudente alla prima tappa. Vince l'avvicinabilità: 0-0 ha
 * 101 s (il prudente la chiude con 1,4 s), il bravo arriva al primo
 * checkpoint con 20,9 s, e il riporto glieli ridà tutti al livello 1, che
 * per questo ha il limite più basso della tabella (61). Dal livello 1 in su
 * il bravo sta dentro 3-6 s: margine peggiore per livello **20,9 / 4,4 /
 * 4,8 / 4,9 / 5,0 s**, 16 percorsi su 16. Il prudente chiude la prima
 * tappa su 16 percorsi su 16 e non finisce nessun percorso (game over al
 * livello 1).
 *
 * **Fix round 4 (deroga: terzo collaudo utente "ancora troppo facile,
 * troppi secondi, si vince sempre").** Il bravo frena prima delle curve
 * dure: guida 0-0 in 80,1 s dove a gas pieno su strada dritta ne bastano
 * 56,8, e chi gioca tenendo il gas arrivava con decine di secondi di
 * scorta. Il riferimento ora è il pilota **esperto** di
 * `tests/helpers/expert-driver.ts`: gas sempre, mai il freno, rilascio solo
 * per il tempo minimo che lo tiene sull'asfalto (prova in avanti con la
 * fisica vera), corda in curva, traffico evitato in anticipo; sui 16
 * percorsi non esce mai di strada e non urta niente. Tempo di guida
 * peggiore per livello: esperto **69,9 / 70,5 / 80,0 / 85,5 / 88,8 s**
 * (bravo 80,1 / 77,5 / 111,7 / 100,7 / 133,2; prudente 99,6 / 101,7 /
 * 138,5 / 132,1 / 156,1; teorico a gas pieno senza curve 56,8 / 55,7 /
 * 57,1 / 59,1 / 61,0).
 *
 * Bersaglio: margine peggiore dell'esperto **fra 3 e 6 s a ogni livello,
 * livello 0 compreso**; il prudente e il bravo possono non finire, senza
 * soglia. La tabella segue il tempo di guida livello per livello (il
 * riporto è cumulativo): margine peggiore per livello **4,1 / 4,6 / 4,6 / 4,3
 * / 4,2 s**, 16 percorsi su 16. Il bravo arriverebbe al primo checkpoint
 * 6,1 s dopo lo zero e il prudente 25,6 s dopo: nessuno dei due chiude la
 * prima tappa. Giù, su, su, su: il livello 1 scende di 3 s perché lo paga
 * il riporto del livello 0, gli altri salgono col tempo di guida, e il 4
 * resta sopra il 3 anche scontato (93 · 0,92 → 86).
 */
export const LEVEL_TIME_LIMITS: readonly number[] = [74, 71, 80, 85, 93];

/**
 * Limite di tempo **per tappa**, in secondi interi, per id. **Deroga (terzo
 * collaudo utente, precisazione: «deve essere possibile finirlo, ma solo con
 * una guida quasi perfetta»)**. Con la tabella per livello qui sopra un
 * errore vero non costava la partita: le tappe dello stesso livello
 * differiscono fino a 13 s di guida (livello 4: 4-4 in 76 s, 4-3 in 89), e
 * i percorsi più facili accumulavano 5-10 s di riporto in più del peggiore;
 * l'esperto con un testacoda perdeva un checkpoint solo su 1 percorso su 16.
 * Ora ogni tappa ha il suo limite, il più basso intero che lascia al pilota
 * esperto pulito (`tests/helpers/expert-driver.ts`) almeno 3 s di margine
 * a fine tappa su ogni percorso che la attraversa, al passo della taratura
 * (1/20 s) e al passo di gioco (1/60 s); il riporto resta cumulativo.
 * Sostituisce `LEVEL_TIME_LIMITS` e lo sconto ×0,92 di `HARD_TIME_FACTOR`
 * per le quindici tappe vere, che restano la regola del grafo demo e di un
 * id fuori tabella.
 *
 * Margine peggiore dell'esperto pulito per livello: **4,1 / 3,6 / 3,6 /
 * 3,3 / 3,2 s** (a 60 Hz 3,7 / 3,6 / 3,8 / 3,4 / 3,2). Con un incidente
 * (`game/crash.ts`, ~5 s più lungo di prima: costa 6-9 s; oggi è così solo
 * in HARD) a metà di una
 * tappa l'esperto perde un checkpoint su 16 percorsi su 16
 * (`tests/game/balance-error.test.ts`).
 *
 * Poi la richiesta dell'utente: +6 s alla 0-0 (74 → 80), riportati come
 * tutti gli altri. Margine peggiore dell'esperto pulito **10,1 / 9,6 / 9,6
 * / 9,3 / 9,2 s**; con un testacoda 0 percorsi persi su 16.
 *
 * Poi NORMAL più gentile (richiesta dell'utente prima del lancio): +2 s alle
 * tappe del livello 2, +1 s a quelle dei livelli 3 e 4, riportati come gli
 * altri (in tutto +4 s all'ultimo livello). HARD resta "solo guida quasi
 * perfetta".
 *
 * **Deroga (collaudo utente su iPhone: «NORMAL deve essere più facile,
 * soprattutto deve costare meno un incidente»).** +3 s a ogni tappa dei
 * livelli 1-4, riportati come gli altri (la 0-0 resta 80), e l'incidente di
 * NORMAL a ~3 s (`CRASH_TIMING` in `game/crash.ts`). Margine peggiore
 * dell'esperto pulito **9,5 / 11,9 / 15,2 / 18,0 / 19,9 s**; con due
 * incidenti per partita (a metà della seconda e della quarta tappa)
 * finisce 16 percorsi su 16, margine peggiore 9,5 / 6,0 / 9,5 / 8,7 / 10,5
 * s (a 60 Hz 9,6 / 6,5 / 10,1 / 4,2 / 5,8). `STAGE_TIME_LIMITS_HARD` non
 * cambia.
 */
export const STAGE_TIME_LIMITS: Readonly<Record<string, number>> = {
  // Richiesta dell'utente: +6 s alla prima tappa (era 74), riportati come
  // tutti i secondi che avanzano. Le altre hanno +3 s (collaudo su iPhone).
  // Poi la prima tappa per i principianti (spec prima tappa e ritorno §3.2):
  // 80 + `FIRST_STAGE_EXTRA_S`; se ne riportano `FIRST_STAGE_EXTRA_CARRY_S`.
  '0-0': 110,
  '1-0': 73,
  '1-1': 70,
  '2-0': 85,
  '2-1': 79,
  '2-2': 77,
  '3-0': 86,
  '3-1': 89,
  '3-2': 85,
  '3-3': 88,
  '4-0': 90,
  '4-1': 89,
  '4-2': 90,
  '4-3': 93,
  '4-4': 80,
};
/**
 * Limite per tappa della modalità HARD (collaudo utente: due livelli di
 * difficoltà), stesse regole di `STAGE_TIME_LIMITS`: il più basso intero
 * che lascia al pilota esperto pulito, **in HARD** (traffico ×1,6 e ×1,1
 * più veloce, `game/mode.ts`), 3-5 s di margine peggiore per livello;
 * riporto ordinario. Tarata tappa per tappa sui 16 percorsi guidati senza
 * limite di tempo, con 3,5 s di bersaglio: margine peggiore dell'esperto
 * **4,4 / 4,0 / 3,9 / 3,6 / 3,6 s**, 16 percorsi puliti, nessun urto. La
 * 0-0 non ha i +6 s di NORMAL (75 invece di 80): con quelli il livello 0
 * arriverebbe a 9,4 s, e il riporto li porterebbe a ogni tappa dopo.
 */
export const STAGE_TIME_LIMITS_HARD: Readonly<Record<string, number>> = {
  '0-0': 75,
  '1-0': 70,
  '1-1': 67,
  '2-0': 80,
  '2-1': 76,
  '2-2': 74,
  '3-0': 87,
  '3-1': 87,
  '3-2': 82,
  '3-3': 84,
  '4-0': 89,
  '4-1': 88,
  '4-2': 91,
  '4-3': 87,
  '4-4': 75,
};
/** Sopra questa difficoltà il limite è ridotto (spec §8). */
export const HARD_DIFFICULTY = 0.7;
export const HARD_TIME_FACTOR = 0.92;
/** Durata del banner CHECKPOINT (spec §8). */
export const CHECKPOINT_BANNER_S = 2;
/** Secondi di decelerazione fra tempo scaduto e schermata di game over (spec §8). */
export const GAMEOVER_DECEL_S = 2;
/**
 * Margine contro gli errori di virgola mobile: 120 passi da 1/60 non fanno
 * esattamente 2, e 0.3 / 0.1 fa 2.9999…. Senza il margine ogni durata
 * misurata in tick scadrebbe un tick dopo il dovuto. Lo usa anche
 * `game/crash.ts`.
 */
export const TIME_EPSILON = 1e-9;

/** Limite di tempo di una tappa: base del livello, ×0.92 se difficulty > 0.7 (spec §8). Pura. */
export function timeLimitFor(level: number, difficulty: number): number {
  const i = level < 0 ? 0 : level > LEVEL_TIME_LIMITS.length - 1 ? LEVEL_TIME_LIMITS.length - 1 : level;
  const base = LEVEL_TIME_LIMITS[i];
  return difficulty > HARD_DIFFICULTY ? base * HARD_TIME_FACTOR : base;
}

/**
 * Secondi in più della 0-0 di NORMAL (spec prima tappa e ritorno §3): un
 * principiante che non sa del cambio non la superava in 80 s, e nemmeno il
 * pilota prudente (100 s). Sono già dentro `STAGE_TIME_LIMITS['0-0']`.
 */
export const FIRST_STAGE_EXTRA_S = 30;

/**
 * Quanti di quei secondi si riportano alla 1-0 (decisione di Teb dopo il
 * collaudo di b43850d: senza riporto il livello 1 era quasi impossibile;
 * spec telefono e finali §0). Da 0 a 30: si riportano sempre i primi
 * `FIRST_STAGE_EXTRA_CARRY_S` secondi rimasti, più tutto quello che supera
 * `FIRST_STAGE_EXTRA_S`. È l'unico numero da cambiare; dopo, `npm run
 * gen:limits` e il Worker ridistribuito.
 */
export const FIRST_STAGE_EXTRA_CARRY_S = 15;

/** Secondi in più di una tappa: `seconds` dentro il limite, `carried` riportabili. */
export interface ExtraTime {
  seconds: number;
  carried: number;
}

/** Nessun secondo in più: il riporto è tutto il tempo rimasto. */
export const NO_EXTRA_TIME: ExtraTime = { seconds: 0, carried: 0 };

/** I secondi in più delle tappe di NORMAL: solo la 0-0. */
export const STAGE_EXTRA_TIME: Readonly<Record<string, ExtraTime>> = {
  '0-0': { seconds: FIRST_STAGE_EXTRA_S, carried: FIRST_STAGE_EXTRA_CARRY_S },
};

/** I secondi in più di una tappa: `extraTime`, o nessuno. Pura. */
export function extraOf(stage: { extraTime?: ExtraTime }): ExtraTime {
  return stage.extraTime ?? NO_EXTRA_TIME;
}

/**
 * Il tempo che passa alla tappa dopo, e su cui si calcola il bonus del
 * checkpoint: i primi `extra.carried` secondi rimasti più quelli oltre
 * `extra.seconds`, mai negativo. Senza secondi in più è il tempo rimasto.
 * `src/shared/validate.ts` ne ha una copia (il Worker non importa il
 * motore), controllata da un test. Pura.
 */
export function carryAfterCheckpoint(left: number, extra: ExtraTime): number {
  const l = Math.max(0, left);
  return Math.min(l, extra.carried) + Math.max(0, l - extra.seconds);
}

/** Tempo della tappa successiva: il suo limite più quello avanzato (spec §8). Pura. */
export function carryOver(left: number, nextLimit: number): number {
  return nextLimit + Math.max(0, left);
}

export interface TimerState {
  /** Secondi rimasti, mai negativi: a zero il tempo è scaduto. */
  left: number;
  /** Secondi dallo scadere del tempo, o null se non è ancora scaduto. */
  expired: number | null;
}

export function initialTimer(limit: number): TimerState {
  return { left: Math.max(0, limit), expired: null };
}

/**
 * Un passo di tempo (spec §8). Il tempo scorre sempre, anche durante un
 * incidente. Quando arriva a zero parte la decelerazione di GAMEOVER_DECEL_S,
 * finita la quale `gameOver` è vero una volta sola. Pura.
 */
export function stepTimer(state: TimerState, dt: number): { state: TimerState; gameOver: boolean } {
  if (state.expired !== null) {
    const expired = state.expired + dt;
    const fired =
      state.expired + TIME_EPSILON < GAMEOVER_DECEL_S && expired + TIME_EPSILON >= GAMEOVER_DECEL_S;
    return { state: { left: 0, expired }, gameOver: fired };
  }
  const left = state.left - dt;
  if (left > TIME_EPSILON) return { state: { left, expired: null }, gameOver: false };
  return { state: { left: 0, expired: 0 }, gameOver: false };
}

/** Velocità durante la decelerazione di fine tempo: a zero in GAMEOVER_DECEL_S (spec §8). Pura. */
export function expiredSpeed(startSpeed: number, expired: number): number {
  const left = 1 - expired / GAMEOVER_DECEL_S;
  return left <= TIME_EPSILON ? 0 : startSpeed * left;
}

/** Scala di un banner a tempo; si ferma a zero. Pura. */
export function stepBannerClock(left: number, dt: number): number {
  const next = left - dt;
  return next <= TIME_EPSILON ? 0 : next;
}
