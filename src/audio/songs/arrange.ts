// Sugar per scrivere le righe di `Song.order`: 48 battute per canale sono
// troppe da rileggere a mano, e una riga di lunghezza sbagliata è un errore
// che `validateSong` segnala ma che nessuno vuole cercare a occhio. Modulo
// puro: nessun DOM, nessun Web Audio.

/** Ripete la sequenza di battute `bars` per `times` volte. Pura. */
export function repeat(bars: readonly number[], times: number): number[] {
  if (!Number.isInteger(times) || times < 0) throw new Error(`repeat: times ${times} non è un intero >= 0`);
  const out: number[] = [];
  for (let i = 0; i < times; i++) out.push(...bars);
  return out;
}

/** Concatena le sezioni di un brano in un'unica riga di `order`. Pura. */
export function sections(...parts: readonly (readonly number[])[]): number[] {
  const out: number[] = [];
  for (const part of parts) out.push(...part);
  return out;
}
