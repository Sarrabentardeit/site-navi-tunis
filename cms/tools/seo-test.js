/* Test automatisé du module SEO (unitaire + API + publication).
   Travaille sur une COPIE temporaire des données : le contenu réel n'est jamais modifié.
   Usage : node cms/tools/seo-test.js */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'nv-seo-'));
const PORT = 8100 + Math.floor(Math.random() * 400);
const BASE = 'http://127.0.0.1:' + PORT;
const ENV = Object.assign({}, process.env, { NV_DATA: path.join(TMP, 'data'), NV_SITE: path.join(TMP, 'site'), NV_UPLOADS: path.join(TMP, 'uploads'), PORT: String(PORT), HOST: '127.0.0.1' });

fs.cpSync(path.join(ROOT, 'data'), ENV.NV_DATA, { recursive: true, filter: s => !/[\\/]backups([\\/]|$)/.test(s) });
fs.rmSync(path.join(ENV.NV_DATA, 'users.json'), { force: true });
['redirects.json', 'seo-404.json', 'seo-history.json', 'seo-audit.json', 'seo-redirect-log.json', 'seo-fixes.json', 'seo-page-meta.json'].forEach(f => fs.rmSync(path.join(ENV.NV_DATA, f), { force: true }));
fs.writeFileSync(path.join(ENV.NV_DATA, 'redirects.json'), '[]');
if (fs.existsSync(path.join(ROOT, 'site'))) fs.cpSync(path.join(ROOT, 'site'), ENV.NV_SITE, { recursive: true });
execFileSync(process.execPath, [path.join(ROOT, 'server.js'), 'user', 'add', 'seo@test.local', 'MotDePasse-Test-2026', 'SEO Test'], { env: ENV, stdio: 'pipe' });

let fails = 0, total = 0;
const ok = (c, m, extra) => { total++; console.log((c ? '  ✓ ' : '  ✗ ') + m + (!c && extra !== undefined ? '  → ' + JSON.stringify(extra).slice(0, 300) : '')); if (!c) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cookie = '';

async function req(method, p, body, headers) {
  const h = Object.assign({ 'X-NV': '1' }, headers || {});
  if (cookie) h.Cookie = cookie;
  let data;
  if (body !== undefined) { data = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch(BASE + p, { method, headers: h, body: data, redirect: 'manual' });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* html */ }
  return { status: r.status, headers: r.headers, text, json };
}
const titleOf = html => { const m = /<title>([\s\S]*?)<\/title>/.exec(html); return m ? m[1].replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&quot;/g, '"') : ''; };

