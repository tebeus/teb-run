// Le iniziali della classifica mondiale (spec classifica e sfida, §2.4).
// Codice comune a client e Worker, puro. Tre lettere `A-Z` e basta: niente
// cifre, quindi niente varianti come `F4K` da bloccare, perché la forma le
// rifiuta prima della lista (e `nameEntry` offre solo lettere).
//
// La lista blocca combinazioni offensive in inglese, italiano, francese,
// olandese, tedesco e spagnolo, comprese le grafie fonetiche più comuni. Non
// è completa e non vuole esserlo: la moderazione vera è la colonna `hidden`
// del server. Il client la usa per dire subito "TRY OTHER LETTERS", il
// server per rifiutare, e `/daily` la riapplica in uscita, così una voce
// aggiunta qui dopo vale anche per le righe già salvate.

/** Forma delle iniziali. */
export const INITIALS_RE = /^[A-Z]{3}$/;

/** Combinazioni rifiutate, in ordine alfabetico (un test lo controlla). */
export const BLOCKED_INITIALS: readonly string[] = [
  'ANL', // en
  'ANS', // en
  'ARS', // de (Arsch)
  'ASS', // en
  'CAZ', // it
  'CBR', // es (cabrón)
  'CNO', // es (coño)
  'CNT', // en
  'COC', // en
  'COK', // en
  'CUL', // it, fr, es
  'CUM', // en
  'CZO', // it
  'CZZ', // it
  'DCK', // en
  'DIC', // en
  'DIK', // en
  'ENC', // fr (enculé)
  'FAG', // en
  'FAP', // en
  'FCK', // en
  'FDP', // fr (fils de pute)
  'FIC', // de (ficken)
  'FIK', // de
  'FKN', // en
  'FKU', // en
  'FRC', // it (frocio)
  'FUC', // en
  'FUK', // en
  'FUQ', // en
  'GVD', // nl (godverdomme)
  'HDP', // es (hijo de puta)
  'HOR', // nl (hoer)
  'HTL', // en, de (Hitler)
  'HUR', // de (Hure)
  'JDR', // es (joder)
  'JIZ', // en
  'KKK', // en
  'KKR', // nl (kanker)
  'KUM', // en
  'KUT', // nl
  'KYS', // en (kill yourself)
  'LUL', // nl
  'MRD', // it (merda), fr, es
  'NAZ', // en, de
  'NGA', // en
  'NGR', // en
  'NIG', // en
  'NTM', // fr (nique ta mère)
  'ORT', // es (orto)
  'PIK', // nl
  'PIS', // en
  'PNS', // en
  'PTA', // es (puta), it
  'PUT', // it (puttana), fr, es
  'SEX', // en
  'SHT', // en
  'SPC', // en
  'SUK', // en
  'TIT', // en
  'TRO', // it (troia)
  'TWT', // en
  'TYF', // nl (tyfus)
  'VAG', // en
  'VRG', // es (verga)
  'WTF', // en
  'XXX', // en
];

const BLOCKED = new Set(BLOCKED_INITIALS);

/** Tre lettere A-Z. Pura. */
export function validInitials(value: unknown): value is string {
  return typeof value === 'string' && INITIALS_RE.test(value);
}

/** Vero se la combinazione è nella lista di blocco. Pura. */
export function blockedInitials(value: string): boolean {
  return BLOCKED.has(value);
}

/** Iniziali accettabili: nella forma giusta e non bloccate. Pura. */
export function initialsOk(value: unknown): boolean {
  return validInitials(value) && !blockedInitials(value);
}
