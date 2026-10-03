// Controllo delle build pubbliche (site e portal): `npm run check:builds`.
// Le costruisce da sé in una cartella temporanea (nessuna build a mano
// prima), fa lo zip del portal come `npm run build:portal`, e fallisce se
// in una delle due c'è:
// - un file "classic" (l'auto classica è solo della build privata), o una
//   voce classic nel manifest degli sprite;
// - una source map, o un commento sourceMappingURL;
// - un percorso locale (/Users/, /home/, C:\Users\) o l'email di git di chi
//   costruisce, in qualunque file, PNG compresi;
// - un brano personale di public/music/custom/;
// - `_headers` mancante nella site, o presente nella portal;
// - più di 20 MB in tutto, o più di 8 MB scaricati prima del titolo (la fase
//   iniziale del caricamento, src/core/phases.ts).
// - una CSP sbagliata per le statistiche: nella site l'origine GoatCounter
//   deve stare in connect-src e img-src e in nient'altro; nella portal il
//   suo host non deve comparire in nessun file.
// Lo richiamano gli e2e (e2e/subfolder.spec.ts) e tests/wiring/builds.test.ts.
//
//   node tools/check-builds.mjs              costruisce in una cartella temporanea e la cancella
//   node tools/check-builds.mjs --keep DIR   costruisce in DIR/site e DIR/portal e la lascia
//   node tools/check-builds.mjs --existing   controlla dist-site/, dist-portal/ e dist-portal.zip già costruiti

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, zipDir, zipEntries } from './zip-build.mjs';
import { FIRST_STAGE, PHASE_CARS, isInitial } from '../src/core/phases.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PUBLIC_TARGETS = ['site', 'portal'];