async function main() {
  /* ---------------- unitaire (même environnement que le serveur) ---------------- */
  console.log('Moteur (unitaire)');
  Object.assign(process.env, { NV_DATA: ENV.NV_DATA, NV_SITE: ENV.NV_SITE, NV_UPLOADS: ENV.NV_UPLOADS });
  const seo = require('../lib/seo');
  const T = seo._t;
  const doc = '<html><head><title>Mon titre &amp; co</title><meta name="description" content="Une description"><link rel="canonical" href="https://x.fr/a/"><meta name="robots" content="noindex"></head><body>'
    + '<main><h1>Titre A</h1><h1>Titre B</h1><h2>Sous</h2><p>' + 'Texte très utile pour tester. '.repeat(10) + '</p><img src="a.png"><img src="b.png" alt="ok"><img src="c.png" alt="">'
    + '<a href="/page-a/">a</a><a href="https://x.fr/page-b/#top">b</a><a href="mailto:a@b.c">m</a><a href="#x">h</a><a href="https://autre.fr/">ext</a></main></body></html>';
  const a = T.parseHtml(doc);
  ok(a.title === 'Mon titre & co' && a.desc === 'Une description', 'extraction titre + description (entités décodées)');
  ok(a.h1s.length === 2 && a.h2 === 1, 'comptage H1 / H2');
  ok(a.imgs === 3 && a.imgsNoAlt === 1, 'images sans attribut alt (alt vide = décoratif accepté)');
  ok(/noindex/.test(a.robots) && a.canonical === 'https://x.fr/a/', 'robots + canonical lus');
  ok(a.links.length === 5 && a.words > 30, 'liens et nombre de mots');
  const longT = 'Accompagnement opérationnel & montée en compétence des équipes – Société Navitrends';
  const sug = T.suggestTitle(longT, 'x');
  ok(sug && sug.length <= 60 && sug.length >= 30, 'suggestion de titre dans la plage 30–60 : « ' + sug + ' »');
  ok(!/\s(de|des|du|et|&|la|le|les|d['’])$/i.test(sug), 'le titre suggéré ne finit pas sur un mot « vide »');
  ok(T.fitTitle('Court – Société Navitrends') === 'Court – Société Navitrends', 'un titre valide n’est pas modifié');
  const sd = T.suggestDesc('Phrase une. '.repeat(30), 'lead');
  ok(sd && sd.length <= 160 && sd.length >= 70, 'suggestion de description ≤ 160 (' + (sd || '').length + ' car.)');
  ok(T.suggestDesc('', 'Voici un paragraphe d’introduction suffisamment long pour servir de description automatique à la page concernée.') !== null, 'description manquante → proposée depuis le contenu');
  const paths = T.sitePaths();
  ok(paths.length >= 15 && paths.some(p => p.path === '/contact/'), 'liste des pages connues (' + paths.length + ')');
  const s1 = T.suggest404('/contact-us', paths), s2 = T.suggest404('/blog/mon-ancien-article', paths), s3 = T.suggest404('/wp-login.php', paths);
  ok(s1 && s1.to === '/contact/', '404 /contact-us → /contact/ (' + (s1 && s1.confidence) + ' %)', s1);
  ok(s2 && /insights/.test(s2.to), '404 /blog/... → page Insights', s2);
  ok(s3 === null && T.isBot('/wp-login.php') && T.isBot('/xmlrpc.php') && !T.isBot('/contact-us'), 'robots/scans détectés et sans suggestion');
  ok(T.sim('/services/erp', '/services/erp/') > 0.99 && T.sim('/a', '/zzzzzz') < 0.4, 'similarité cohérente');

  /* ---------------- audit local ---------------- */
  console.log('Audit');
  const t0 = Date.now(); const rep = seo.analyze(); const ms = Date.now() - t0;
  ok(rep.score >= 0 && rep.score <= 100 && typeof rep.grade === 'string', 'score 0–100 (' + rep.score + ' · ' + rep.grade + ')');
  ok(ms < 2500, 'analyse rapide (' + ms + ' ms)');
  ok(rep.pages.length >= 16 && rep.pages.every(p => p.score >= 0 && p.score <= 100), rep.pages.length + ' pages analysées');
  ok(new Set(rep.issues.map(i => i.id)).size === rep.issues.length, 'identifiants de problèmes uniques et stables');
  ok(rep.counts.high + rep.counts.med + rep.counts.low === rep.issues.length, 'compteurs cohérents avec la liste');
  ok(Object.keys(rep.categories).length === 5 && Object.values(rep.categories).every(c => c.score >= 0 && c.score <= 100), '5 domaines notés');
  ok(rep.tech.length >= 10 && rep.tech.every(t => ['ok', 'warn', 'bad'].includes(t.status)), 'check-list technique (' + rep.tech.length + ' contrôles)');
  ok(seo.analyze().issues.map(i => i.id).join() === rep.issues.map(i => i.id).join(), 'analyse déterministe (mêmes identifiants)');

  /* ---------------- serveur ---------------- */
  console.log('API (serveur temporaire :' + PORT + ')');
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 60; i++) { try { const r = await fetch(BASE + '/'); if (r.status) break; } catch (e) { await sleep(250); } }

    let r = await req('GET', '/api/seo/overview'); ok(r.status === 401, 'API SEO protégée sans connexion (401)');
    r = await req('POST', '/api/login', { email: 'seo@test.local', password: 'MotDePasse-Test-2026' }); ok(r.status === 200, 'connexion');
    r = await req('PUT', '/api/seo/meta', { type: 'home' }, { 'X-NV': '' }); ok(r.status === 403, 'écriture sans en-tête X-NV refusée (403)');

    r = await req('GET', '/api/seo/overview');
    const ov = r.json;
    ok(r.status === 200 && ov.score >= 0 && Array.isArray(ov.actions) && Array.isArray(ov.tech) && ov.categories && ov.totals, 'GET /seo/overview', ov && Object.keys(ov));
    ok(ov.history.length === 1, 'historique initialisé (1 point)');
    r = await req('GET', '/api/seo/audit'); ok(r.status === 200 && r.json.report.issues.length === rep.issues.length, 'GET /seo/audit identique au moteur local');
    const before = r.json.report;

    /* corrections automatiques */
    const fix1 = before.issues.find(i => i.fix && i.fix.field === 'title' && i.fix.type === 'page');
    ok(!!fix1, 'une correction de titre est proposée');
    if (fix1) {
      r = await req('POST', '/api/seo/fix', { ids: [fix1.id] });
      ok(r.status === 200 && r.json.applied === 1 && r.json.score >= r.json.before, 'correction appliquée, score ' + r.json.before + ' → ' + r.json.score);
      await sleep(150);
      r = await req('GET', fix1.path); ok(titleOf(r.text) === fix1.fix.value, 'le nouveau titre est publié sur la page', [titleOf(r.text), fix1.fix.value]);
      r = await req('GET', '/api/seo/audit'); ok(!r.json.report.issues.some(i => i.id === fix1.id), 'le problème a disparu de l’audit');
    }
    r = await req('POST', '/api/seo/fix', { ids: ['inexistant'] }); ok(r.json.applied === 0, 'identifiant inconnu : rien n’est appliqué');
    r = await req('POST', '/api/seo/fix', { all: true });
    ok(r.status === 200 && r.json.applied > 0 && r.json.score >= r.json.before, 'tout corriger : ' + r.json.applied + ' correction(s), score ' + r.json.before + ' → ' + r.json.score);
    r = await req('GET', '/api/seo/audit');
    ok(!r.json.report.issues.some(i => i.fix), 'plus aucune correction automatique en attente');
    ok(!r.json.report.issues.some(i => ['title_long', 'desc_long'].includes(i.code)), 'plus de titre/description trop long', r.json.report.issues.filter(i => ['title_long', 'desc_long'].includes(i.code)).map(i => i.code + ' ' + i.path + ' ' + i.message));
    r = await req('GET', '/api/seo/overview'); ok(r.json.delta !== null && r.json.history.length >= 2, 'tendance du score disponible (Δ ' + r.json.delta + ')');

    /* méta-données manuelles */
    r = await req('PUT', '/api/seo/meta', { type: 'page', slug: 'contact', title: 'Contactez Navitrends – ERP, automatisation et IA', desc: 'Parlez-nous de votre projet ERP, automatisation ou développement sur mesure : réponse sous 24 h ouvrées.' });
    ok(r.status === 200 && r.json.publish.pages > 0, 'PUT /seo/meta + publication');
    r = await req('GET', '/contact/');
    ok(titleOf(r.text) === 'Contactez Navitrends – ERP, automatisation et IA' && /name="description" content="Parlez-nous/.test(r.text), 'titre et description publiés');
    r = await req('PUT', '/api/seo/meta', { type: 'page', slug: 'contact', title: '', desc: '' });
    r = await req('GET', '/contact/'); ok(/Contact – Société Navitrends/.test(titleOf(r.text)), 'champs vidés → génération automatique rétablie', titleOf(r.text));
    r = await req('PUT', '/api/seo/meta', { type: 'home', title: 'Navitrends – ERP, automatisation et IA en Tunisie', desc: 'Intégration ERP, automatisation et logiciels sur mesure pour les entreprises.' });
    r = await req('GET', '/'); ok(/Navitrends – ERP, automatisation et IA en Tunisie/.test(titleOf(r.text)), 'méta de l’accueil modifiées');
    r = await req('PUT', '/api/seo/meta', { type: 'page', slug: 'nexiste-pas', title: 'x' }); ok(r.status === 404, 'page inconnue → 404');
    r = await req('PUT', '/api/seo/meta', { type: 'article', slug: 'x', title: 'x' }); ok(r.status === 400, 'type non modifiable refusé (400)');
    r = await req('PUT', '/api/seo/meta', { type: 'page', slug: 'contact', title: '<b>' + 'x'.repeat(500) + '</b>' });
    r = await req('GET', '/api/seo/audit'); ok(r.status === 200, 'titre démesuré toléré (tronqué à 300 car.)');
    await req('PUT', '/api/seo/meta', { type: 'page', slug: 'contact', title: '' });

    /* 404 */
    console.log('404 et redirections');
    r = await req('GET', '/contact-us/'); ok(r.status === 404, 'URL inexistante → 404');
    await req('GET', '/contact-us/'); await req('GET', '/contact-us/');
    await req('GET', '/wp-login.php');
    r = await req('GET', '/api/seo/404');
    const e1 = r.json.items.find(x => x.path === '/contact-us'), eb = r.json.items.find(x => x.path === '/wp-login.php');
    ok(e1 && e1.count === 3 && e1.suggestion && e1.suggestion.to === '/contact/', '404 comptée (3 visites) + redirection suggérée vers /contact/', e1);
    ok(eb && eb.bot === true && !eb.suggestion, 'tentative de robot classée à part');
    ok(r.json.items.findIndex(x => x.path === '/contact-us') < r.json.items.findIndex(x => x.path === '/wp-login.php'), 'les vraies 404 sont listées avant les robots');
    r = await req('GET', '/api/seo/audit'); ok(r.json.report.issues.some(i => i.code === 'unhandled_404'), 'l’audit signale les 404 non redirigées (≥ 3 visites)');

    /* création depuis la 404 */
    r = await req('POST', '/api/seo/redirects', { from: '/contact-us/', to: '/contact/', code: 301, note: 'test' });
    ok(r.status === 200 && r.json.item.from === '/contact-us' && r.json.item.to === '/contact' && !r.json.warnings.length, 'création 301 (URL normalisée, aucun avertissement)', r.json);
    r = await req('GET', '/contact-us/'); ok(r.status === 301 && r.headers.get('location') === '/contact', 'la redirection répond 301 → /contact');
    r = await req('GET', '/contact-us?utm=1'); ok(r.status === 301 && /\?utm=1$/.test(r.headers.get('location')), 'la chaîne de requête est conservée');
    r = await req('GET', '/CONTACT-US'); ok(r.status === 301, 'correspondance insensible à la casse');
    r = await req('GET', '/api/seo/404'); const e2 = r.json.items.find(x => x.path === '/contact-us');
    ok(!e2, 'la 404 est retirée du journal une fois redirigée');
    r = await req('GET', '/api/seo/redirects'); const rd = r.json.items[0];
    ok(rd.hits >= 3 && rd.lastHit, 'compteur de visites + dernier passage (' + rd.hits + ')');
    r = await req('GET', '/api/seo/redirects/test?path=/contact-us'); ok(r.json.ok && r.json.final === '/contact' && r.json.steps.length === 1, 'test de redirection : OK', r.json);

    /* validations */
    r = await req('POST', '/api/seo/redirects', { from: '/contact-us', to: '/devis/' }); ok(r.status === 409, 'doublon refusé (409)');
    r = await req('POST', '/api/seo/redirects', { from: '/a', to: '/a/' }); ok(r.status === 400, 'source = destination refusée (400)');
    r = await req('POST', '/api/seo/redirects', { from: '', to: '/x' }); ok(r.status === 400, 'source vide refusée');
    r = await req('POST', '/api/seo/redirects', { from: '/x', to: '' }); ok(r.status === 400, 'destination vide refusée');
    r = await req('POST', '/api/seo/redirects', { from: 'https://evil.com/x', to: '/' }); ok(r.status === 400, 'source en URL complète refusée');
    r = await req('POST', '/api/seo/redirects', { from: '/vers-nulle-part', to: '/page-qui-nexiste-pas/' });
    ok(r.status === 200 && r.json.warnings.length === 1 && /n’existe pas/.test(r.json.warnings[0]), 'avertissement : destination inexistante', r.json.warnings);
    const brokenId = r.json.item.id;
    r = await req('POST', '/api/seo/redirects', { from: '/chaine-a', to: '/contact-us' }); ok(r.json.warnings.some(w => /chaîne/.test(w)), 'avertissement : chaîne de redirections', r.json.warnings);
    const chainId = r.json.item.id;
    r = await req('POST', '/api/seo/redirects', { from: '/services', to: '/contact/' }); ok(r.json.warnings.some(w => /existe encore/.test(w)), 'avertissement : la règle masque une vraie page', r.json.warnings);
    const shadowId = r.json.item.id;
    r = await req('DELETE', '/api/seo/redirects/' + shadowId); ok(r.status === 200, 'suppression d’une règle');
    r = await req('GET', '/services/'); ok(r.status === 200, 'la page « /services/ » est de nouveau servie');

    /* audit des redirections */
    r = await req('GET', '/api/seo/audit'); let codes = r.json.report.issues.map(i => i.code);
    ok(codes.includes('redir_broken') && codes.includes('redir_chain'), 'audit : redirection cassée + chaîne détectées');
    r = await req('POST', '/api/seo/redirects', { from: '/boucle-a', to: '/boucle-b' }); const loopA = r.json.item.id;
    r = await req('POST', '/api/seo/redirects', { from: '/boucle-b', to: '/boucle-a' }); const loopB = r.json.item.id;
    r = await req('GET', '/api/seo/redirects/test?path=/boucle-a'); ok(r.json.status === 'loop', 'test : boucle détectée');
    r = await req('GET', '/api/seo/audit'); ok(r.json.report.issues.some(i => i.code === 'redir_loop'), 'audit : boucle de redirections signalée');
    r = await req('GET', '/boucle-a'); ok(r.status === 301, 'le serveur ne plante pas sur une boucle');
    await req('DELETE', '/api/seo/redirects/' + loopA); await req('DELETE', '/api/seo/redirects/' + loopB);
    await req('DELETE', '/api/seo/redirects/' + brokenId); await req('DELETE', '/api/seo/redirects/' + chainId);

    /* désactivation / modification / suppression */
    r = await req('PUT', '/api/seo/redirects/' + rd.id, { from: rd.from, to: rd.to, code: 302, note: 'modif', enabled: false, hits: rd.hits });
    ok(r.status === 200 && r.json.item.enabled === false && r.json.item.code === 302, 'désactivation + passage en 302');
    r = await req('GET', '/contact-us'); ok(r.status === 404, 'règle désactivée : retour à la 404');
    r = await req('PUT', '/api/seo/redirects/' + rd.id, { from: rd.from, to: rd.to, code: 302, enabled: true, hits: rd.hits });
    r = await req('GET', '/contact-us'); ok(r.status === 302, 'réactivée en 302 → statut 302');

    /* import en masse */
    r = await req('POST', '/api/seo/redirects/import', { code: 301, text: '/old-1 -> /contact/\n/old-2, /devis/\n# commentaire\n/old-3;/services/\n/old-1 -> /faq/\nsans-destination\n/identique -> /identique\n/old-4\t/a-propos/' });
    ok(r.status === 200 && r.json.added === 4 && r.json.skipped === 1 && r.json.errors.length === 2, 'import : 4 ajoutées, 1 doublon ignoré, 2 erreurs', [r.json.added, r.json.skipped, r.json.errors]);
    r = await req('GET', '/old-2'); ok(r.status === 301 && r.headers.get('location') === '/devis', 'règle importée active');
    r = await req('POST', '/api/seo/redirects/import', { text: '' }); ok(r.json.added === 0, 'import vide sans effet');

    /* persistance + sauvegarde */
    await sleep(4500); // vidage différé des compteurs
    const onDisk = JSON.parse(fs.readFileSync(path.join(ENV.NV_DATA, 'redirects.json'), 'utf8'));
    ok(onDisk.length >= 5 && onDisk.find(x => x.from === '/contact-us').hits >= 4, 'redirections et compteurs écrits sur disque', onDisk.length);
    r = await req('GET', '/api/export'); ok(r.json.redirects.length === onDisk.length && Array.isArray(r.json['seo-404']), 'export de sauvegarde inclut redirections et 404');
    const bk = r.json;
    r = await req('POST', '/api/import', Object.assign({}, bk, { redirects: [{ id: 'abc123', from: '/restaure', to: '/contact', code: 301, enabled: true, hits: 0 }] }));
    ok(r.status === 200, 'import de sauvegarde');
    r = await req('GET', '/restaure'); ok(r.status === 301, 'après import, le cache des redirections est rechargé');
    r = await req('GET', '/old-2'); ok(r.status === 404, 'les anciennes règles sont bien remplacées');
    r = await req('GET', '/api/seo/overview'); ok(r.status === 200 && r.json.redirects === 1, 'vue d’ensemble cohérente après import');

    /* historique */
    r = await req('POST', '/api/seo/audit', {}); ok(r.status === 200 && r.json.report.score >= 0, 'POST /seo/audit (analyse + historique)');
    ok(fs.existsSync(path.join(ENV.NV_DATA, 'seo-history.json')), 'historique du score enregistré');

    /* indexabilité + mots-clés cibles + rapport + historique redirections */
    console.log('Compléments (indexabilité, cibles, rapport)');
    r = await req('GET', '/api/seo/overview');
    ok(typeof r.json.indexable === 'number' && typeof r.json.noindex === 'number' && r.json.indexable + r.json.noindex === r.json.totals.pages, 'vue d’ensemble : indexables / noindex', r.json);
    r = await req('GET', '/api/seo/audit');
    ok(r.json.report.pages.every(p => typeof p.indexable === 'boolean' && Array.isArray(p.targets) && Array.isArray(p.tips)), 'chaque page a indexable + targets + tips');
    r = await req('PUT', '/api/seo/targets', { type: 'page', slug: 'services', keywords: 'erp odoo, automatisation, intégration erp' });
    ok(r.status === 200 && r.json.keywords.length === 3 && r.json.keywords[0] === 'erp odoo', 'PUT /seo/targets', r.json);
    r = await req('GET', '/api/seo/audit');
    const svc = r.json.report.pages.find(p => p.slug === 'services');
    ok(svc && svc.targets.includes('erp odoo') && svc.tips.some(t => /erp odoo/i.test(t.text)), 'cibles et suggestions de contenu sur /services/', svc && { targets: svc.targets, tips: svc.tips.slice(0, 3) });
    r = await req('GET', '/api/seo/redirects/log');
    ok(r.status === 200 && Array.isArray(r.json.items) && r.json.items.length >= 1 && r.json.items.some(x => x.action === 'create' || x.action === 'import'), 'historique des redirections', r.json.items && r.json.items.slice(0, 3));
    r = await req('GET', '/api/seo/report');
    ok(r.status === 200 && r.json.score >= 0 && r.json.remaining && r.json.fixed && r.json.indexable, 'GET /seo/report', r.json && Object.keys(r.json));
    ok(r.json.fixed.total >= 1, 'le rapport compte les corrections appliquées (' + r.json.fixed.total + ')');
    r = await req('GET', '/api/seo/export?type=report');
    ok(r.status === 200 && /Score actuel/.test(r.text) && r.headers.get('content-type').includes('csv'), 'export CSV rapport');
    r = await req('GET', '/api/seo/export?type=issues');
    ok(r.status === 200 && r.text.split('\n').length > 2, 'export CSV audit');
    r = await req('GET', '/api/seo/report.html');
    ok(r.status === 200 && /Rapport SEO/.test(r.text) && /Imprimer/.test(r.text), 'rapport HTML imprimable (PDF)');

    /* sécurité de l'interface */
    r = await req('GET', '/backoffice/seo-ui.js'); ok(r.status === 200 && /NVSeo/.test(r.text) && /renderReport/.test(r.text), 'seo-ui.js servi par le back-office');
    r = await req('GET', '/backoffice/'); ok(/seo-ui\.js/.test(r.text), 'index.html charge seo-ui.js');
  } finally {
    srv.kill();
  }
  if (/Error|TypeError|ReferenceError/.test(log.replace(/Erreur interne/g, ''))) { ok(false, 'aucune exception côté serveur', log.slice(-600)); } else ok(true, 'aucune exception côté serveur');
}

main().catch(e => { console.error(e); fails++; }).finally(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { /* ignorer */ }
  console.log('\n' + (fails ? fails + ' ÉCHEC(S) sur ' + total : 'Tout est OK (' + total + ' vérifications)'));
  process.exit(fails ? 1 : 0);
});
