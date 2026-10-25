// I due tipi che client e Worker condividono (auto e modalità), qui perché il
// Worker non debba importare `src/types.ts`, che porta con sé canvas e audio.
// `src/types.ts` li riesporta: nel gioco si importano da lì come sempre.

/**
 * Quale auto guida il giocatore: la cabrio nuova del Set 7 (`player_*`),
 * quella classica di prima (`player_classic_*`), la retrò
 * (`player_retro_*`), la sportiva (`player_sport_*`) o la supercar rossa
 * (`player_super_*`). Si sceglie nella radio con il tasto C.
 */
export type CarChoice = 'new' | 'classic' | 'retro' | 'sport' | 'super';

/**
 * Modalità di gioco (collaudo utente: due livelli di difficoltà). `normal`
 * è la taratura di sempre; `hard` ha più traffico, un po' più veloce, e i
 * suoi tempi per tappa. Si sceglie nella radio con il tasto D.
 */
export type Difficulty = 'normal' | 'hard';
