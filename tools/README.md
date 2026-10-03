# tools/process-sprites.py

Prepara i PNG generati con AI (`art/raw/`) per il gioco (`public/sprites/`).
Serve solo Python 3 e Pillow:

    python3 -m pip install pillow

`rembg` è opzionale e migliora la rimozione degli sfondi dipinti:

    python3 -m pip install rembg onnxruntime

Se `rembg` non è importabile il tool usa il riempimento per palette del bordo,
che sui materiali attuali funziona (vedi «Limiti» in fondo).

## Uso

    python3 tools/process-sprites.py                 # tutto: file singoli e fogli
    python3 tools/process-sprites.py --mirror        # rende ciclici gli sfondi bg_*
    python3 tools/process-sprites.py --only traffic_van beach_palm_1
    python3 tools/process-sprites.py --no-sheets
    python3 tools/process-sprites.py --raw art/raw --out public/sprites

Opzioni: `--raw`, `--out`, `--targets`, `--sheets-dir`, `--only`, `--mirror`,
`--no-sheets`, `--quiet`. Esce con 1 se qualche sprite è fallito, con 2 se non
si riesce a leggere `sprite-targets.json`.

Test del tool:

    python3 -m unittest discover -s tools -p 'test_*.py'

## Cosa fa, in ordine

1. **Rimozione dello sfondo** (spec §13), primo che si applica:
   alfa già presente → chroma key `#00FF00` se almeno tre angoli sono verdi →
   `rembg` se installato → riempimento dai bordi sui colori dominanti del bordo.
   Eccezione: un file singolo il cui nome inizia con `ending_` usa sempre
   `background: "keep"`, perché è un'illustrazione a piena tela senza alfa —
   il riempimento dai bordi la tratterebbe come uno sfondo da svuotare e la
   distruggerebbe. Questo non vale per `bg_*`, dove il riempimento è
   esattamente ciò che rende il cielo trasparente.
2. **Isolamento**, secondo il nome: per gli sprite normali tiene solo la
   componente connessa più grande, così le scaglie e i pezzi dei vicini
   spariscono; per `title_logo` butta via solo le componenti sotto lo 0,05%
   dei pixel (le barre di velocità sono staccate dalle lettere e vanno
   tenute); per `bg_*` e `ending_*` non tocca niente, ogni parte conta.
3. **Ritaglio** della trasparenza.
4. **Strip**: se il target ha `frames > 1`, divide per colonne trasparenti (e
   in parti uguali se non trova i vuoti), porta ogni frame nella sua cella
   appoggiato in basso e riaffianca i frame: il PNG finale è
   `w * frames` per `h` e il manifest riporta `frames`.
5. **Specchiatura** con `--mirror`, solo per `bg_*`: affianca l'immagine al
   suo specchio, così il bordo destro combacia col sinistro.
6. **Scala** dentro il riquadro di `tools/sprite-targets.json` conservando le
   proporzioni (LANCZOS). Non si aggiunge margine: il PNG finale è grande
   quanto l'oggetto, e il motore lo dimensiona con `catalog.scale`.
7. **Manifest**: riscrive `public/sprites/manifest.json` unendo le voci nuove
   e togliendo quelle il cui PNG non esiste più.

## Opzioni di una voce di `sprite-targets.json`

Oltre a `w`, `h` e `frames`, una voce può dire:

- `"trim": false`: il PNG è consegnato già alla misura esatta, margini
  trasparenti compresi, e si tiene intero: niente ritaglio, niente
  specchio con `--mirror`, niente ritaglio dei frame di una strip. Serve
  alle cinque `bg_*_clouds` e a `bg_desert_near` della consegna B (i bordi
  vuoti tengono la cucitura e la quota nel cielo; specchiarle metterebbe
  una giunzione simmetrica in mezzo) e a `npc_seagull` (tre celle da 90×60
  alla stessa scala: ritagliate una per una pulsavano).
- `"background": "keep"` (o `"auto"`, o `"#rrggbb"`): forza la rimozione
  dello sfondo come `background` di un foglio. `wall_rock_grey` è una
  tessera piena senza trasparenza: il riempimento dai bordi la bucava.
