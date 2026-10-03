# Brani personali

Metti qui i tuoi file audio (`.mp3`, `.ogg`, `.m4a`, `.wav`, `.flac`) e poi esegui:

    python3 tools/process-audio.py --music

Il comando scrive `manifest.json` in questa cartella, e i brani compaiono nella radio
del gioco dopo i tre brani originali, con il titolo ricavato dal nome del file
(`night_drive.mp3` → `Night Drive`). Al massimo 32 brani; oltre, vengono ignorati in
ordine alfabetico.

Se il gioco è già aperto, ricarica la pagina dopo aver eseguito il comando: il
manifest si legge una sola volta, al primo sblocco dell'audio, quindi un file
aggiunto a partita già in corso non compare finché la pagina non viene ricaricata.

Senza `manifest.json` la radio mostra solo i tre brani originali: non è un errore.

**Questi file sono tuoi.** Il repository li ignora (vedi `.gitignore`), il gioco li
legge solo dal tuo disco e non li distribuisce, e la responsabilità dei diritti su
quello che metti qui è tua. TEB RUN non spedisce nessun brano di terze parti: i tre
originali sono composizioni scritte per il gioco, i campioni sono CC0 (vedi
`docs/CREDITS.md`).
