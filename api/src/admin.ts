// La pagina di moderazione (spec §2.6): le ultime 100 righe con un pulsante
// per nasconderle o rimostrarle, e i rifiuti degli ultimi 14 giorni per
// motivo. Niente librerie: HTML e JS in linea, con un nonce nella CSP.

export function adminHtml(nonce: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TEB RUN admin</title>
<style nonce="${nonce}">
  body { font: 14px/1.4 system-ui, sans-serif; margin: 16px; background: #fff; color: #111; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 24px; }
  th, td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left; white-space: nowrap; }
  tr.hidden td { color: #999; text-decoration: line-through; }
  button { font: inherit; }
</style>
</head>
<body>
<h1>TEB RUN leaderboard</h1>
<h2>Rejected runs (last 14 days)</h2>
<table id="rejections"><thead><tr><th>Day</th><th>Reason</th><th>Count</th></tr></thead><tbody></tbody></table>
<h2>Latest 100 runs</h2>
<table id="rows"><thead><tr><th>When (UTC)</th><th>Board</th><th>Day</th><th>Mode</th><th>Initials</th><th>Score</th><th>Car</th><th>Stage</th><th>Route</th><th>Ending</th><th>Time</th><th></th></tr></thead><tbody></tbody></table>
<script nonce="${nonce}">
  const cell = (tr, text) => { const td = document.createElement('td'); td.textContent = String(text ?? ''); tr.appendChild(td); };
  async function load() {
    const res = await fetch('/admin/rows', { credentials: 'same-origin' });
    if (!res.ok) { document.body.textContent = 'Not allowed.'; return; }
    const data = await res.json();
    const rej = document.querySelector('#rejections tbody');
    rej.replaceChildren();
    for (const r of data.rejections) { const tr = document.createElement('tr'); cell(tr, r.day); cell(tr, r.reason); cell(tr, r.count); rej.appendChild(tr); }
    const body = document.querySelector('#rows tbody');
    body.replaceChildren();
    for (const r of data.rows) {
      const tr = document.createElement('tr');
      if (r.hidden) tr.className = 'hidden';
      cell(tr, new Date(r.created_at * 1000).toISOString().slice(0, 16).replace('T', ' '));
      for (const v of [r.board, r.day, r.mode, r.initials, r.score, r.car, r.stage_id, r.route, r.ending, (r.duration_ms / 1000).toFixed(1) + ' s']) cell(tr, v);
      const td = document.createElement('td');
      const b = document.createElement('button');
      b.textContent = r.hidden ? 'SHOW' : 'HIDE';
      b.addEventListener('click', async () => {
        await fetch('/admin/hide', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: r.id, hidden: !r.hidden }) });
        load();
      });
      td.appendChild(b);
      tr.appendChild(td);
      body.appendChild(tr);
    }
  }
  load();
</script>
</body>
</html>`;
}
