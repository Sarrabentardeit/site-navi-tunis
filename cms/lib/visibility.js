/* Visibilité : GSC (import), positions, mots-clés du site, rapport mensuel.
   Sans dépendance npm. API SERP optionnelle via SERPAPI_KEY. */
'use strict';
const https = require('https');
const store = require('./store');
const seo = require('./seo');

const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const rid = () => Math.random().toString(16).slice(2) + Date.now().toString(16);
const s = (x) => String(x == null ? '' : x).trim();

function gscStore() {
  return store.read('visibility-gsc', { property: '', at: null, queries: [], pages: [], note: '' });
}
function saveGsc(data) {
  store.write('visibility-gsc', data, { backup: false });
  return data;
}
function ranksStore() {
  return store.read('visibility-ranks', { keywords: [] });
}
function saveRanks(data) {
  store.write('visibility-ranks', data, { backup: false });
  return data;
}

/* ---------- CSV helpers (export Search Console) ---------- */
function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return { headers: [], rows: [] };
  const split = (line) => {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (q && line[i + 1] === '"') { cur += '"'; i++; }
        else q = !q;
      } else if ((c === ',' || c === '\t' || c === ';') && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim());
  };
  let start = 0;
  /* GSC exports sometimes start with a title line */
  if (lines[0] && !/click|impression|query|requête|page|ctr|position/i.test(lines[0])) start = 1;
  const headers = split(lines[start]).map(x => x.toLowerCase());
  const rows = [];
  for (let i = start + 1; i < lines.length; i++) {
    const cols = split(lines[i]);
    if (cols.every(c => !c)) continue;
    const o = {};
    headers.forEach((h, j) => { o[h] = cols[j] || ''; });
    rows.push(o);
  }
  return { headers, rows };
}