- `"group": "<nome>"`: i file con lo stesso gruppo sono frame dello stesso
  oggetto e si lavorano insieme. Ognuno si isola e si ritaglia sul proprio
  contenuto, si appoggia in basso in un riquadro alto quanto il frame più
  alto del gruppo, e tutti si scalano dello **stesso** fattore: escono alti
  `h` (o meno, se il più largo supererebbe `w`) e l'oggetto non cambia
  misura da un frame all'altro. È così che i dieci `player_*` del Set 7
  diventano sprite (spec §4.4 punto 5: l'auto non cresce quando sterza).
  Con `--only` basta nominare un frame: il gruppo si rifà intero.

Un file singolo vince sempre sulla cella di un foglio con lo stesso nome:
i fogli sono le consegne vecchie (`player_set3`, `sheet_clean`,
`cars_italian`, `set2_*`), i file singoli quelle che le sostituiscono, e
senza questa regola rilanciare il tool con i fogli presenti rimetterebbe
le immagini vecchie.

Nomi dei file: lo stem del PNG in `art/raw/` deve essere una chiave di
`tools/sprite-targets.json` (i nomi sono in `docs/sprites/PROMPTS.md`). I file
che iniziano con `_` sono ignorati, così `_stylesheet.png` non dà fastidio.

## Fogli con più oggetti

Un foglio è `art/raw/sheets/<nome>.png` più una configurazione in
`art/raw/sheets/<nome>.json` oppure in `tools/sheets/<nome>.json`.

```json
{
  "background": "auto",
  "ignoreAt": [[1230, 200]],
  "groups": [
    {
      "box": [20, 10, 1460, 143],
      "target": "player_strip_turn",
      "cuts": [30, 221, 441, 650, 790, 969, 1082, 1279, 1450],
      "names": ["player_straight", "player_left1", "..."]
    }
  ]
}
```

- `background`: `"auto"` (la catena qui sopra), `"keep"` (l'alfa c'è già),
  oppure `"#rrggbb"` per forzare un chroma key.
- `ignoreAt`: punti su oggetti da buttare via prima di tutto. Cancella la
  **componente connessa** che contiene il punto, non un rettangolo: serve per
  i pezzi che si sovrappongono ad altri oggetti.
- `groups` (forma esplicita): `box` è la regione del foglio con `x1`/`y1`
  esclusi; `cuts` sono i confini in x delle celle, `names + 1` valori; `names`
  elenca le celle da sinistra a destra; `_skip` butta via una cella;
  `target` è la voce di `sprite-targets.json` da usare per tutte le celle del
  gruppo (serve quando i nomi logici non sono nomi di file, come i frame del
  giocatore); `keepAll: true` non isola la componente più grande.
- `rows` (forma automatica della spec §13): solo `[["nome", "nome"], ["nome"]]`.
  Il tool cerca le componenti connesse del foglio, le raggruppa in righe per
  centro verticale e le ordina per x. Se il numero di righe o di oggetti per
  riga non torna, l'errore elenca i box trovati e non scrive niente. È la
  forma usata da `tools/sheets/cars_italian.json`. Usa `groups` quando le
  righe si sovrappongono in verticale o gli oggetti si toccano, come in
  `tools/sheets/sheet_clean.json`.
- `minArea`: area minima in pixel di una componente (default 400).

Esattamente uno fra `groups` e `rows`.

## Limiti conosciuti

- Il riempimento per palette entra nel soggetto se il soggetto tocca il bordo
  dell'immagine con un colore che è anche dello sfondo, e lascia residui se lo
  sfondo ha più di quattro colori dominanti. Per gli sfondi dipinti difficili
  conviene installare `rembg`, o chiedere al modello `solid flat #00FF00
  chroma green background`.
- `art/raw/sheets/sheet_clean.png` ha già un canale alfa buono, quindi la
  catena si ferma al primo passo. Il rilevamento automatico delle righe su
  quel foglio **non** funziona (le prime tre righe formano un'unica fascia
  opaca e chalet, staccionata e roccia si toccano tramite l'erba dipinta):
  `tools/sheets/sheet_clean.json` usa per questo la forma `groups`.
- Gli oggetti del foglio sono piccoli rispetto ai target
  (`sprite-targets.json`): il tool avvisa con `WARN ... ingrandimento 3.8x`.
  È solo un avviso, i PNG vengono scritti, ma per la qualità finale conviene
  rigenerare i soggetti importanti come immagini singole grandi.

# tools/process-audio.py

Prepara i campioni CC0 di `art/audio-raw/` per il gioco (`public/audio/`). Serve solo
Python 3; `ffmpeg` è opzionale e serve per scrivere OGG invece di WAV.

    python3 tools/process-audio.py                  # i nove campioni + manifest
    python3 tools/process-audio.py --music          # manifest dei brani personali
    python3 tools/process-audio.py --out /tmp/audio # altra destinazione

Cosa fa, in ordine: legge il WAV (mono, 16 bit; i file stereo si mediano), applica ai
due loop del motore un crossfade di 80 ms fra coda e testa (il punto di loop non si
sente più, e il file si accorcia di 80 ms), normalizza il picco a −3 dBFS, scrive un WAV
temporaneo, lo converte in OGG Vorbis q6 e lo cancella. Alla fine riscrive
`public/audio/manifest.json`, che è ciò che `src/audio/samples.ts` legge: senza manifest
il gioco non trova nessun campione e suona tutto sintetico, che è un ripiego previsto,
non un errore.

Con `--music` non tocca l'audio: elenca i file di `public/music/custom/` con estensione
audio, ne ricava il titolo dal nome (`night_drive.mp3` → `Night Drive`), li ordina per
nome di file, ne tiene al massimo 32 e scrive `manifest.json` lì dentro.

Esce con 1 se qualche campione è fallito. Test:

    python3 -m unittest discover -s tools -p 'test_*.py'
