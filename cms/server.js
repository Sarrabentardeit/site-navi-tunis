/* Serveur Navitrends : site public + back-office (/backoffice) + API + formulaires.
   Aucune dépendance : Node.js 18+ suffit.   Démarrage : node cms/server.js   (PORT, HOST facultatifs) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');
const auth = require('./lib/auth');
const mail = require('./lib/mail');
const { publish, SITE, UPLOADS } = require('./lib/publish');
const sch = require('./lib/schema.json');

const PORT = parseInt(process.env.PORT, 10) || 8080;
/* Sous Windows, 0.0.0.0 n'écoute pas localhost (::1). Sans HOST → toutes les interfaces. */
const HOST = process.env.HOST || undefined;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const ADMIN = path.join(__dirname, 'admin');

/* ---------- premier démarrage ---------- */
if (!fs.existsSync(path.join(store.DATA, 'pages.json'))) { console.log('Premier démarrage : création du contenu…'); require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'seed.js')], { stdio: 'inherit' }); }
let lastPublish = null;
const doPublish = () => { lastPublish = publish(); return lastPublish; };
if (!fs.existsSync(path.join(SITE, 'index.html'))) { doPublish(); console.log('Site publié :', lastPublish.pages, 'pages'); }

/* ---------- utilitaires ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const clientIp = req => (TRUST_PROXY && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress) || 'x';
const isSecure = req => !!req.socket.encrypted || (TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https');

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Fichier ou requête trop volumineux.'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const json = (res, status, obj, headers) => { const b = JSON.stringify(obj); res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, headers)); res.end(b); };
const fail = (status, message) => Object.assign(new Error(message), { status });

function sendFile(req, res, file, extra) {
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return notFound(req, res);
    const ext = path.extname(file).toLowerCase();
    const etag = '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
    const h = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'X-Content-Type-Options': 'nosniff' }, extra);
    if (!h['Cache-Control']) h['Cache-Control'] = ext === '.html' || ext === '.xml' || ext === '.txt' ? 'public, max-age=0, must-revalidate' : 'public, max-age=86400';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    res.writeHead(200, Object.assign(h, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}
function notFound(req, res) {
  const f = path.join(SITE, '404.html');
  fs.readFile(f, (e, b) => { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(e ? 'Page introuvable' : b); });
}
function safeJoin(root, rel) {
  let d; try { d = decodeURIComponent(rel); } catch (e) { return null; }
  if (d.indexOf('\0') >= 0) return null;
  const p = path.normalize(path.join(root, d));
  return p.startsWith(root + path.sep) || p === root ? p : null;
}

/* ---------- validation du contenu ---------- */
const RESERVED = ['backoffice', 'api', 'assets', 'uploads', 'forms', 'etudes-de-cas', 'page', 'sitemap.xml', 'robots.txt', '404.html', 'index.html'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPES = Object.keys(sch.types);
function slugTaken(slug, except) {
  const d = store.all();
  const used = new Set();
  d.pages.forEach(p => used.add('p:' + p.slug));
  d.articles.forEach(a => { if (a.body && String(a.body).trim()) used.add('a:' + (a.slug || '')); });
  return RESERVED.includes(slug) || [...used].some(u => u.slice(2) === slug && u !== except);
}
const str = (v, max = 20000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const arr = v => (Array.isArray(v) ? v : []);

function cleanPage(b, slug) {
  if (!str(b.title).trim()) throw fail(400, 'Le titre est obligatoire.');
  const tpl = TYPES.includes(b.tpl) ? b.tpl : 'default';
  return {
    slug, title: str(b.title, 200).trim(), tpl, menu: b.menu === 'about' ? 'about' : '', order: Number.isFinite(+b.order) ? +b.order : 500,
    status: b.status === 'draft' ? 'draft' : 'publish',
    hero: obj(b.hero), service: obj(b.service), extra: obj(b.extra), sections: arr(b.sections).filter(s => s && typeof s === 'object'),
    seo: { title: str(obj(b.seo).title, 300), desc: str(obj(b.seo).desc, 500) }
  };
}
function cleanCase(b, slug) {
  if (!str(b.title).trim()) throw fail(400, 'Le titre est obligatoire.');
  return {
    slug, title: str(b.title, 200).trim(), order: Number.isFinite(+b.order) ? +b.order : 500, status: b.status === 'draft' ? 'draft' : 'publish',
    case: obj(b.case), sections: arr(b.sections).filter(s => s && typeof s === 'object'),
    seo: { title: str(obj(b.seo).title, 300), desc: str(obj(b.seo).desc, 500) }
  };
}
function cleanArticle(b) {
  if (!str(b.title).trim()) throw fail(400, 'Le titre est obligatoire.');
  const a = {
    id: str(b.id, 40) || ('a' + crypto.randomBytes(5).toString('hex')), title: str(b.title, 300).trim(), date: /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : new Date().toISOString().slice(0, 10),
    img: str(b.img, 500), url: str(b.url, 800), cat: str(b.cat, 120), slug: str(b.slug, 100).trim(), body: str(b.body, 100000), status: b.status === 'draft' ? 'draft' : 'publish'
  };
  const R = require('./lib/render');
  if (a.body.trim()) {
    a.slug = R.slugify(a.slug || a.title).slice(0, 80);
    if (!SLUG.test(a.slug)) throw fail(400, 'Adresse (slug) invalide.');
    if (RESERVED.includes(a.slug) || store.read('pages', []).some(p => p.slug === a.slug) || store.read('articles', []).some(x => x.id !== a.id && x.body && x.body.trim() && R.articleSlug(x) === a.slug)) throw fail(409, 'Cette adresse est déjà utilisée par une autre page.');
  }
  return a;
}
const cleanSettings = b => {
  const cur = store.read('settings', {});
  const out = Object.assign({}, cur);
  Object.keys(sch.settingsFields).concat(['site_name', 'site_url', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'mail_from']).forEach(k => { if (k in b) out[k] = str(b[k], 2000); });
  if ('smtp_pass' in b && b.smtp_pass !== '__keep__') out.smtp_pass = str(b.smtp_pass, 500);
  if ('blog_cats' in b) out.blog_cats = arr(b.blog_cats).map(c => ({ name: str(c.name, 150), url: str(c.url, 500) })).filter(c => c.name);
  if (out.site_url) out.site_url = out.site_url.replace(/\/+$/, '');
  return out;
};
const cleanFaq = b => arr(b).map(c => ({ name: str(c.name, 200), items: arr(c.items).map(i => ({ q: str(i.q, 500), a: str(i.a, 10000) })).filter(i => i.q) })).filter(c => c.name);
const maskSettings = s => Object.assign({}, s, { smtp_pass: s.smtp_pass ? '__keep__' : '' });

/* ---------- formulaires publics ---------- */
const FORMS = {
  contact: { kind: 'Contact', fields: { nom: ['Nom', 1], email: ['Email', 1], message: ['Message', 1] } },
  devis: { kind: 'Devis', fields: { nom: ['Nom', 1], telephone: ['Téléphone', 0], email: ['Email', 1], societe: ['Société', 0], services: ['Services', 0], projet: ['Projet', 1] } },
  newsletter: { kind: 'Newsletter', fields: { email: ['Email', 1] } }
};
const rate = new Map();
const cleanLine = s => String(s || '').replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 300);
const cleanText = s => String(s || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, 5000);

async function handleForm(req, res, kindKey) {
  const def = FORMS[kindKey]; const isNews = kindKey === 'newsletter';
  const raw = (await readBody(req, 60 * 1024)).toString('utf8');
  const f = Object.fromEntries(new URLSearchParams(raw));
  let back = String(f.nv_back || '/'); if (!/^\/[^/\\]/.test(back) && back !== '/') back = '/';
  back = back.split('?')[0].split('#')[0];
  const go = (qs, hash) => { res.writeHead(303, { Location: back + (qs ? '?' + qs : '') + (hash || '') }); res.end(); };
  const bad = () => go(isNews ? 'nv_news=err' : 'nv_err=1', isNews ? '#newsletter' : '#formulaire');
  if (f.website) return go('');                       // champ piège : on fait semblant
  const ip = clientIp(req); const now = Date.now();
  const hits = (rate.get(ip) || []).filter(t => now - t < 600000);
  if (hits.length >= 6) return bad();
  hits.push(now); rate.set(ip, hits);
  const data = {};
  for (const [k, d] of Object.entries(def.fields)) {
    const v = (k === 'message' || k === 'projet') ? cleanText(f[k]) : cleanLine(f[k]);
    if (d[1] && !v) return bad();
    if (k === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return bad();
    if (v) data[d[0]] = v;
  }
  const settings = store.read('settings', {});
  const page = store.read('pages', []).find(p => p.slug === f.nv_page);
  const extra = page ? obj(page.extra) : {};
  const subject = extra.subject || (isNews ? 'Inscription à la newsletter' : def.kind + ' via ' + String(settings.site_url || '').replace(/^https?:\/\//, ''));
  const who = data['Nom'] || data['Email'] || '';
  const text = Object.entries(data).map(([k, v]) => k + ' : ' + v).join('\n') + '\n\nPage : ' + back;
  const rec = { id: crypto.randomBytes(6).toString('hex'), kind: def.kind, date: new Date().toISOString(), data, origin: back, read: false, mail: { ok: false, error: 'En attente' } };
  const list = store.read('requests', []); list.unshift(rec); store.write('requests', list.slice(0, 3000));
  go(isNews ? 'nv_news=ok' : 'nv_sent=1', isNews ? '#newsletter' : '#formulaire');
  /* envoi de l'e-mail en arrière-plan (la demande est déjà enregistrée) */
  mail.send(settings, { to: settings.form_to, subject: '[' + (settings.site_name || 'Navitrends') + '] ' + subject + (who ? ' – ' + who : ''), text, replyTo: data['Email'] ? (data['Nom'] ? data['Nom'].replace(/[<>",]/g, '') + ' ' : '') + '<' + data['Email'] + '>' : '' })
    .then(() => ({ ok: true })).catch(e => ({ ok: false, error: String(e.message || e).slice(0, 300) }))
    .then(r => { const l = store.read('requests', []); const x = l.find(y => y.id === rec.id); if (x) { x.mail = r; store.write('requests', l); } if (!r.ok) console.warn('E-mail non envoyé :', r.error); });
}

/* ---------- images ---------- */
const IMG_TYPES = [
  { ext: '.png', test: b => b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: '.jpg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.gif', test: b => b.slice(0, 4).toString() === 'GIF8' },
  { ext: '.webp', test: b => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' }
];
function listFiles(dir, rel, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
    if (e.isDirectory()) listFiles(path.join(dir, e.name), rel + e.name + '/', out);
    else if (/\.(png|jpe?g|gif|webp|svg)$/i.test(e.name)) { const st = fs.statSync(path.join(dir, e.name)); out.push({ rel: rel + e.name, size: st.size, mtime: st.mtimeMs }); }
  });
  return out;
}

/* ---------- API d'administration ---------- */
async function api(req, res, url) {
  const m = req.method; const p = url.pathname.replace(/^\/api/, '') || '/';
  const sec = isSecure(req);
  const body = async (limit = 6 * 1024 * 1024) => { try { return JSON.parse((await readBody(req, limit)).toString('utf8') || '{}'); } catch (e) { if (e.status) throw e; throw fail(400, 'Requête invalide.'); } };

  if (m !== 'GET' && m !== 'HEAD' && req.headers['x-nv'] !== '1') throw fail(403, 'Requête refusée.');

  /* sessions */
  if (p === '/session' && m === 'GET') {
    const u = auth.userFromReq(req);
    return json(res, 200, { user: auth.publicUser(u), needsSetup: auth.users().length === 0 });
  }
  if (p === '/setup' && m === 'POST') {
    if (auth.users().length) throw fail(403, 'Un compte administrateur existe déjà.');
    const b = await body(); const u = auth.addUser({ name: b.name, email: b.email, password: b.password });
    return json(res, 200, { user: auth.publicUser(u) }, { 'Set-Cookie': auth.cookieHeader(auth.makeToken(u), sec) });
  }
  if (p === '/login' && m === 'POST') {
    const b = await body(1024 * 10); const key = clientIp(req);
    if (auth.throttled(key)) throw fail(429, 'Trop de tentatives. Réessayez dans quelques minutes.');
    const email = String(b.email || '').trim().toLowerCase();
    const u = auth.users().find(x => x.email === email);
    const good = auth.checkPassword(String(b.password || ''), u ? u.hash : '');
    if (!u || !good) { auth.fail(key); throw fail(401, 'Adresse e-mail ou mot de passe incorrect.'); }
    auth.ok(key);
    return json(res, 200, { user: auth.publicUser(u) }, { 'Set-Cookie': auth.cookieHeader(auth.makeToken(u), sec) });
  }
  if (p === '/logout' && m === 'POST') return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader('', sec, true) });

  const me = auth.userFromReq(req);
  if (!me) throw fail(401, 'Veuillez vous connecter.');

  /* configuration de l'éditeur */
  if (p === '/config' && m === 'GET') return json(res, 200, { schema: sch.schema, types: sch.types, extraDefaults: sch.extraDefaults, themes: sch.themes, settingsDefaults: sch.settingsFields });

  if (p === '/status' && m === 'GET') {
    const reqs = store.read('requests', []);
    return json(res, 200, { lastPublish, requests: reqs.length, unread: reqs.filter(r => !r.read).length, unsent: reqs.filter(r => r.kind !== 'Newsletter' && r.mail && !r.mail.ok && r.mail.error !== 'En attente').length, counts: { pages: store.read('pages', []).length, cases: store.read('cases', []).length, articles: store.read('articles', []).length } });
  }
  if (p === '/publish' && m === 'POST') return json(res, 200, doPublish());

  /* réglages, accueil, FAQ : documents entiers */
  if (p === '/settings') {
    if (m === 'GET') return json(res, 200, maskSettings(store.read('settings', {})));
    if (m === 'PUT') { store.write('settings', cleanSettings(await body())); return json(res, 200, { ok: true, publish: doPublish() }); }
  }
  if (p === '/home') {
    if (m === 'GET') return json(res, 200, store.read('home', {}));
    if (m === 'PUT') { const b = await body(); if (!b || Array.isArray(b)) throw fail(400, 'Contenu invalide.'); store.write('home', b); return json(res, 200, { ok: true, publish: doPublish() }); }
  }
  if (p === '/faq') {
    if (m === 'GET') return json(res, 200, store.read('faq', []));
    if (m === 'PUT') { store.write('faq', cleanFaq((await body()).categories)); return json(res, 200, { ok: true, publish: doPublish() }); }
  }

  /* pages */
  let mm;
  if (p === '/pages' && m === 'GET') return json(res, 200, store.read('pages', []).map(x => ({ slug: x.slug, title: x.title, tpl: x.tpl, menu: x.menu, order: x.order, status: x.status || 'publish', sections: (x.sections || []).length })));
  if ((mm = /^\/pages\/([a-z0-9-]+)$/.exec(p))) {
    const slug = mm[1]; const list = store.read('pages', []); const i = list.findIndex(x => x.slug === slug);
    if (m === 'GET') { if (i < 0) throw fail(404, 'Page introuvable.'); return json(res, 200, list[i]); }
    if (m === 'PUT') {
      const b = await body(); let ns = slug;
      if (b.slug && b.slug !== slug) { if (!SLUG.test(b.slug)) throw fail(400, 'Adresse (slug) invalide : lettres minuscules, chiffres et tirets.'); if (slugTaken(b.slug)) throw fail(409, 'Cette adresse est déjà utilisée.'); ns = b.slug; }
      else if (i < 0) { if (slugTaken(slug)) throw fail(409, 'Cette adresse est déjà utilisée.'); }
      const item = cleanPage(b, ns);
      if (i >= 0) list[i] = item; else list.push(item);
      store.write('pages', list); return json(res, 200, { ok: true, slug: ns, publish: doPublish() });
    }
    if (m === 'DELETE') { if (i < 0) throw fail(404, 'Page introuvable.'); list.splice(i, 1); store.write('pages', list); return json(res, 200, { ok: true, publish: doPublish() }); }
  }
  if (p === '/pages' && m === 'POST') { // création
    const b = await body(); const slug = require('./lib/render').slugify(b.slug || b.title).slice(0, 80);
    if (!SLUG.test(slug)) throw fail(400, 'Adresse (slug) invalide.'); if (slugTaken(slug)) throw fail(409, 'Cette adresse est déjà utilisée.');
    const list = store.read('pages', []); const item = cleanPage(Object.assign({ order: 500 }, b), slug); list.push(item); store.write('pages', list);
    return json(res, 200, { ok: true, slug, publish: doPublish() });
  }

  /* études de cas */
  if (p === '/cases' && m === 'GET') return json(res, 200, store.read('cases', []).map(x => ({ slug: x.slug, title: x.title, order: x.order, status: x.status || 'publish', group: (x.case || {}).group, client: (x.case || {}).client })));
  if (p === '/cases' && m === 'POST') {
    const b = await body(); const slug = require('./lib/render').slugify(b.slug || b.title).slice(0, 80);
    if (!SLUG.test(slug)) throw fail(400, 'Adresse (slug) invalide.');
    const list = store.read('cases', []); if (list.some(x => x.slug === slug)) throw fail(409, 'Cette adresse est déjà utilisée.');
    list.push(cleanCase(Object.assign({ order: 500 }, b), slug)); store.write('cases', list);
    return json(res, 200, { ok: true, slug, publish: doPublish() });
  }
  if ((mm = /^\/cases\/([a-z0-9-]+)$/.exec(p))) {
    const slug = mm[1]; const list = store.read('cases', []); const i = list.findIndex(x => x.slug === slug);
    if (m === 'GET') { if (i < 0) throw fail(404, 'Étude de cas introuvable.'); return json(res, 200, list[i]); }
    if (m === 'PUT') {
      const b = await body(); let ns = slug;
      if (b.slug && b.slug !== slug) { if (!SLUG.test(b.slug)) throw fail(400, 'Adresse (slug) invalide.'); if (list.some(x => x.slug === b.slug)) throw fail(409, 'Cette adresse est déjà utilisée.'); ns = b.slug; }
      const item = cleanCase(b, ns); if (i >= 0) list[i] = item; else list.push(item);
      store.write('cases', list); return json(res, 200, { ok: true, slug: ns, publish: doPublish() });
    }
    if (m === 'DELETE') { if (i < 0) throw fail(404, 'Étude de cas introuvable.'); list.splice(i, 1); store.write('cases', list); return json(res, 200, { ok: true, publish: doPublish() }); }
  }

  /* ordre des pages / études de cas */
  if ((mm = /^\/order\/(pages|cases)$/.exec(p)) && m === 'POST') {
    const ids = arr((await body()).slugs); const list = store.read(mm[1], []);
    ids.forEach((s, k) => { const x = list.find(y => y.slug === s); if (x) x.order = (k + 1) * 10; });
    store.write(mm[1], list); return json(res, 200, { ok: true, publish: doPublish() });
  }

  /* articles */
  if (p === '/articles' && m === 'GET') return json(res, 200, store.read('articles', []));
  if (p === '/articles' && m === 'PUT') { // liste complète (réorganisation, suppression)
    const b = await body(); const list = arr(b.articles).map(a => cleanArticle(a));
    store.write('articles', list); return json(res, 200, { ok: true, publish: doPublish() });
  }

  /* demandes reçues */
  if (p === '/requests' && m === 'GET') return json(res, 200, store.read('requests', []));
  if ((mm = /^\/requests\/([a-f0-9]+)$/.exec(p))) {
    const list = store.read('requests', []); const i = list.findIndex(x => x.id === mm[1]); if (i < 0) throw fail(404, 'Demande introuvable.');
    if (m === 'PATCH') { const b = await body(); if ('read' in b) list[i].read = !!b.read; store.write('requests', list); return json(res, 200, { ok: true }); }
    if (m === 'DELETE') { list.splice(i, 1); store.write('requests', list); return json(res, 200, { ok: true }); }
  }
  if (p === '/test-mail' && m === 'POST') {
    const b = await body(); const s = store.read('settings', {});
    try { await mail.send(s, { to: b.to || s.form_to, subject: 'Test d’envoi – back-office Navitrends', text: 'Si vous lisez ce message, l’envoi d’e-mails fonctionne.' }); return json(res, 200, { ok: true }); }
    catch (e) { return json(res, 200, { ok: false, error: String(e.message || e) }); }
  }

  /* images */
  if (p === '/media' && m === 'GET') {
    const up = listFiles(UPLOADS, '', []).map(f => ({ url: '/uploads/' + f.rel, name: f.rel, size: f.size, mtime: f.mtime, own: true })).sort((a, b) => b.mtime - a.mtime);
    const th = listFiles(path.join(__dirname, 'static', 'img'), '', []).map(f => ({ url: '/assets/img/' + f.rel, name: f.rel, size: f.size, own: false }));
    return json(res, 200, { uploads: up, theme: th });
  }
  if (p === '/upload' && m === 'POST') {
    const buf = await readBody(req, 8 * 1024 * 1024);
    const t = IMG_TYPES.find(x => buf.length > 12 && x.test(buf));
    if (!t) throw fail(415, 'Format non accepté : utilisez une image PNG, JPG, WebP ou GIF.');
    const orig = decodeURIComponent(String(req.headers['x-filename'] || 'image')).replace(/\.[^.]*$/, '');
    const name = (require('./lib/render').slugify(orig) || 'image').slice(0, 50) + '-' + crypto.randomBytes(3).toString('hex') + t.ext;
    const d = new Date(); const rel = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + name;
    const f = path.join(UPLOADS, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
    const dst = path.join(SITE, 'uploads', rel); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.writeFileSync(dst, buf);
    return json(res, 200, { url: '/uploads/' + rel, name: rel });
  }
  if (p === '/upload' && m === 'DELETE') {
    const rel = String(url.searchParams.get('name') || ''); const f = safeJoin(UPLOADS, rel);
    if (!f || !fs.existsSync(f)) throw fail(404, 'Fichier introuvable.');
    fs.unlinkSync(f); try { fs.unlinkSync(path.join(SITE, 'uploads', rel)); } catch (e) { /* déjà absent */ }
    return json(res, 200, { ok: true });
  }

  /* comptes */
  if (p === '/users' && m === 'GET') return json(res, 200, auth.users().map(auth.publicUser));
  if (p === '/users' && m === 'POST') { const b = await body(); const u = auth.addUser(b); return json(res, 200, auth.publicUser(u)); }
  if ((mm = /^\/users\/([a-f0-9]+)$/.exec(p)) && m === 'PUT') {
    const u = auth.updateUser(mm[1], await body());
    return json(res, 200, auth.publicUser(u));
  }
  if ((mm = /^\/users\/([a-f0-9]+)$/.exec(p)) && m === 'DELETE') {
    const list = auth.users();
    if (list.length <= 1) throw fail(400, 'Impossible de supprimer le dernier compte administrateur. Créez d’abord un autre compte.');
    if (!list.some(u => u.id === mm[1])) throw fail(404, 'Compte introuvable.');
    auth.saveUsers(list.filter(u => u.id !== mm[1]));
    /* si on supprime sa propre session, déconnexion */
    if (mm[1] === me.id) {
      res.setHeader('Set-Cookie', auth.cookieHeader('', !!(req.socket.encrypted || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https')), true));
    }
    return json(res, 200, { ok: true });
  }
  if (p === '/password' && m === 'POST') {
    const b = await body();
    if (!auth.checkPassword(String(b.current || ''), me.hash)) throw fail(400, 'Mot de passe actuel incorrect.');
    if (String(b.password || '').length < 10) throw fail(400, 'Le nouveau mot de passe doit contenir au moins 10 caractères.');
    const list = auth.users(); list.find(u => u.id === me.id).hash = auth.hashPassword(b.password); auth.saveUsers(list);
    return json(res, 200, { ok: true });
  }

  /* sauvegarde complète */
  if (p === '/export' && m === 'GET') {
    const all = store.all(); delete all.mocks; all.requests = store.read('requests', []);
    const b = JSON.stringify(all, null, 1);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="navitrends-sauvegarde-' + new Date().toISOString().slice(0, 10) + '.json"', 'Cache-Control': 'no-store' });
    return res.end(b);
  }
  if (p === '/import' && m === 'POST') {
    const b = await body(30 * 1024 * 1024);
    if (!b || typeof b !== 'object' || !Array.isArray(b.pages) || !Array.isArray(b.cases) || !b.settings) throw fail(400, 'Ce fichier n’est pas une sauvegarde Navitrends valide.');
    ['settings', 'home', 'pages', 'cases', 'faq', 'articles'].forEach(n => { if (b[n] != null) store.write(n, b[n]); });
    if (Array.isArray(b.requests)) store.write('requests', b.requests);
    return json(res, 200, { ok: true, publish: doPublish() });
  }

  throw fail(404, 'Route inconnue.');
}

/* ---------- serveur HTTP ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const pathname = url.pathname;
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    if (pathname.startsWith('/api/')) {
      res.setHeader('X-Frame-Options', 'DENY');
      try { return await api(req, res, url); }
      catch (e) { if (!e.status) console.error(e); return json(res, e.status || 500, { error: e.status ? e.message : 'Erreur interne du serveur.' }); }
    }

    if (pathname === '/backoffice') { res.writeHead(301, { Location: '/backoffice/' }); return res.end(); }
    if (pathname.startsWith('/backoffice/')) {
      const rel = pathname.slice('/backoffice/'.length) || 'index.html';
      const f = safeJoin(ADMIN, rel === '' ? 'index.html' : rel);
      if (!f) return notFound(req, res);
      return sendFile(req, res, f, { 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'" });
    }

    if (pathname.startsWith('/forms/') && req.method === 'POST') {
      const k = pathname.slice(7).replace(/\/$/, '');
      if (FORMS[k]) return await handleForm(req, res, k);
      return notFound(req, res);
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD, POST' }); return res.end(); }

    /* site public */
    let f = safeJoin(SITE, pathname.replace(/^\//, ''));
    if (!f) return notFound(req, res);
    fs.stat(f, (err, st) => {
      if (!err && st.isDirectory()) {
        if (!pathname.endsWith('/')) { res.writeHead(301, { Location: pathname + '/' + url.search }); return res.end(); }
        return sendFile(req, res, path.join(f, 'index.html'));
      }
      return sendFile(req, res, f);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(e.status || 500, { 'Content-Type': 'text/plain; charset=utf-8' }); }
    res.end(e.status ? e.message : 'Erreur interne du serveur.');
  }
});

/* commande : node cms/server.js user add email motdepasse [nom] */
if (process.argv[2] === 'user' && process.argv[3] === 'add') {
  try { const u = auth.addUser({ email: process.argv[4], password: process.argv[5], name: process.argv[6] }); console.log('Compte créé :', u.email); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
} else {
  const onReady = () => {
    console.log('Navitrends — site : http://localhost:' + PORT + '/   back-office : http://localhost:' + PORT + '/backoffice/');
    if (!auth.users().length) console.log('Aucun compte administrateur : ouvrez /backoffice/ pour créer le premier.');
  };
  if (HOST) server.listen(PORT, HOST, onReady);
  else server.listen(PORT, onReady);
}
