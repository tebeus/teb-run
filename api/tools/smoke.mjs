// Prova a mano del Worker: `npm run dev` in un terminale, poi
// `node tools/smoke.mjs [base]` (default http://localhost:8787). Manda una
// partita normale e una della sfida di oggi (auto e modo letti da /daily),
// poi legge /top, /daily e /daily.txt. Contro il Worker vero si passa
// https://api.tebrun.io: allora le partite di prova restano in classifica
// finché non le si nasconde dall'admin.

const base = process.argv[2] ?? 'http://localhost:8787';
const origin = base.startsWith('http://localhost') ? 'http://localhost:5173' : 'https://play.tebrun.io';
const show = async (label, res) => console.log(`${label}: ${res.status} ${await res.text()}`);

const run = { initials: 'TST', score: 200000, mode: 'normal', car: 'retro', stageId: '4-2', route: 'RLRL', ending: 3, durationMs: 385000 };
const post = (body) => fetch(`${base}/score`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });

await show('POST /score (normal)', await post(run));
const daily = await (await fetch(`${base}/daily`)).json();
await show('POST /score (daily)', await post({ ...run, car: daily.challenge.car, mode: daily.challenge.mode, daily: daily.date, durationMs: daily.challenge.mode === 'hard' ? 380000 : 385000, score: 90000 }));
await show('POST /score (too high)', await post({ ...run, score: 7300000 }));
await show('GET /top today', await fetch(`${base}/top?mode=normal&board=today`, { headers: { Origin: origin } }));
await show(`GET /top daily`, await fetch(`${base}/top?mode=${daily.challenge.mode}&board=daily`, { headers: { Origin: origin } }));
await show('GET /daily', await fetch(`${base}/daily`));
await show('GET /daily.txt', await fetch(`${base}/daily.txt`));
