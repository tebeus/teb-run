import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { GAME_NAME, STATS_ORIGIN } from './src/core/config.ts';
import type { Target } from './src/core/target.ts';

/**
 * Quattro build dallo stesso codice, scelte dal mode di Vite: `private`,
 * `site`, `portal`, `crazygames`. `development` (`npm run dev`) vale private, `production` (un
 * `vite build` senza mode) vale site. Un mode ignoto ferma la build.
 */
export function targetOfMode(mode: string): Target {
  switch (mode) {
    case 'development':
    case 'private':
      return 'private';
    case 'production':
    case 'site':
      return 'site';
    case 'portal':
      return 'portal';
    case 'crazygames':
      return 'crazygames';
    default:
      throw new Error(`unknown Vite mode "${mode}": use private, site, portal or crazygames`);
  }
}

export const OUT_DIRS: Record<Target, string> = {
  private: 'dist',
  site: 'dist-site',
  portal: 'dist-portal',
  crazygames: 'dist-crazygames',
};

/**
 * Se il file `rel` di public/ (percorso relativo, con `/`) va nella build di
 * `target`. La privata porta tutto. Le build pubbliche (site, portal,
 * crazygames) non portano l'auto classica (`player_classic_*`,
 * `ending_classic_*`) né i brani personali di public/music/custom/, che sono dell'utente e non del gioco: di quella
 * cartella resta solo un manifest vuoto, scritto da `publicForTarget`.
 * `_headers` (Cloudflare Pages) serve solo al sito proprio. Pura.
 */
export function publicFileAllowed(rel: string, target: Target): boolean {
  if (target === 'private') return true;
  if (rel === '_headers') return target === 'site';
  if (/classic/i.test(rel)) return false;
  if (rel.startsWith('music/custom/')) return false;
  return true;
}

/**
 * La CSP della build crazygames: senza limiti sulle origini. L'SDK di
 * CrazyGames (`core/crazySdk.ts`) gira dentro l'iframe del gioco e, sul
 * portale, vi carica lo script delle pubblicità da un indirizzo che gli dà il
 * portale stesso (`loadAdsIfNeeded`), oltre a mandare le sue statistiche: con
 * `script-src 'self'` la pubblicità fra due partite non partirebbe mai.
 * Restano le due direttive che non toccano niente di tutto questo. Il gioco
 * stesso non carica niente da fuori tranne lo script dell'SDK: lo controlla
 * `check:builds` sui file della build.
 */
export const CRAZYGAMES_CSP = "object-src 'none'; base-uri 'self'";

/**
 * La CSP di `target` a partire da quella di index.html (`base`): la build site
 * aggiunge l'origine delle statistiche a connect-src (sendBeacon) e a img-src
 * (il ripiego con un'immagine), e a nient'altro; private e portal tengono
 * `base` così com'è. connect-src, se manca, parte da 'self' come il
 * default-src che sostituisce. Pura.
 */
export function cspForTarget(base: string, target: Target): string {
  if (target === 'crazygames') return CRAZYGAMES_CSP;
  if (target !== 'site') return base;
  const directives = base
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d !== '');
  for (const name of ['img-src', 'connect-src']) {
    const i = directives.findIndex((d) => d.split(/\s+/)[0] === name);
    if (i < 0) directives.push(`${name} 'self' ${STATS_ORIGIN}`);
    else if (!directives[i].split(/\s+/).includes(STATS_ORIGIN)) directives[i] = `${directives[i]} ${STATS_ORIGIN}`;
  }
  return directives.join('; ');
}

/**
 * Una pagina con la CSP del bersaglio nel <meta>. Senza <meta> le build site
 * e crazygames si fermano (index.html deve averlo); private e portal la lasciano com'è, così
 * le pagine di sviluppo (dev/*.html, senza CSP) restano servite. Pura.
 */
export function indexHtmlForTarget(html: string, target: Target): string {
  const re = /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")([^"]+)(")/;
  if (target !== 'site' && target !== 'crazygames') return html;
  if (!re.test(html)) throw new Error('index.html: no Content-Security-Policy meta tag');
  return html.replace(re, (_m, a: string, csp: string, b: string) => `${a}${cspForTarget(csp, target)}${b}`);
}

/** Il manifest degli sprite senza le voci che la build non porta. Pura. */
export function manifestForTarget(manifest: Record<string, { file?: string }>, target: Target): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest).filter(
      ([name, entry]) => publicFileAllowed(`sprites/${name}`, target) && publicFileAllowed(`sprites/${entry.file ?? ''}`, target),
    ),
  );
}

