/* Test de bout en bout de l'API (serveur lancé sur NV_URL, base vide). Usage : node cms/tools/e2e.js [url] */
const http = require('http');
const BASE = new URL(process.argv[2] || 'http://localhost:8090');
let cookie = '';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

function req(method, path, body, headers) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : (typeof body === 'string' ? body : JSON.stringify(body)));
    const h = Object.assign({ 'X-NV': '1' }, headers || {});
    if (cookie) h.Cookie = cookie;
    if (data && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method, headers: h }, x => {
      const ch = []; x.on('data', c => ch.push(c));
      x.on('end', () => { const t = Buffer.concat(ch); const sc = x.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0]; let j = null; try { j = JSON.parse(t.toString()); } catch (e) { /* html */ } res({ status: x.statusCode, headers: x.headers, text: t.toString(), json: j }); });
    });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}

(async () => {
  console.log('Sécurité et accès');
  let r = await req('GET', '/api/pages'); ok(r.status === 401, 'API protégée sans connexion (401)');
  r = await req('POST', '/api/login', { email: 'x@y.z', password: 'bad' }, { 'X-NV': '' }); ok(r.status === 403, 'POST sans en-tête X-NV refusé (403)');
  r = await req('GET', '/backoffice/'); ok(r.status === 200 && /Back-office/.test(r.text), 'page /backoffice/ servie');
  ok(/noindex/.test(r.headers['x-robots-tag'] || ''), 'backoffice en noindex');
  r = await req('GET', '/../../etc/passwd'); ok(r.status === 404 || r.status === 400, 'traversée de dossier refusée');
  r = await req('GET', '/%2e%2e/%2e%2e/server.js'); ok(r.status === 404, 'traversée encodée refusée');
  r = await req('GET', '/'); ok(r.status === 200 && /<title>Société Navitrends/.test(r.text), 'accueil publié');
  r = await req('GET', '/inexistant/'); ok(r.status === 404 && /Cette page est introuvable/.test(r.text), 'page 404 personnalisée');
  r = await req('GET', '/sitemap.xml'); ok(r.status === 200 && /<urlset/.test(r.text), 'sitemap.xml');

  console.log('Compte administrateur');
  r = await req('GET', '/api/session'); ok(r.json.needsSetup === true, 'premier démarrage : création de compte demandée');
  r = await req('POST', '/api/setup', { email: 'admin@navitrends.test', password: 'court' }); ok(r.status === 400, 'mot de passe trop court refusé');
  r = await req('POST', '/api/setup', { name: 'Admin', email: 'admin@navitrends.test', password: 'MotDePasse-Solide-2026' }); ok(r.status === 200 && r.json.user, 'compte créé et connecté');
  ok(/HttpOnly/i.test(r.headers['set-cookie'][0]) && /SameSite=Strict/i.test(r.headers['set-cookie'][0]), 'cookie HttpOnly + SameSite=Strict');
  r = await req('POST', '/api/setup', { email: 'autre@x.fr', password: 'MotDePasse-Solide-2026' }); ok(r.status === 403, 'second /setup refusé');
  const saved = cookie; cookie = '';
  r = await req('POST', '/api/login', { email: 'admin@navitrends.test', password: 'faux-mot-de-passe' }); ok(r.status === 401, 'mauvais mot de passe refusé');
  r = await req('POST', '/api/login', { email: 'admin@navitrends.test', password: 'MotDePasse-Solide-2026' }); ok(r.status === 200, 'connexion valide');
  r = await req('GET', '/api/session'); ok(r.json.user && r.json.user.email === 'admin@navitrends.test', 'session reconnue');
  const forged = cookie.replace(/\.[^.]*$/, '.AAAA'); const good = cookie; cookie = forged;
  r = await req('GET', '/api/pages'); ok(r.status === 401, 'cookie falsifié refusé'); cookie = good; void saved;

  console.log('Contenu');
  r = await req('GET', '/api/config'); ok(r.json.schema && r.json.schema.sections.numbered, 'schémas des champs');
  r = await req('GET', '/api/pages'); ok(r.json.length >= 16, r.json.length + ' pages chargées');
  r = await req('GET', '/api/pages/a-propos'); ok(r.json.slug === 'a-propos' && r.json.sections.length > 3, 'lecture page « À propos »');
  const p = r.json; p.hero.tagline = 'ACCROCHE <b>TEST</b> & co'; p.sections.push({ type: 'text', label: 'Nouveau', h2: 'Section ajoutée {{ici}}', ps: ['Premier paragraphe', 'Second paragraphe'] });
  r = await req('PUT', '/api/pages/a-propos', p); ok(r.status === 200 && r.json.publish.pages > 0, 'enregistrement + publication automatique');
  r = await req('GET', '/a-propos/'); ok(/ACCROCHE &lt;b&gt;TEST&lt;\/b&gt; &amp; co/.test(r.text), 'texte publié et correctement échappé (anti-XSS)');
  ok(/Section ajoutée <span class="grad">ici<\/span>/.test(r.text), 'nouvelle section visible avec {{dégradé}}');
  r = await req('POST', '/api/pages', { title: 'Offre Spéciale 2026', tpl: 'default', hero: { label: 'Nouveau', theme: 'mint', tagline: 'Test' }, sections: [{ type: 'cta', h2: 'Contactez-nous', p: 'Merci' }] });
  ok(r.status === 200 && r.json.slug === 'offre-speciale-2026', 'création de page (slug automatique)');
  r = await req('GET', '/offre-speciale-2026/'); ok(r.status === 200 && /Contactez-nous/.test(r.text) && /t-mint/.test(r.text), 'nouvelle page en ligne');
  r = await req('GET', '/sitemap.xml'); ok(/offre-speciale-2026/.test(r.text), 'nouvelle page dans le sitemap');
  r = await req('POST', '/api/pages', { title: 'Doublon', slug: 'contact' }); ok(r.status === 409, 'adresse déjà prise refusée (409)');
  r = await req('POST', '/api/pages', { title: 'Admin', slug: 'backoffice' }); ok(r.status === 409, 'adresse réservée refusée (409)');
  r = await req('PUT', '/api/pages/offre-speciale-2026', { title: 'Offre brouillon', status: 'draft', hero: {}, sections: [] });
  r = await req('GET', '/offre-speciale-2026/'); ok(r.status === 404, 'page en brouillon retirée du site');
  r = await req('DELETE', '/api/pages/offre-speciale-2026'); ok(r.status === 200, 'suppression de page');

  r = await req('GET', '/api/home'); const home = r.json; home.hero.h1 = 'Titre accueil MODIFIÉ'; home.stats.push({ pre: '+', to: '99', suf: '', text: 'Nouveau chiffre' });
  r = await req('PUT', '/api/home', home); ok(r.status === 200, 'enregistrement accueil');
  r = await req('GET', '/'); ok(/Titre accueil MODIFIÉ/.test(r.text) && /Nouveau chiffre/.test(r.text), 'accueil mis à jour');

  r = await req('GET', '/api/cases'); const slug0 = r.json[0].slug;
  r = await req('GET', '/api/cases/' + slug0); const c = r.json; c.case.summary = 'RÉSUMÉ MODIFIÉ';
  r = await req('PUT', '/api/cases/' + slug0, c); ok(r.status === 200, 'enregistrement étude de cas');
  r = await req('GET', '/etudes-de-cas/'); ok(/RÉSUMÉ MODIFIÉ/.test(r.text), 'étude de cas mise à jour dans la liste');
  r = await req('POST', '/api/cases', { title: 'Nouveau client test', case: { group: 'Sur mesure', theme: 'gold', summary: 'Résumé' }, sections: [] });
  ok(r.status === 200, 'création étude de cas'); r = await req('GET', '/etudes-de-cas/nouveau-client-test/'); ok(r.status === 200, 'étude de cas en ligne');

  r = await req('GET', '/api/faq'); const faq = r.json; faq[0].items.unshift({ q: 'Question de test ?', a: 'Réponse de test.' });
  r = await req('PUT', '/api/faq', { categories: faq }); ok(r.status === 200, 'enregistrement FAQ');
  r = await req('GET', '/faq/'); ok(/Question de test \?/.test(r.text) && /FAQPage/.test(r.text), 'FAQ publiée + données structurées');

  r = await req('GET', '/api/articles'); const arts = r.json; arts.unshift({ title: 'Article interne test', date: '2026-11-16', body: 'Premier paragraphe.\n\nSecond.', cat: 'ERP', img: '', url: '', status: 'publish' });
  r = await req('PUT', '/api/articles', { articles: arts }); ok(r.status === 200, 'ajout article');
  r = await req('GET', '/article-interne-test/'); ok(r.status === 200 && /Second\./.test(r.text), 'page d’article créée');
  r = await req('GET', '/insights/'); ok(/Article interne test/.test(r.text), 'article listé sur Insights');

  console.log('Réglages, images, formulaires');
  r = await req('GET', '/api/settings'); const s = r.json; s.tn_email = 'nouveau@navitrends.test'; s.form_to = 'recoit@navitrends.test';
  r = await req('PUT', '/api/settings', s); ok(r.status === 200, 'enregistrement réglages');
  r = await req('GET', '/contact/'); ok(/nouveau@navitrends\.test/.test(r.text), 'coordonnées mises à jour sur le site');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  r = await req('POST', '/api/upload', png, { 'Content-Type': 'application/octet-stream', 'X-Filename': 'Mon%20Logo%20%C3%89t%C3%A9.png' });
  ok(r.status === 200 && /^\/uploads\/\d{4}\/\d{2}\/mon-logo-ete-/.test(r.json.url), 'téléversement image (' + (r.json.url || r.text) + ')');
  const up = r.json.url; r = await req('GET', up); ok(r.status === 200, 'image servie');
  r = await req('POST', '/api/upload', Buffer.from('<script>alert(1)</script>'), { 'Content-Type': 'application/octet-stream', 'X-Filename': 'x.png' }); ok(r.status === 415, 'fichier non-image refusé');
  r = await req('POST', '/api/upload', Buffer.concat([Buffer.from('<svg onload=alert(1)>')]), { 'Content-Type': 'application/octet-stream', 'X-Filename': 'x.svg' }); ok(r.status === 415, 'SVG refusé');
  r = await req('DELETE', '/api/upload?name=' + encodeURIComponent('../../data/users.json')); ok(r.status === 404, 'suppression hors dossier refusée');

  const form = (path, o) => req('POST', path, new URLSearchParams(o).toString(), { 'Content-Type': 'application/x-www-form-urlencoded', 'X-NV': '' });
  r = await form('/forms/contact', { nom: 'Client Test', email: 'client@example.com', message: 'Bonjour, test.', nv_back: '/contact/', nv_page: 'contact', website: '' });
  ok(r.status === 303 && /nv_sent=1/.test(r.headers.location), 'formulaire contact → redirection ?nv_sent=1');
  r = await form('/forms/devis', { nom: 'Devis Test', email: 'd@example.com', projet: 'Un ERP', societe: 'ACME', nv_back: '/devis/', nv_page: 'devis' }); ok(/nv_sent=1/.test(r.headers.location), 'formulaire devis enregistré');
  r = await form('/forms/newsletter', { email: 'n@example.com', nv_back: '/' }); ok(/nv_news=ok/.test(r.headers.location), 'newsletter enregistrée');
  r = await form('/forms/contact', { nom: 'Bot', email: 'bot@example.com', message: 'spam', website: 'http://spam', nv_back: '/contact/' }); ok(r.status === 303 && !/nv_sent/.test(r.headers.location), 'champ piège : rien enregistré');
  r = await form('/forms/contact', { nom: '', email: 'pas-un-mail', message: 'x', nv_back: '/contact/' }); ok(/nv_err=1/.test(r.headers.location), 'champs invalides → ?nv_err=1');
  r = await form('/forms/contact', { nom: 'A', email: 'a@b.fr', message: 'x', nv_back: 'https://evil.example/' }); ok(!/evil/.test(r.headers.location), 'redirection externe neutralisée');
  r = await req('GET', '/api/requests'); const kinds = r.json.map(x => x.kind).join(',');
  ok(r.json.length === 4 && /Contact/.test(kinds) && /Devis/.test(kinds) && /Newsletter/.test(kinds), r.json.length + ' demandes enregistrées (' + kinds + ')');
  ok(r.json.every(x => x.mail && x.mail.ok === false), 'e-mail non envoyé car SMTP non configuré (statut conservé)');
  await form('/forms/contact', { nom: 'A', email: 'a@b.fr', message: 'x', nv_back: '/contact/' }); await form('/forms/contact', { nom: 'A', email: 'a@b.fr', message: 'x', nv_back: '/contact/' });
  r = await form('/forms/contact', { nom: 'A', email: 'a@b.fr', message: 'x', nv_back: '/contact/' }); r = await form('/forms/contact', { nom: 'A', email: 'a@b.fr', message: 'x', nv_back: '/contact/' });
  ok(/nv_err=1/.test(r.headers.location), 'limitation du nombre d’envois par adresse IP');

  console.log('Comptes et sauvegarde');
  r = await req('POST', '/api/users', { name: 'Second', email: 'second@navitrends.test', password: 'AutreMotDePasse-2026' }); ok(r.status === 200, 'ajout d’un second administrateur');
  r = await req('GET', '/api/users'); ok(r.json.length === 2 && !JSON.stringify(r.json).includes('hash'), 'liste des comptes sans hachage exposé');
  r = await req('DELETE', '/api/users/' + r.json.find(u => u.email === 'admin@navitrends.test').id); ok(r.status === 400, 'impossible de se supprimer soi-même');
  r = await req('POST', '/api/password', { current: 'mauvais', password: 'NouveauMotDePasse-2026' }); ok(r.status === 400, 'changement de mot de passe : ancien incorrect refusé');
  r = await req('GET', '/api/export'); ok(r.status === 200 && r.json.pages && r.json.settings, 'export de sauvegarde');
  const bk = r.json;
  r = await req('POST', '/api/import', { pages: [] }); ok(r.status === 400, 'import invalide refusé');
  r = await req('POST', '/api/import', bk); ok(r.status === 200, 'import de la sauvegarde');
  r = await req('POST', '/api/logout', {}); cookie = ''; r = await req('GET', '/api/pages'); ok(r.status === 401, 'déconnexion');

  console.log(fails ? '\n' + fails + ' ÉCHEC(S)' : '\nTout est OK');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
