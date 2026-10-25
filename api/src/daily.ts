// La pagina pubblica in sola lettura (spec §4): `/daily` in JSON e
// `/daily.txt` in tre righe di inglese, per il bot di Instagram e per il
// riquadro "Today's run" del sito. Solo righe non nascoste, solo iniziali
// che passano la lista di blocco; niente orari precisi, niente id.

import { addDays, dailyChallenge, dailyKey, msToNextDaily } from '../../src/shared/daily';
import { topRows, type PublicRow } from './db';

export interface DailyRow {
  initials: string;
  score: number;
  car: string;
}

export interface DailyPage {
  date: string;
  challenge: { car: string; mode: string };
  nextChallengeInMinutes: number;
  yesterday: { date: string; challenge: { car: string; mode: string }; champion: DailyRow | null; top3: DailyRow[] };
  today: { top3: DailyRow[] };
}

const short = (r: PublicRow): DailyRow => ({ initials: r.initials, score: r.score, car: r.car });

export async function dailyPage(db: D1Database, now: Date): Promise<DailyPage> {
  const today = dailyKey(now);
  const yesterday = addDays(today, -1);
  const c = dailyChallenge(today);
  const y = dailyChallenge(yesterday);
  const [yTop, tTop] = await Promise.all([topRows(db, 'daily', y.mode, yesterday, 3), topRows(db, 'daily', c.mode, today, 3)]);
  return {
    date: today,
    challenge: { car: c.car, mode: c.mode },
    nextChallengeInMinutes: Math.floor(msToNextDaily(now) / 60000),
    yesterday: {
      date: yesterday,
      challenge: { car: y.car, mode: y.mode },
      champion: yTop.length > 0 ? short(yTop[0]) : null,
      top3: yTop.map(short),
    },
    today: { top3: tTop.map(short) },
  };
}

const n = (score: number): string => score.toLocaleString('en-US');

/** Le stesse cose in tre righe, pronte da copiare. Pura. */
export function dailyText(page: DailyPage): string {
  const c = page.challenge;
  const line1 = `TEB RUN daily challenge ${page.date}: ${c.car.toUpperCase()}, ${c.mode.toUpperCase()} mode. Same traffic for everyone.`;
  const champ = page.yesterday.champion;
  const line2 = champ
    ? `Yesterday's champion: ${champ.initials} with ${n(champ.score)} (${champ.car.toUpperCase()}).`
    : "Yesterday's champion: nobody yet.";
  const slots = [0, 1, 2].map((i) => {
    const r = page.today.top3[i];
    return `${i + 1}. ${r ? `${r.initials} ${n(r.score)}` : '—'}`;
  });
  const line3 = `Today so far: ${slots.join(' · ')}`;
  return `${line1}\n${line2}\n${line3}\n`;
}
