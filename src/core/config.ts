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
 * Statistiche senza cookie (lancio, punto 11): GoatCounter, sito `tebrun`.
 * Partono solo nella build site (`FEATURES.stats`, vedi target.ts) e solo se
 * questo interruttore è acceso: `false` le spegne anche lì, senza toccare
 * altro. L'origine è l'unica concessa in più dalla CSP della build site
 * (connect-src e img-src, vedi `cspForTarget` in vite.config.ts).
 */
export const STATS_ENABLED = true;
export const STATS_ORIGIN = 'https://tebrun.goatcounter.com';
export const STATS_ENDPOINT = `${STATS_ORIGIN}/count`;
