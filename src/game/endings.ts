import { ENDING_COUNT } from './stage-graph';

/** Riesportato: il conteggio dei finali è di `game/stage-graph.ts`, non se ne fa un secondo. */
export { ENDING_COUNT };

/**
 * I 5 finali (spec §9, §11). Testi originali nostri, in inglese maiuscolo come
 * il resto dell'interfaccia. L'indice corrisponde all'indice `i` della tappa di
 * livello 4 raggiunta, e lo sprite è `ending_${indice + 1}` (README, decisioni).
 */
export interface EndingDef {
  /** 0..4. */
  index: number;
  /** Riga grande in cima al testo che scorre. */
  title: string;
  /** Righe del testo che scorre, dall'alto in basso. */
  lines: readonly string[];
}

export const ENDINGS: readonly EndingDef[] = [
  {
    index: 0,
    title: 'MARBLE SQUARE',
    lines: [
      'THE CROWD ROARS ACROSS THE OLD SQUARE.',
      'YOU RAISE THE TROPHY OVER YOUR HEAD.',
      'CONFETTI FALLS LIKE COLORED RAIN.',
      'THE MARBLE STEPS SHAKE WITH CHEERS.',
    ],
  },
  {
    index: 1,
    title: 'SUNSET COVE',
    lines: [
      'YOU PARK THE CAR ON THE SOFT SAND.',
      'THE LAKE TURNS GOLD AS THE SUN DROPS.',
      'YOU SHARE BREAD ON THE WARM HOOD.',
      'PALMS LEAN OVER THE STILL WATER.',
    ],
  },
  {
    index: 2,
    title: 'HARBOUR LIGHTS',
    lines: [
      'FIREWORKS BLOOM OVER THE DARK HARBOUR.',
      'THE BOATS ROCK GENTLY AT THEIR ROPES.',
      'YOU TWO DANCE BESIDE THE COOLING ENGINE.',
      'THE SKY KEEPS BURSTING INTO COLOR.',
    ],
  },
  {
    index: 3,
    title: 'ROADSIDE STEAM',
    lines: [
      'THE HOOD POPS OPEN WITH A LOUD HISS.',
      'STEAM ROLLS UP INTO THE EMPTY AIR.',
      'THE MECHANIC WAVES HIS ARMS AND SHOUTS.',
      'YOU TWO CANNOT STOP LAUGHING.',
    ],
  },
  {
    index: 4,
    title: 'GOLDEN SHORELINE',
    lines: [
      'YOU SIT TOGETHER ON THE WARM HOOD.',
      'THE SUN SINKS BEHIND THE PALM LINE.',
      'THE TIDE PULLS BACK ACROSS THE SAND.',
      'NEITHER OF YOU WANTS TO DRIVE AWAY.',
    ],
  },
];

/** Riporta un indice qualsiasi dentro 0..4: il payload della schermata non è fidato. */
export function clampEndingIndex(index: number): number {
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(ENDING_COUNT - 1, Math.trunc(index)));
}

/**
 * Finale per indice: un indice fuori scala (ma finito) ricade sull'ultimo
 * finale, come fa `clampEndingIndex`; solo un indice non finito ricade sul primo.
 */
export function endingDef(index: number): EndingDef {
  return ENDINGS[clampEndingIndex(index)];
}

/** Nome dello sprite illustrativo: `ending_1`..`ending_5` (README, decisioni). */
export function endingSprite(index: number): string {
  return `ending_${clampEndingIndex(index) + 1}`;
}
