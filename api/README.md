# TEB RUN API (Worker Cloudflare + D1)

Classifica mondiale, sfida giornaliera e pagina pubblica di TEB RUN.
Spec: `docs/superpowers/specs/2026-10-25-classifica-e-sfida.md`.

| Rotta | Cosa fa | CORS | Cache |
|---|---|---|---|
| `POST /score` | `{ initials, score, mode, car, stageId, route, ending, durationMs, daily? }` → `{ rank, total }` | `ALLOWED_ORIGINS` (il gioco) | no |
| `GET /top?mode=normal\|hard&board=today\|alltime\|daily` | `{ rows: [{ initials, score, car, stageId, ending }] }`, al massimo 10 | `ALLOWED_ORIGINS` | 60 s |
| `GET /daily` | la sfida di oggi, il campione e la top 3 di ieri, la top 3 di oggi (JSON) | `*` | 5 min |
| `GET /daily.txt` | le stesse cose in 3 righe di inglese | `*` | 5 min |
| `GET /admin` | moderazione: ultime 100 righe, nascondi o mostra, rifiuti degli ultimi 14 giorni | Cloudflare Access | no |

Gli errori sono `400`, `403`, `404`, `405`, `429` o `500`, sempre con il corpo vuoto.

Nessun IP viene salvato, né in chiaro né come hash. Il limite di richieste
(6 POST e 60 GET al minuto per indirizzo) lo tiene Cloudflare solo in memoria.

I controlli sulle partite stanno in `src/shared/validate.ts`:
- i limiti vengono dalle regole del gioco, attraverso `src/shared/limits.ts`, che `npm run gen:limits` rigenera;
- per i giorni, la regola della sfida è in `src/shared/daily.ts`;
- per le iniziali, la lista di blocco è in `src/shared/initials.ts`.

Ogni partita rifiutata conta +1 nella tabella `rejections`, divisa per giorno
e per motivo, senza nessun dato della partita.

## In locale

Tutti i comandi si danno dalla cartella `api/`.

```sh
npm install
npm run db:local          # crea il D1 locale (.wrangler/) con le migrazioni
npm run dev               # wrangler dev su http://localhost:8787
node tools/smoke.mjs      # una partita normale, una DAILY, una rifiutata; legge /top, /daily, /daily.txt
```

Il gioco parla con l'API locale solo nella build di sviluppo, aperta con
`?board=local`, per esempio `http://localhost:5173/?board=local`. `npm run dev`
accetta le richieste da `http://localhost:5173`.

Per lanciare i test dalla radice del progetto:

```sh
npm run test:api
```

I test girano in workerd con un D1 locale, e alla fine c'è anche `tsc`.

## Deploy

Il deploy lo fa il Claude del lancio insieme a Teb, sull'account Cloudflare
del progetto.

1. **Database.**
   ```sh
   cd api
   npx wrangler login
   npx wrangler d1 create tebrun-scores
   ```
   Copia il `database_id` stampato in `wrangler.toml` (oggi è tutto zeri).
   ```sh
   npx wrangler d1 migrations apply tebrun-scores --remote
   ```
2. **Cloudflare Access** (Zero Trust, team `holy-sun-a1da`).
   - Crea una Self-hosted application "TEB RUN admin":
     - dominio `api.tebrun.io`, percorso `admin*`;
     - policy Allow con le email di Teb, scritte solo nel pannello e mai nel codice.
   - Copia l'"Application Audience (AUD) Tag" e salvalo come segreto:
     ```sh
     npx wrangler secret put ACCESS_AUD
     ```
3. **Worker.**
   ```sh
   npx wrangler deploy
   ```
   `wrangler.toml` crea da sé il dominio personalizzato `api.tebrun.io`, che sta sulla zona tebrun.io dello stesso account. `workers_dev` è spento.
4. **Controllo.**
   ```sh
   curl -i https://api.tebrun.io/daily
   curl https://api.tebrun.io/daily.txt
   curl -i https://api.tebrun.io/admin
   ```
   - `/daily` deve rispondere 200 con `Access-Control-Allow-Origin: *`.
   - `/admin` senza login deve rispondere col redirect di Access, oppure 403.
   - `node tools/smoke.mjs https://api.tebrun.io` manda due partite di prova `TST`, che poi si nascondono da `/admin`.
5. **Gioco.** Fai il deploy della build `site` (`npm run build:site`, poi Cloudflare Pages). Il suo `_headers` ha già `https://api.tebrun.io` in `connect-src`. Le build `portal` e `crazygames` non cambiano comportamento: non chiamano l'API.

## Ridistribuzione dopo la prima tappa a 110 s (binario M)

La 0-0 di NORMAL è passata da 80 a 110 s: 30 s in più per la prima tappa. Se ne
riportano alla 1-0 i primi `FIRST_STAGE_EXTRA_CARRY_S` rimasti (15), più tutto quello
che supera i 30 (`src/game/timer.ts`; binario N). La tabella `src/shared/limits.ts` è
rigenerata (`limit.normal` 110, `extra.normal` `{ seconds: 30, carried: 15 }` per la
0-0), quindi **il Worker va ridistribuito prima del gioco**:

```sh
cd api
npx wrangler deploy
```

Poi la build `site`. In quest'ordine nessuna partita vera viene rifiutata:

- il Worker nuovo accetta anche le partite dei client vecchi, perché i suoi limiti sono più larghi;
- il Worker vecchio rifiuterebbe come `duration` le partite lunghe del gioco nuovo, per esempio un game over alla
  1-1 dopo 180 s (oggi il massimo è 154).

Nessuna migrazione D1. Se un giorno si cambia `FIRST_STAGE_EXTRA_CARRY_S`, si rilancia
`npm run gen:limits` e si ridistribuisce il Worker allo stesso modo: la durata
massima non cambia, cambia solo il tetto del punteggio.

### Binario N: riporto di 15 s (30 ottobre)

Rispetto a b43850d cambia solo il tetto del punteggio, che sale: il Worker va
ridistribuito **prima** del gioco, altrimenti il Worker vecchio rifiuterebbe come
`score` le partite buone del gioco nuovo. La durata massima resta la stessa
(game over alla 1-1: 184 s).

## Esempio di `/daily`

```json
{
  "date": "2026-10-25",
  "challenge": { "car": "sport", "mode": "hard" },
  "nextChallengeInMinutes": 411,
  "yesterday": {
    "date": "2026-10-24",
    "challenge": { "car": "super", "mode": "hard" },
    "champion": { "initials": "ABC", "score": 812345, "car": "super" },
    "top3": [
      { "initials": "ABC", "score": 812345, "car": "super" },
      { "initials": "XYZ", "score": 640120, "car": "super" },
      { "initials": "TEB", "score": 598004, "car": "super" }
    ]
  },
  "today": { "top3": [{ "initials": "QQQ", "score": 120400, "car": "sport" }] }
}
```

`/daily.txt`:

```
TEB RUN daily challenge 2026-10-25: SPORT, HARD mode. Same traffic for everyone.
Yesterday's champion: ABC with 812,345 (SUPER).
Today so far: 1. QQQ 120,400 · 2. — · 3. —
```

- Quando ieri non ha giocato nessuno, `champion` è `null` e `top3` è `[]`.
- Le righe nascoste o con iniziali bloccate non escono mai.
- `nextChallengeInMinutes` è solo un'indicazione, perché la cache la invecchia fino a 5 minuti.
- Il riquadro "Today's run" del sito può leggere `/daily` direttamente dal browser.
