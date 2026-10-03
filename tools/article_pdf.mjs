#!/usr/bin/env node
// Converte un articolo Markdown in un PDF impaginato (HTML + CSS, stampato da Chromium).
//   node tools/article_pdf.mjs docs/article/how-we-built-teb-run.md
// Il Markdown diventa HTML con il modulo Python `markdown` (tabelle, codice); le immagini
// restano relative alla cartella dell'articolo.
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const mdPath = path.resolve(process.argv[2] ?? 'docs/article/how-we-built-teb-run.md');
const dir = path.dirname(mdPath);
const base = path.basename(mdPath, '.md');
const md = fs.readFileSync(mdPath, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

const body = execFileSync('python3', ['-c', `
import sys, markdown
print(markdown.markdown(sys.stdin.read(), extensions=['tables', 'fenced_code', 'sane_lists', 'attr_list']))
`], { input: md }).toString();

const css = `
@page { size: A4; margin: 18mm 17mm 20mm 17mm; }
:root { --ink:#1b1830; --muted:#5d5a78; --pink:#ff3d8b; --orange:#ff8a3d; --cyan:#19c3d6; --paper:#ffffff; }
* { box-sizing: border-box; }
html { background: var(--paper); }
body { font-family: Georgia, 'Iowan Old Style', 'Palatino Linotype', serif; color: var(--ink);
  font-size: 10.6pt; line-height: 1.58; margin: 0; }
h1, h2, h3 { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.15; }
h1 { font-size: 26pt; font-weight: 800; letter-spacing: -0.5px; margin: 0 0 6mm; color: #e8336f; }
h2 { font-size: 15pt; margin: 9mm 0 3mm; padding-bottom: 1.5mm; border-bottom: 2px solid var(--pink);
  break-after: avoid; }
h3 { font-size: 12pt; margin: 6mm 0 2mm; color: #3a2f7a; break-after: avoid; }
p { margin: 0 0 3.2mm; orphans: 3; widows: 3; }
a { color: #b3246a; text-decoration: none; border-bottom: 1px solid rgba(179,36,106,.35); }
strong { color: #2a1f5c; }
img { display: block; width: 100%; border-radius: 6px; margin: 4mm 0 1.5mm;
  box-shadow: 0 2px 10px rgba(27,24,48,.18); break-inside: avoid; }
p:has(> img) { break-inside: avoid; margin-bottom: 1mm; }
p:has(> img) + p > em:only-child { display: block; text-align: center; color: var(--muted);
  font-size: 9pt; margin-bottom: 5mm; }
blockquote { margin: 4mm 0; padding: 3mm 5mm; border-left: 4px solid var(--cyan);
  background: #eefbfd; color: #1f3b44; border-radius: 0 6px 6px 0; }
code { font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 8.8pt; background: #f1eefa;
  padding: 0.3mm 1.2mm; border-radius: 3px; }
pre { background: #1b1830; color: #f3f0ff; padding: 4mm 5mm; border-radius: 6px; overflow: hidden;
  white-space: pre-wrap; font-size: 8.4pt; line-height: 1.45; break-inside: avoid; }
pre code { background: none; padding: 0; color: inherit; font-size: inherit; }
table { width: 100%; border-collapse: collapse; margin: 3mm 0 5mm; font-size: 9.4pt;
  font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; break-inside: avoid; }
th { text-align: left; background: #2a1f5c; color: #fff; padding: 1.8mm 2.5mm; }
td { padding: 1.6mm 2.5mm; border-bottom: 1px solid #e4e0f2; vertical-align: top; }
tr:nth-child(even) td { background: #faf8ff; }
thead:has(th:empty:first-child + th:empty:last-child) { display: none; }
table:has(thead th:empty) td:first-child { font-weight: 700; color: #2a1f5c; width: 32%; }
ul, ol { margin: 0 0 3.5mm; padding-left: 6mm; }
li { margin-bottom: 1.2mm; }
hr { border: none; height: 3px; margin: 7mm 0;
  background: linear-gradient(90deg, var(--pink), var(--orange), var(--cyan)); border-radius: 2px; }
.band { height: 6px; margin: 0 0 7mm; border-radius: 3px;
  background: linear-gradient(90deg, var(--pink), var(--orange), #ffd23f, var(--cyan)); }
`;

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${base}</title>
<style>${css}</style></head><body><div class="band"></div>${body}</body></html>`;
const htmlPath = path.join(dir, `${base}.html`);
fs.writeFileSync(htmlPath, html);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('file://' + htmlPath, { waitUntil: 'load' });
const pdfPath = path.join(dir, `${base}.pdf`);
await page.pdf({
  path: pdfPath, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-size:7.5pt;color:#8a86a6;font-family:Helvetica,Arial;text-align:center;">TEB RUN &middot; <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
});
await browser.close();
fs.unlinkSync(htmlPath);
console.log('PDF:', path.relative(process.cwd(), pdfPath));
