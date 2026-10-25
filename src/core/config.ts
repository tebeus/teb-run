// Nome, dominio e link del gioco, in un posto solo: se il nome cambia, si
// cambia qui. Il codice nuovo non scrive il nome a mano.

export const GAME_NAME = 'TEB RUN';

/** Dominio del sito, anche per la scheda del risultato da condividere. */
export const SITE_DOMAIN = 'tebrun.io';
export const SITE_URL = `https://${SITE_DOMAIN}`;
/** Dove gira la build site. */
export const PLAY_URL = `https://play.${SITE_DOMAIN}`;

export const PRIVACY_URL = `${SITE_URL}/privacy/`;
export const ABOUT_URL = `${SITE_URL}/about/`;
/**
 * L'API della classifica mondiale e della sfida (Worker `api/`). Solo la
 * build site. Scritta per intero, non da `SITE_DOMAIN`: così il bundler la
 * lascia in chiaro e `check:builds` la trova (un test la lega al dominio).
 */
export const API_ORIGIN = 'https://api.tebrun.io';
/** L'API di `wrangler dev` (cartella `api/`), per la build privata e `npm run dev`. */
export const DEV_API_ORIGIN = 'http://localhost:8787';

/**
 * Statistiche senza cookie (lancio, punto 11): GoatCounter, sito `tebrun`.
 * Partono solo nella build site (`FEATURES.stats`, vedi target.ts) e solo se
 * questo interruttore è acceso: `false` le spegne anche lì, senza toccare
 * altro. L'origine è l'unica concessa in più dalla CSP della build site
 * (connect-src e img-src, vedi `cspForTarget` in vite.config.ts).
 */
export const STATS_ENABLED = true;
export const STATS_ORIGIN = 'https://tebrun.goatcounter.com';
export const STATS_ENDPOINT = `${STATS_ORIGIN}/count`;