function num(x) {
  if (x == null || x === '') return 0;
  const n = parseFloat(String(x).replace(/%/g, '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function mapGscRow(o, kind) {
  const keys = Object.keys(o);
  const find = (...names) => {
    for (const n of names) {
      const k = keys.find(h => h === n || h.includes(n));
      if (k) return o[k];
    }
    return '';
  };
  const label = kind === 'page'
    ? find('top pages', 'pages', 'page', 'url')
    : find('top queries', 'queries', 'query', 'requête', 'requete', 'search');
  return {
    key: s(label),
    clicks: Math.round(num(find('clicks', 'clics', 'clic'))),
    impressions: Math.round(num(find('impressions', 'impression'))),
    ctr: num(find('ctr')),
    position: num(find('position', 'pos'))
  };
}

function importGsc(b) {
  b = b || {};
  const kind = b.kind === 'pages' ? 'pages' : 'queries';
  const parsed = parseCsv(b.csv || b.text || '');
  const items = parsed.rows.map(r => mapGscRow(r, kind)).filter(x => x.key);
  if (!items.length) throw fail(400, 'Aucun ligne lisible. Exportez depuis Search Console (Requêtes ou Pages) en CSV.');
  const cur = gscStore();
  cur.property = s(b.property) || cur.property;
  cur.at = now();
  cur.note = s(b.note) || cur.note;
  if (kind === 'pages') cur.pages = items.slice(0, 200);
  else cur.queries = items.slice(0, 200);
  saveGsc(cur);
  return { ok: true, kind, imported: items.length, at: cur.at };
}

function gscOverview() {
  const g = gscStore();
  const sum = (arr, k) => (arr || []).reduce((a, x) => a + (x[k] || 0), 0);
  return {
    property: g.property,
    at: g.at,
    note: g.note,
    totals: {
      clicks: sum(g.queries, 'clicks') || sum(g.pages, 'clicks'),
      impressions: sum(g.queries, 'impressions') || sum(g.pages, 'impressions'),
      queries: (g.queries || []).length,
      pages: (g.pages || []).length
    },
    queries: (g.queries || []).slice().sort((a, b) => b.clicks - a.clicks),
    pages: (g.pages || []).slice().sort((a, b) => b.clicks - a.clicks)
  };
}

function setGscProperty(b) {
  const g = gscStore();
  g.property = s(b && b.property);
  saveGsc(g);
  return { ok: true, property: g.property };
}

/* ---------- Positions ---------- */
function listRanks() {
  const data = ranksStore();
  return {
    keywords: (data.keywords || []).map(k => {
      const hist = k.history || [];
      const last = hist[0] || null;
      const prev = hist[1] || null;
      let delta = null;
      if (last && prev && last.pos > 0 && prev.pos > 0) delta = prev.pos - last.pos; /* + = amélioration */
      return {
        id: k.id, q: k.q, tag: k.tag || '', created: k.created,
        pos: last ? last.pos : null,
        url: last ? last.url : '',
        at: last ? last.at : null,
        delta,
        history: hist.slice(0, 30)
      };
    }).sort((a, b) => String(a.q).localeCompare(String(b.q)))
  };
}

function addRank(b) {
  const q = s(b && b.q).toLowerCase();
  if (q.length < 2) throw fail(400, 'Mot-clé trop court.');
  if (q.length > 80) throw fail(400, 'Mot-clé trop long.');
  const data = ranksStore();
  if ((data.keywords || []).length >= 30) throw fail(400, 'Maximum 30 mots-clés suivis.');
  if ((data.keywords || []).some(k => k.q === q)) throw fail(409, 'Ce mot-clé est déjà suivi.');
  data.keywords = data.keywords || [];
  data.keywords.push({ id: rid(), q, tag: s(b.tag).slice(0, 40), created: now(), history: [] });
  saveRanks(data);
  return listRanks();
}

function deleteRank(id) {
  const data = ranksStore();
  data.keywords = (data.keywords || []).filter(k => k.id !== id);
  saveRanks(data);
  return listRanks();
}

function recordRank(id, b) {
  const data = ranksStore();
  const k = (data.keywords || []).find(x => x.id === id);
  if (!k) throw fail(404, 'Mot-clé introuvable.');
  const pos = Math.round(num(b && b.pos));
  if (pos < 1 || pos > 100) throw fail(400, 'Position entre 1 et 100.');
  k.history = k.history || [];
  k.history.unshift({ at: now(), pos, url: s(b.url).slice(0, 300), source: s(b.source) || 'manual' });
  if (k.history.length > 60) k.history.length = 60;
  saveRanks(data);
  return listRanks();
}

function fetchSerp(q) {
  const key = process.env.SERPAPI_KEY;
  if (!key) return Promise.reject(fail(400, 'SERPAPI_KEY non configurée. Saisissez la position à la main, ou définissez SERPAPI_KEY.'));
  const site = (store.read('settings', {}).site_url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const params = new URLSearchParams({
    engine: 'google',
    q,
    api_key: key,
    hl: 'fr',
    gl: 'tn',
    num: '10'
  });
  return new Promise((resolve, reject) => {
    https.get('https://serpapi.com/search.json?' + params.toString(), (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try {
          const j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (j.error) return reject(fail(502, String(j.error)));
          const organic = j.organic_results || [];
          let best = null;
          organic.forEach((r, i) => {
            const link = String(r.link || '');
            if (site && link.includes(site) && !best) best = { pos: r.position || (i + 1), url: link };
          });
          if (!best && organic[0]) best = { pos: organic[0].position || 1, url: organic[0].link || '', note: 'Premier résultat global (votre site non trouvé dans le top 10)' };
          if (!best) return reject(fail(404, 'Aucun résultat SERP.'));
          resolve(best);
        } catch (e) { reject(fail(502, 'Réponse SERP illisible.')); }
      });
    }).on('error', e => reject(fail(502, e.message)));
  });
}

function checkRank(id) {
  const data = ranksStore();
  const k = (data.keywords || []).find(x => x.id === id);
  if (!k) return Promise.reject(fail(404, 'Mot-clé introuvable.'));
  return fetchSerp(k.q).then(r => {
    k.history = k.history || [];
    k.history.unshift({ at: now(), pos: r.pos, url: r.url || '', source: 'serpapi', note: r.note || '' });
    if (k.history.length > 60) k.history.length = 60;
    saveRanks(data);
    return listRanks();
  });
}

/* ---------- Mots-clés du site (cibles SEO) ---------- */
function siteKeywords() {
  const meta = store.read('seo-page-meta', {});
  const rep = seo.analyze();
  const byKw = new Map();
  (rep.pages || []).forEach(p => {
    (p.targets || []).forEach(kw => {
      const k = String(kw).toLowerCase();
      if (!byKw.has(k)) byKw.set(k, { q: k, pages: [], inTitle: 0, inDesc: 0, tips: 0 });
      const row = byKw.get(k);
      row.pages.push({ name: p.name, path: p.path, score: p.score });
      const tl = (p.title || '').toLowerCase();
      const dl = (p.desc || '').toLowerCase();
      if (tl.includes(k)) row.inTitle++;
      if (dl.includes(k)) row.inDesc++;
    });
  });
  /* pages without targets */
  const missing = (rep.pages || []).filter(p => p.indexable && !(p.targets || []).length).map(p => ({ name: p.name, path: p.path, score: p.score }));
  const tracked = new Set((ranksStore().keywords || []).map(k => k.q));
  const list = [...byKw.values()].map(x => Object.assign(x, {
    pagesCount: x.pages.length,
    coverage: (x.inTitle ? 1 : 0) + (x.inDesc ? 1 : 0),
    tracked: tracked.has(x.q)
  })).sort((a, b) => b.pagesCount - a.pagesCount || a.q.localeCompare(b.q));

  return {
    at: rep.at,
    totals: { keywords: list.length, pagesWithout: missing.length, tracked: tracked.size },
    keywords: list,
    pagesWithoutTargets: missing.slice(0, 40)
  };
}

/* ---------- Rapport mensuel ---------- */
function monthlyReport() {
  const seoRep = seo.report();
  const gsc = gscOverview();
  const ranks = listRanks();
  const kws = siteKeywords();
  const month = String(seoRep.month || now().slice(0, 7));
  return {
    at: now(),
    month,
    seo: {
      score: seoRep.score,
      grade: seoRep.grade,
      delta: seoRep.evolution && seoRep.evolution.delta,
      remaining: seoRep.remaining,
      fixed: seoRep.fixed,
      indexable: seoRep.indexable
    },
    gsc: {
      at: gsc.at,
      totals: gsc.totals,
      topQueries: gsc.queries.slice(0, 10),
      topPages: gsc.pages.slice(0, 10)
    },
    ranks: {
      count: ranks.keywords.length,
      items: ranks.keywords.filter(k => k.pos != null).slice(0, 20)
    },
    keywords: {
      totals: kws.totals,
      top: kws.keywords.slice(0, 15)
    }
  };
}

function reportHtml() {
  const r = monthlyReport();
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const qRows = (r.gsc.topQueries || []).map(x =>
    '<tr><td>' + esc(x.key) + '</td><td>' + x.clicks + '</td><td>' + x.impressions + '</td><td>' + (x.position ? x.position.toFixed(1) : '—') + '</td></tr>'
  ).join('');
  const rankRows = (r.ranks.items || []).map(x =>
    '<tr><td>' + esc(x.q) + '</td><td>' + (x.pos != null ? x.pos : '—') + '</td><td>' + (x.delta == null ? '—' : ((x.delta > 0 ? '+' : '') + x.delta)) + '</td></tr>'
  ).join('');
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport Visibilité ' + esc(r.month) + '</title>'
    + '<style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#1a1a1a;max-width:860px;margin:32px auto;padding:0 20px}'
    + 'h1{font-size:24px;margin:0 0 6px}h2{font-size:16px;margin:28px 0 10px;border-bottom:1px solid #e5e7ef;padding-bottom:6px}'
    + '.k{display:inline-block;min-width:120px;margin:0 12px 12px 0;padding:12px 14px;border:1px solid #e5e7ef;border-radius:10px}'
    + '.k b{display:block;font-size:22px}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #eee;font-size:13px}'
    + '@media print{body{margin:0}}</style></head><body>'
    + '<h1>Rapport Visibilité</h1><p>Période ' + esc(r.month) + ' · généré le ' + esc(String(r.at).slice(0, 16).replace('T', ' ')) + '</p>'
    + '<div><div class="k"><b>' + r.seo.score + '</b>Note SEO · ' + esc(r.seo.grade) + '</div>'
    + '<div class="k"><b>' + (r.seo.delta == null ? '—' : ((r.seo.delta > 0 ? '+' : '') + r.seo.delta)) + '</b>Évolution</div>'
    + '<div class="k"><b>' + (r.gsc.totals.clicks || 0) + '</b>Clics GSC</div>'
    + '<div class="k"><b>' + (r.ranks.count || 0) + '</b>Mots-clés suivis</div></div>'
    + '<h2>SEO</h2><p>' + (r.seo.remaining && r.seo.remaining.total || 0) + ' points ouverts · '
    + (r.seo.fixed && r.seo.fixed.month || 0) + ' corrections ce mois · '
    + (r.seo.indexable && r.seo.indexable.yes || 0) + ' pages visibles</p>'
    + '<h2>Top requêtes Search Console</h2>'
    + (qRows
      ? '<table><thead><tr><th>Requête</th><th>Clics</th><th>Impressions</th><th>Position</th></tr></thead><tbody>' + qRows + '</tbody></table>'
      : '<p>Importez un export CSV depuis l’onglet Search Console.</p>')
    + '<h2>Positions suivies</h2>'
    + (rankRows
      ? '<table><thead><tr><th>Mot-clé</th><th>Position</th><th>Δ</th></tr></thead><tbody>' + rankRows + '</tbody></table>'
      : '<p>Aucun mot-clé suivi pour l’instant.</p>')
    + '<h2>Mots-clés du site</h2><p>' + (r.keywords.totals.keywords || 0) + ' cibles renseignées · '
    + (r.keywords.totals.pagesWithout || 0) + ' page(s) sans cible</p>'
    + '</body></html>';
}

function overview() {
  const gsc = gscOverview();
  const ranks = listRanks();
  const kws = siteKeywords();
  const seoOv = seo.overview();
  return {
    at: now(),
    seo: { score: seoOv.score, grade: seoOv.grade, issues: seoOv.totals && seoOv.totals.issues, high: seoOv.counts && seoOv.counts.high },
    gsc: { at: gsc.at, totals: gsc.totals },
    ranks: { count: ranks.keywords.length, withPos: ranks.keywords.filter(k => k.pos != null).length },
    keywords: kws.totals,
    serpApi: !!process.env.SERPAPI_KEY
  };
}

module.exports = {
  overview,
  gscOverview, importGsc, setGscProperty,
  listRanks, addRank, deleteRank, recordRank, checkRank,
  siteKeywords,
  monthlyReport, reportHtml
};