/** Stringhe che non devono stare in nessun file costruito. */
export function forbiddenStrings() {
  const out = ['/Users/', '/home/', 'C:\\Users\\', ROOT.replace(/\/$/, '')];
  try {
    const email = execFileSync('git', ['config', 'user.email'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (email) out.push(email);
  } catch {
    // niente git o niente email: resta il controllo sui percorsi
  }
  return out;
}

/** Tetti di peso delle build pubbliche (lancio, punto 12), in byte (MB decimali). */
export const MAX_TOTAL_BYTES = 20_000_000;
export const MAX_INITIAL_BYTES = 8_000_000;

/**
 * Pesi della build in `dir`: `total` è tutto; `initial` è ciò che si scarica
 * prima del titolo, cioè ogni file che non è uno sprite più gli sprite della
 * fase iniziale (`isInitial` di src/core/phases.ts) con la prima tappa e
 * l'auto più pesante fra quelle della build (l'auto ricordata cambia la fase).
 */
export function buildWeights(dir) {
  const files = listFiles(dir);
  const size = (file) => statSync(join(dir, file)).size;
  const total = files.reduce((sum, file) => sum + size(file), 0);
  let manifest = {};
  try {
    manifest = JSON.parse(readFileSync(join(dir, 'sprites', 'manifest.json'), 'utf8'));
  } catch {
    // senza manifest nessuno sprite è chiesto: resta il resto
  }
  const spriteFiles = new Set(Object.entries(manifest).map(([key, entry]) => `sprites/${entry.file ?? `${key}.png`}`));
  const base = files.filter((file) => !spriteFiles.has(file)).reduce((sum, file) => sum + size(file), 0);
  let initial = base;
  for (const car of PHASE_CARS) {
    let bytes = base;
    for (const [key, entry] of Object.entries(manifest)) {
      const file = `sprites/${entry.file ?? `${key}.png`}`;
      if (files.includes(file) && isInitial(key, FIRST_STAGE, car)) bytes += size(file);
    }
    initial = Math.max(initial, bytes);
  }
  return { total, initial };
}

/** Problemi di peso: oltre i tetti. Pura. */
export function weightProblems({ total, initial }, maxTotal = MAX_TOTAL_BYTES, maxInitial = MAX_INITIAL_BYTES) {
  const mb = (n) => `${(n / 1e6).toFixed(2)} MB`;
  const out = [];
  if (total > maxTotal) out.push(`total ${mb(total)} over ${mb(maxTotal)}`);
  if (initial > maxInitial) out.push(`initial phase ${mb(initial)} over ${mb(maxInitial)}`);
  return out;
}

/** Problemi dei soli nomi di file (anche le voci di uno zip). Pura. */
export function nameProblems(files) {
  const out = [];
  for (const file of files) {
    if (/classic/i.test(file)) out.push(`classic file: ${file}`);
    if (file.endsWith('.map')) out.push(`source map: ${file}`);
    if (file.startsWith('music/custom/') && file !== 'music/custom/manifest.json') out.push(`personal track: ${file}`);
  }
  return out;
}

/** L'host delle statistiche (GoatCounter): solo nella build site. */
export const STATS_HOST = 'tebrun.goatcounter.com';

/**
 * Problemi della CSP del <meta> di index.html per `target`: nella site
 * l'origine delle statistiche sta in connect-src e img-src e in nessun'altra
 * direttiva; nella portal non c'è affatto. Pura.
 */
export function cspProblems(html, target) {
  const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)?.[1];
  if (csp === undefined) return ['no Content-Security-Policy meta in index.html'];
  const origin = `https://${STATS_HOST}`;
  const out = [];
  const directives = csp.split(';').map((d) => d.trim().split(/\s+/));
  for (const d of directives) {
    const has = d.slice(1).includes(origin);
    const allowed = target === 'site' && (d[0] === 'connect-src' || d[0] === 'img-src');
    if (has && !allowed) out.push(`CSP ${d[0]} names ${STATS_HOST}`);
  }
  if (target === 'site') {
    for (const name of ['connect-src', 'img-src']) {
      const d = directives.find((x) => x[0] === name);
      if (!d?.includes(origin)) out.push(`CSP ${name} lacks ${origin}`);
    }
  }
  if (target !== 'site' && csp.includes(STATS_HOST)) out.push(`CSP names ${STATS_HOST} outside the site build`);
  return [...new Set(out)];
}

/** Tutti i problemi della build in `dir`; con `target`, anche `_headers` solo nella site. */
export function checkBuild(dir, forbidden = forbiddenStrings(), target = null) {
  const files = listFiles(dir);
  const out = nameProblems(files);
  if (!files.includes('index.html')) out.push('no index.html');
  if (target === 'site' && !files.includes('_headers')) out.push('no _headers (Cloudflare Pages)');
  if (target === 'portal' && files.includes('_headers')) out.push('_headers in the portal build');
  if (target !== null && files.includes('index.html')) out.push(...cspProblems(readFileSync(join(dir, 'index.html'), 'utf8'), target));
  for (const file of files) {
    const bytes = readFileSync(join(dir, file));
    const text = bytes.toString('latin1');
    if (target === 'portal' && text.includes(STATS_HOST)) out.push(`${file} names ${STATS_HOST} in the portal build`);
    for (const needle of forbidden) {
      if (text.includes(needle)) out.push(`${file} contains ${needle.includes('@') ? 'the git email' : needle}`);
    }
    if (/\.(js|css|html)$/.test(file) && /sourceMappingURL/.test(text)) out.push(`sourceMappingURL in ${file}`);
  }
  try {
    const manifest = JSON.parse(readFileSync(join(dir, 'sprites', 'manifest.json'), 'utf8'));
    for (const [name, entry] of Object.entries(manifest)) {
      if (/classic/i.test(name) || /classic/i.test(entry.file ?? '')) out.push(`classic in sprites/manifest.json: ${name}`);
    }
  } catch (reason) {
    out.push(`sprites/manifest.json unreadable: ${String(reason)}`);
  }
  if (target !== null) out.push(...weightProblems(buildWeights(dir)));
  return out;
}

/** Problemi di uno zip: gli stessi dei nomi. */
export function checkZip(zip) {
  return nameProblems(zipEntries(zip)).map((p) => `zip: ${p}`);
}

/** `vite build --mode <target>` in `outDir`, senza il NODE_ENV di chi chiama (Vitest mette test). */
export function buildTarget(target, outDir) {
  const env = { ...process.env };
  delete env.NODE_ENV;
  execFileSync(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--mode', target, '--outDir', outDir, '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
}

/** Costruisce site e portal in `dir` e li controlla. Ritorna i problemi, per build. */
export function buildAndCheck(dir) {
  const report = {};
  for (const target of PUBLIC_TARGETS) {
    const outDir = join(dir, target);
    buildTarget(target, outDir);
    report[target] = checkBuild(outDir, forbiddenStrings(), target);
    if (target === 'portal') {
      const zip = zipDir(outDir);
      writeFileSync(join(dir, 'portal.zip'), zip);
      report[target].push(...checkZip(zip));
    }
  }
  return report;
}

function print(report, dirs = {}) {
  let bad = 0;
  for (const [target, problems] of Object.entries(report)) {
    if (dirs[target]) {
      const { total, initial } = buildWeights(dirs[target]);
      console.log(`${target}: ${(total / 1e6).toFixed(2)} MB total, ${(initial / 1e6).toFixed(2)} MB before the title`);
    }
    if (problems.length === 0) console.log(`${target}: ok`);
    for (const p of problems) console.error(`${target}: ${p}`);
    bad += problems.length;
  }
  return bad;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let bad = 0;
  if (args[0] === '--existing') {
    const report = {};
    const dirs = {};
    for (const target of PUBLIC_TARGETS) {
      const dir = join(ROOT, `dist-${target}`);
      if (existsSync(dir)) dirs[target] = dir;
      report[target] = existsSync(dir) ? checkBuild(dir, forbiddenStrings(), target) : [`dist-${target}/ missing: run npm run build:${target}`];
    }
    const zipPath = join(ROOT, 'dist-portal.zip');
    if (existsSync(zipPath)) report.portal.push(...checkZip(readFileSync(zipPath)));
    bad = print(report, dirs);
  } else {
    const keep = args[0] === '--keep' ? args[1] : null;
    const dir = keep ?? mkdtempSync(join(tmpdir(), 'teb-builds-'));
    try {
      const report = buildAndCheck(dir);
      bad = print(report, Object.fromEntries(PUBLIC_TARGETS.map((target) => [target, join(dir, target)])));
      console.log(`portal zip: ${(statSync(join(dir, 'portal.zip')).size / 1e6).toFixed(2)} MB`);
    } finally {
      if (!keep) rmSync(dir, { recursive: true, force: true });
    }
  }
  process.exit(bad === 0 ? 0 : 1);
}
