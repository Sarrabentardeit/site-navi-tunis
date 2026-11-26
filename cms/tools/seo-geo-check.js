/* Contrôle ciblé : audit SEO cohérent + corrections réellement appliquées + GEO lisible.
   Travaille sur une copie temporaire. Usage : node cms/tools/seo-geo-check.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-check-'));
const PORT = 8600 + Math.floor(Math.random() * 200);
const BASE = 'http://127.0.0.1:' + PORT;
const ENV = Object.assign({}, process.env, {
  NV_DATA: path.join(TMP, 'data'), NV_SITE: path.join(TMP, 'site'), NV_UPLOADS: path.join(TMP, 'uploads'),
  PORT: String(PORT), HOST: '127.0.0.1'
});

fs.cpSync(path.join(ROOT, 'data'), ENV.NV_DATA, { recursive: true, filter: s => !/[\\/]backups([\\/]|$)/.test(s) });
fs.rmSync(path.join(ENV.NV_DATA, 'users.json'), { force: true });
['redirects.json', 'seo-404.json', 'seo-history.json', 'seo-audit.json', 'seo-fixes.json', 'seo-page-meta.json'].forEach(f => fs.rmSync(path.join(ENV.NV_DATA, f), { force: true }));
fs.writeFileSync(path.join(ENV.NV_DATA, 'redirects.json'), '[]');
if (fs.existsSync(path.join(ROOT, 'site'))) fs.cpSync(path.join(ROOT, 'site'), ENV.NV_SITE, { recursive: true });
execFileSync(process.execPath, [path.join(ROOT, 'server.js'), 'user', 'add', 'check@test.local', 'MotDePasse-Test-2026', 'Check'], { env: ENV, stdio: 'pipe' });

let fails = 0, total = 0, cookie = '';
const ok = (c, m, extra) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 220) : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function req(method, p, body) {
  const h = { 'X-NV': '1' }; if (cookie) h.Cookie = cookie;
  let data; if (body !== undefined) { data = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method, headers: h, body: data, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* */ }
  return { status: r.status, text, json, headers: r.headers };
}
const titleOf = html => { const m = /<title>([\s\S]*?)<\/title>/.exec(html || ''); return m ? m[1].replace(/&amp;/g, '&') : ''; };
const descOf = html => { const m = /name="description"\s+content="([^"]*)"/.exec(html || ''); return m ? m[1] : ''; };