/**
 * Uno sprite PNG di public/sprites/ che nelle build pubbliche arriva come
 * WebP (punto 12 del lancio): i PNG restano la sorgente nel repo, nella build
 * c'è solo il .webp. Pura.
 */
export function shipsAsWebp(rel: string): boolean {
  return /^sprites\/[^/]+\.png$/.test(rel);
}

/** Il manifest con i file .png che puntano ai .webp della build. Pura. */
export function manifestToWebp(manifest: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(manifest).map(([name, entry]) => {
      const e = entry as { file?: string };
      const file = e.file ?? `${name}.png`;
      return [name, { ...e, file: file.endsWith('.png') ? `${file.slice(0, -4)}.webp` : file }];
    }),
  );
}

/**
 * Cache delle conversioni WebP, fuori da git (.gitignore): la prima build le
 * fa tutte (meno di un minuto), le altre le copiano.
 */
const WEBP_CACHE = '.cache/teb-webp';

/**
 * Converte i PNG `names` di `src` in WebP dentro `out`, con
 * tools/webp-sprites.py (Pillow). Senza Python o senza Pillow con WebP la
 * build si ferma: una build pubblica con i PNG supererebbe di molto i
 * 20 MB ammessi.
 */
function convertToWebp(src: string, out: string, names: string[]): void {
  if (names.length === 0) return;
  try {
    execFileSync('python3', ['tools/webp-sprites.py', src, out, WEBP_CACHE, ...names], {
      stdio: ['ignore', 'ignore', 'inherit'],
    });
  } catch (reason) {
    throw new Error(`WebP conversion failed (site and portal need python3 with Pillow built with WebP): ${String(reason)}`);
  }
}

/**
 * Copia di public/ per le build pubbliche, al posto di quella di Vite: gli stessi
 * file meno quelli che `publicFileAllowed` esclude, gli sprite in WebP invece
 * che in PNG, e un manifest degli sprite che non nomina più i file esclusi
 * (così il gioco non li chiede e non fa un 404) e punta ai WebP.
 */
function publicForTarget(target: Target): Plugin {
  return {
    name: 'public-for-target',
    apply: 'build',
    writeBundle(options) {
      const out = options.dir as string;
      const pub = 'public';
      cpSync(pub, out, {
        recursive: true,
        filter: (src) => {
          const rel = relative(pub, src).split(sep).join('/');
          return rel === '' || (publicFileAllowed(rel, target) && !shipsAsWebp(rel));
        },
      });
      const sprites = readdirSync(join(pub, 'sprites')).filter(
        (name) => shipsAsWebp(`sprites/${name}`) && publicFileAllowed(`sprites/${name}`, target),
      );
      convertToWebp(join(pub, 'sprites'), join(out, 'sprites'), sprites);
      const manifestPath = join(pub, 'sprites', 'manifest.json');
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, { file?: string }>;
      const shipped = manifestToWebp(manifestForTarget(manifest, target));
      writeFileSync(join(out, 'sprites', 'manifest.json'), `${JSON.stringify(shipped, null, 2)}\n`);
      mkdirSync(join(out, 'music', 'custom'), { recursive: true });
      writeFileSync(join(out, 'music', 'custom', 'manifest.json'), '[]\n');
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = targetOfMode(mode);
  return {
    // Percorsi relativi: la build gira alla radice come in una sottocartella
    // (itch.io e i portali la servono da un percorso qualunque). In sviluppo
    // BASE_URL resta '/'.
    base: './',
    define: { 'import.meta.env.VITE_TARGET': JSON.stringify(target) },
    server: { port: 5173, open: false },
    build: {
      target: 'es2022',
      outDir: OUT_DIRS[target],
      emptyOutDir: true,
      sourcemap: false,
      copyPublicDir: target === 'private',
    },
    plugins: [
      ...(target === 'private' ? [] : [publicForTarget(target)]),
      {
        name: 'game-name',
        transformIndexHtml: (html: string) => html.replace('%GAME_NAME%', GAME_NAME),
      },
      {
        // La CSP del <meta> per bersaglio: l'origine delle statistiche solo nella site.
        name: 'csp-for-target',
        transformIndexHtml: (html: string) => indexHtmlForTarget(html, target),
      },
    ],
  };
});