async function main() {
  Object.assign(process.env, { NV_DATA: ENV.NV_DATA, NV_SITE: ENV.NV_SITE, NV_UPLOADS: ENV.NV_UPLOADS });
  const seo = require('../lib/seo');
  const geo = require('../lib/geo');

  console.log('Cohérence audit SEO');
  const a1 = seo.analyze(), a2 = seo.analyze();
  ok(a1.score === a2.score && a1.issues.map(i => i.id).join() === a2.issues.map(i => i.id).join(), 'deux analyses donnent le même résultat');
  ok(a1.pages.every(p => p.score >= 0 && p.score <= 100), 'scores pages dans 0–100');
  ok(a1.counts.high + a1.counts.med + a1.counts.low === a1.issues.length, 'compteurs = nombre de problèmes');
  const long = a1.issues.filter(i => i.code === 'title_long' && i.fix);
  ok(long.every(i => i.fix.value.length >= 30 && i.fix.value.length <= 60), 'propositions de titre dans 30–60 car.', long.slice(0, 2).map(i => i.fix.value.length));
  const dlong = a1.issues.filter(i => i.code === 'desc_long' && i.fix);
  ok(dlong.every(i => i.fix.value.length >= 70 && i.fix.value.length <= 160), 'propositions de description dans 70–160 car.');

  console.log('GEO');
  const g = geo.analyze();
  ok(g.score >= 0 && g.score <= 100 && g.pages.length === a1.pages.length, 'GEO score + même nombre de pages que SEO');
  ok(g.schema.types.Organization && g.schema.types.WebSite, 'Organization + WebSite détectés');
  ok(Array.isArray(g.actions) && g.categories.entity && g.bots.length >= 5, 'actions + piliers + robots');

  console.log('API corrections');
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(BASE + '/'); break; } catch (e) { await sleep(200); } }
    await req('POST', '/api/login', { email: 'check@test.local', password: 'MotDePasse-Test-2026' });

    let r = await req('GET', '/api/seo/audit');
    const before = r.json.report;
    const fixables = before.issues.filter(i => i.fix);
    ok(fixables.length > 0, fixables.length + ' corrections proposées');

    /* une correction isolée */
    const one = fixables.find(i => i.fix.type === 'page' && i.fix.field === 'title') || fixables[0];
    const beforeScore = before.score;
    r = await req('POST', '/api/seo/fix', { ids: [one.id] });
    ok(r.status === 200 && r.json.applied === 1, '1 correction appliquée');
    ok(r.json.score >= beforeScore, 'score ne baisse pas (' + beforeScore + ' → ' + r.json.score + ')');
    await sleep(100);
    r = await req('GET', one.path.endsWith('/') ? one.path : one.path + '/');
    const live = one.fix.field === 'title' ? titleOf(r.text) : descOf(r.text);
    ok(live === one.fix.value, 'valeur publiée = proposition', { live: live.slice(0, 80), want: one.fix.value.slice(0, 80) });
    r = await req('GET', '/api/seo/audit');
    ok(!r.json.report.issues.some(i => i.id === one.id), 'le problème corrigé a disparu de l’audit');

    /* décocher = ne pas appliquer (simulé : ids partiels) */
    const left = r.json.report.issues.filter(i => i.fix).slice(0, 3);
    if (left.length >= 2) {
      const keep = left[0], apply = left.slice(1);
      r = await req('POST', '/api/seo/fix', { ids: apply.map(i => i.id) });
      ok(r.json.applied === apply.length, 'seulement les ids cochés sont appliqués (' + r.json.applied + ')');
      r = await req('GET', '/api/seo/audit');
      ok(r.json.report.issues.some(i => i.id === keep.id), 'l’élément non sélectionné reste dans l’audit');
    }

    /* meta manuelle */
    r = await req('PUT', '/api/seo/meta', {
      type: 'page', slug: 'contact',
      title: 'Contact Navitrends – ERP et automatisation',
      desc: 'Écrivez-nous pour un projet ERP, automatisation ou logiciel sur mesure. Réponse sous 24 h ouvrées.'
    });
    ok(r.status === 200, 'méta manuelle enregistrée');
    r = await req('GET', '/contact/');
    ok(titleOf(r.text) === 'Contact Navitrends – ERP et automatisation', 'titre contact publié');
    ok(descOf(r.text).length >= 70 && descOf(r.text).length <= 160, 'description contact dans la bonne longueur');

    /* GEO API */
    r = await req('GET', '/api/geo/overview');
    ok(r.status === 200 && r.json.score >= 0 && r.json.actions, 'GET /geo/overview');
    r = await req('PUT', '/api/geo/llms', { text: '# Navitrends\n\n> Intégration ERP et automatisation.\n', allowAi: true });
    ok(r.status === 200 && r.json.publish, 'publication llms.txt');
    r = await req('GET', '/llms.txt');
    ok(r.status === 200 && /Navitrends/.test(r.text), 'llms.txt servi en public');

    r = await req('GET', '/backoffice/geo-ui.js');
    ok(r.status === 200 && /Présence dans les réponses automatiques|En deux mots|Pages faciles à citer/.test(r.text), 'textes GEO humanisés chargés');
    ok(!/Visibilité IA \(GEO\)|citabilité IA|Score par pilier GEO/.test(r.text), 'anciennes formulations trop « IA » retirées');
  } finally {
    srv.kill();
  }
  if (/TypeError|ReferenceError/.test(log)) ok(false, 'pas d’exception serveur', log.slice(-400));
  else ok(true, 'pas d’exception serveur');
}

main().catch(e => { console.error(e); fails++; }).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* */ }
  console.log('\n' + (fails ? fails + ' ÉCHEC(S) sur ' + total : 'Tout est OK (' + total + ' vérifications)'));
  process.exit(fails ? 1 : 0);
});
