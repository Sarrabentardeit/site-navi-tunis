/* Module SEO Navitrends (sans dépendance).
   - Audit « en direct » : chaque page est rendue puis analysée comme Google la voit
     (titre, meta, H1, contenu, images, canonical, données structurées, liens internes).
   - Suggestions de correction applicables en un clic.
   - Suivi des 404 avec redirection suggérée, gestion des redirections 301/302. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const R = require('./render');

const SITE = process.env.NV_SITE || path.join(store.ROOT, 'site');
const T_MIN = 30, T_MAX = 60, D_MIN = 70, D_MAX = 160;
const MAX_404 = 500;
const MAX_HISTORY = 60;

const now = () => new Date().toISOString();
const rid = () => crypto.randomBytes(6).toString('hex');
const hid = (...a) => crypto.createHash('sha1').update(a.join('|')).digest('hex').slice(0, 10);
const text = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const len = s => text(s).length;
const fail = (status, message) => Object.assign(new Error(message), { status });
const noAccent = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');

function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function normPath(p) {
  let s = String(p || '').trim();
  if (!s) return '/';
  try { s = decodeURIComponent(s); } catch (e) { /* garder brut */ }
  s = s.split('?')[0].split('#')[0];
  if (!s.startsWith('/')) s = '/' + s;
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s || '/';
}
const key = p => normPath(p).toLowerCase();

/* ====================================================================
   Catalogue des contrôles
   ==================================================================== */
const CATS = {
  meta: 'Titres et descriptions',
  content: 'Contenu',
  technical: 'Technique',
  links: 'Liens internes',
  media: 'Images'
};
const CODES = {
  title_missing: { sev: 'high', cat: 'meta', pts: 25, t: 'Titre SEO manquant', tip: 'Chaque page doit avoir un titre unique de 30 à 60 caractères.' },
  title_long: { sev: 'med', cat: 'meta', pts: 8, t: 'Titre trop long (tronqué dans Google)', tip: 'Au-delà de 60 caractères, Google coupe le titre. Raccourcissez-le.' },
  title_short: { sev: 'low', cat: 'meta', pts: 4, t: 'Titre trop court', tip: 'Un titre plus descriptif (30–60 car.) améliore le taux de clic.' },
  desc_missing: { sev: 'high', cat: 'meta', pts: 20, t: 'Description Google manquante', tip: 'Ajoutez une description de 70 à 160 caractères qui donne envie de cliquer.' },
  desc_long: { sev: 'med', cat: 'meta', pts: 6, t: 'Description trop longue (tronquée dans Google)', tip: 'Au-delà de 160 caractères, Google coupe la description.' },
  desc_short: { sev: 'low', cat: 'meta', pts: 4, t: 'Description trop courte', tip: 'Développez-la (70–160 car.) pour mieux vendre la page.' },
  dup_title: { sev: 'high', cat: 'meta', pts: 12, t: 'Titre dupliqué', tip: 'Deux pages avec le même titre se concurrencent. Rendez chaque titre unique.' },
  dup_desc: { sev: 'med', cat: 'meta', pts: 8, t: 'Description dupliquée', tip: 'Rédigez une description propre à chaque page.' },
  h1_missing: { sev: 'high', cat: 'content', pts: 15, t: 'Titre principal (H1) manquant', tip: 'Chaque page a besoin d’un H1 clair contenant son sujet.' },
  h1_multiple: { sev: 'med', cat: 'content', pts: 6, t: 'Plusieurs titres principaux (H1)', tip: 'Gardez un seul H1 par page.' },
  thin_content: { sev: 'med', cat: 'content', pts: 8, t: 'Contenu trop léger', tip: 'Moins de 150 mots : ajoutez du contenu utile (cas d’usage, bénéfices, FAQ).' },
  h2_none: { sev: 'low', cat: 'content', pts: 3, t: 'Aucun sous-titre (H2)', tip: 'Structurez les pages longues avec des sous-titres.' },
  img_alt: { sev: 'med', cat: 'media', pts: 2, t: 'Images sans texte alternatif', tip: 'Ajoutez un attribut alt décrivant chaque image (accessibilité + SEO).' },
  canonical_missing: { sev: 'high', cat: 'technical', pts: 10, t: 'Balise canonical manquante', tip: 'Elle évite les contenus dupliqués. Vérifiez l’adresse du site dans les Réglages.' },
  schema_missing: { sev: 'low', cat: 'technical', pts: 4, t: 'Données structurées absentes', tip: 'Les données JSON-LD aident Google à comprendre la page.' },
  og_missing: { sev: 'low', cat: 'technical', pts: 4, t: 'Balises de partage social absentes', tip: 'Open Graph améliore l’aperçu sur LinkedIn, Facebook, WhatsApp.' },
  noindex: { sev: 'high', cat: 'technical', pts: 25, t: 'Page bloquée à l’indexation', tip: 'Une balise noindex empêche Google d’afficher cette page.' },
  broken_link: { sev: 'high', cat: 'links', pts: 8, t: 'Lien interne cassé', tip: 'Corrigez le lien ou créez une redirection vers la bonne page.' },
  orphan: { sev: 'med', cat: 'links', pts: 6, t: 'Page orpheline (aucun lien interne)', tip: 'Aucune page du site ne pointe vers elle : ajoutez-la au menu ou à un contenu.' },
  redirect_link: { sev: 'low', cat: 'links', pts: 1, t: 'Lien interne qui passe par une redirection', tip: 'Mettez à jour le lien pour pointer directement vers la destination.' },
  site_url: { sev: 'high', cat: 'technical', pts: 0, site: true, t: 'Adresse du site non renseignée', tip: 'Renseignez https://navitrends.com dans Réglages → Identité du site.' },
  site_https: { sev: 'med', cat: 'technical', pts: 0, site: true, t: 'Le site n’est pas en HTTPS', tip: 'Utilisez une adresse https:// : c’est un critère de classement.' },
  sitemap_missing: { sev: 'med', cat: 'technical', pts: 0, site: true, t: 'Plan du site (sitemap.xml) absent', tip: 'Republiez le site pour le générer.' },
  sitemap_stale: { sev: 'low', cat: 'technical', pts: 0, site: true, t: 'Plan du site désynchronisé', tip: 'Republiez le site : le sitemap ne correspond plus aux pages en ligne.' },
  robots_block: { sev: 'high', cat: 'technical', pts: 0, site: true, t: 'robots.txt bloque tout le site', tip: 'Retirez « Disallow: / » : Google ne peut pas explorer le site.' },
  robots_sitemap: { sev: 'low', cat: 'technical', pts: 0, site: true, t: 'robots.txt ne déclare pas le sitemap', tip: 'Ajoutez la ligne « Sitemap: https://… » dans robots.txt.' },
  redir_loop: { sev: 'high', cat: 'technical', pts: 0, site: true, t: 'Redirection en boucle', tip: 'La redirection revient à son point de départ : corrigez la destination.' },
  redir_chain: { sev: 'med', cat: 'technical', pts: 0, site: true, t: 'Chaîne de redirections', tip: 'Faites pointer la source directement vers la destination finale.' },
  redir_broken: { sev: 'high', cat: 'technical', pts: 0, site: true, t: 'Redirection vers une page inexistante', tip: 'La destination n’existe pas : corrigez-la ou supprimez la règle.' },
  unhandled_404: { sev: 'med', cat: 'technical', pts: 0, site: true, t: 'URLs en 404 qui reçoivent du trafic', tip: 'Créez des redirections 301 pour récupérer ces visites.' }
};
const SITE_PENALTY = { high: 5, med: 2, low: 1 };
const pen = i => (i.penalty != null ? i.penalty : SITE_PENALTY[i.severity]);

/* ====================================================================
   Analyse du HTML rendu
   ==================================================================== */
const strip = h => String(h || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, ' ').replace(/<[^>]+>/g, ' ');
const STOP = new Set(('dans pour avec vous nous votre vos notre nos plus sont cette entre leur leurs être avoir fait faire comme aussi tout tous toute toutes peut peuvent '
  + 'mais donc ainsi alors afin chez sans sous sur des les une aux par ces ses son est ont été était sera très bien même autres autre ceux celui celle ceci cela dont quand '
  + 'comment pourquoi quel quelle quels quelles lors depuis vers selon avant après encore toujours jamais déjà société navitrends cookies contact notre votre pouvez permet '
  + 'permettent grâce chaque toutes ensemble puis être vers entre elles ils elle nous fois peu cet cette ces leurs sans voir découvrir savoir lire détails '
  + 'demander demandez échanger échangeons discuter parler suivant suivante page pages site web lien liens ici tout rien très aussi plusieurs ainsi').split(/\s+/));

function keywordsOf(txt) {
  const m = new Map();
  (String(txt || '').toLowerCase().match(/[a-zàâäçéèêëîïôöùûüœ][a-zàâäçéèêëîïôöùûüœ'’-]{3,}/g) || []).forEach(w => {
    w = w.replace(/^['’-]+|['’-]+$/g, '');
    if (w.length < 4 || STOP.has(w)) return;
    m.set(w, (m.get(w) || 0) + 1);
  });
  return [...m].filter(x => x[1] >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(x => ({ w: x[0], n: x[1] }));
}

function parseHtml(html) {
  html = String(html || '');
  const g = re => { const m = re.exec(html); return m ? decode(m[1]) : ''; };
  const title = text(g(/<title[^>]*>([\s\S]*?)<\/title>/i));
  const desc = text(g(/<meta\s+name="description"\s+content="([^"]*)"/i));
  const canonical = g(/<link\s+rel="canonical"\s+href="([^"]*)"/i);
  const robots = g(/<meta\s+name="robots"\s+content="([^"]*)"/i);
  const mainM = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
  const main = mainM ? mainM[1] : html;
  const mainText = text(decode(strip(main)));
  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map(m => text(decode(strip(m[1]))));
  const h2 = (main.match(/<h2\b/gi) || []).length;
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const imgsNoAlt = imgs.filter(t => !/\salt\s*=/.test(t)).length;
  const links = [...html.matchAll(/<a\b[^>]*?\shref="([^"]*)"/gi)].map(m => decode(m[1]));
  let lead = '';
  for (const m of main.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const t = text(decode(strip(m[1])));
    if (t.length >= 60) { lead = t; break; }
  }
  return {
    title, desc, canonical, robots, h1s, h2, lead, mainText,
    words: (mainText.match(/[A-Za-zÀ-ÿ0-9]{2,}/g) || []).length,
    imgs: imgs.length, imgsNoAlt, links,
    og: /property="og:title"/i.test(html) && /property="og:image"/i.test(html),
    ld: /<script type="application\/ld\+json">/i.test(html)
  };
}

/* ---- suggestions de réécriture ---- */
const DANGLING = /(?:^|\s)(?:de|des|du|d['’]|la|le|les|l['’]|et|&|en|pour|à|au|aux|un|une|sur|par|avec|dans|ou)$/i;
function fitTitle(t) {
  t = text(t);
  if (t.length <= T_MAX) return t;
  const parts = t.split(/\s+[–—|]\s+|\s+-\s+/);
  let b = -1;
  parts.forEach((p, i) => { if (/^(?:société\s+)?navitrends(?:\s+tunisie)?$/i.test(p.trim()) || /^(?:étude de cas|etude de cas)\s+navitrends$/i.test(p.trim())) b = i; });
  if (b >= 0 && parts.length > 1) parts.splice(b, 1); // la marque est rajoutée à la fin si la place le permet
  while (parts.length > 1 && parts.join(' – ').length > T_MAX && parts.slice(0, -1).join(' – ').length >= T_MIN) parts.pop();
  let r = parts.join(' – ');
  if (r.length > T_MAX) {
    r = r.slice(0, T_MAX).replace(/\s+\S*$/, '');
    for (let i = 0; i < 4 && DANGLING.test(r); i++) r = r.replace(DANGLING, '');
  }
  return r.replace(/[\s,;:–—|&-]+$/, '');
}
function withBrand(t) {
  t = text(t);
  return !/navitrends/i.test(t) && t.length + 13 <= T_MAX ? t + ' | Navitrends' : t;
}
function fitDesc(t, max) {
  max = max || 158;
  t = text(t);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (dot >= 100) return cut.slice(0, dot + 1);
  return cut.replace(/\s+\S*$/, '').replace(/[\s,;:–—-]+$/, '') + '…';
}
function suggestTitle(title, name, targets) {
  const n = len(title);
  const kw = (targets || []).find(Boolean);
  let r = null;
  if (n > T_MAX) r = withBrand(fitTitle(title));
  else if (n < T_MIN) r = text(name) ? withBrand(text(name) + ' – Société Navitrends') : null;
  else if (kw && !text(title).toLowerCase().includes(String(kw).toLowerCase())) {
    const base = withBrand(fitTitle(text(title) + ' – ' + kw));
    if (len(base) >= T_MIN && len(base) <= T_MAX) r = base;
  }
  if (r && len(r) > T_MAX) r = fitTitle(r);
  return r && len(r) >= T_MIN && len(r) <= T_MAX && r !== text(title) ? r : null;
}
function suggestDesc(desc, lead, targets) {
  const n = len(desc);
  const kw = (targets || []).find(Boolean);
  let r = null;
  if (n > D_MAX) r = fitDesc(desc);
  else if (n < D_MAX && n < D_MIN) r = fitDesc(n ? text(desc + ' ' + lead) : lead);
  else if (kw && desc && !text(desc).toLowerCase().includes(String(kw).toLowerCase()) && n + kw.length + 2 <= D_MAX) {
    r = fitDesc(text(desc) + ' ' + kw + '.');
  }
  return r && len(r) >= D_MIN && len(r) <= D_MAX && r !== text(desc) ? r : null;
}

/* ====================================================================
   Mots-clés cibles + suggestions de contenu (par page)
   ==================================================================== */
const MAX_REDIR_LOG = 200, MAX_FIXES = 300;
function pageMetaAll() { return store.read('seo-page-meta', {}); }
function targetsOf(type, slug) {
  const m = pageMetaAll()[String(type) + ':' + String(slug || '')] || {};
  return Array.isArray(m.keywords) ? m.keywords : [];
}
function setTargets(b) {
  b = b || {};
  const type = String(b.type || '');
  const slug = String(b.slug || '');
  if (!type) throw fail(400, 'Type de page manquant.');
  const kws = (Array.isArray(b.keywords) ? b.keywords : String(b.keywords || '').split(/[,;\n]/))
    .map(x => text(x).toLowerCase()).filter(x => x.length >= 2 && x.length <= 60)
    .filter((x, i, a) => a.indexOf(x) === i).slice(0, 8);
  const all = pageMetaAll();
  const k = type + ':' + slug;
  all[k] = Object.assign({}, all[k] || {}, { keywords: kws, updated: now() });
  store.write('seo-page-meta', all);
  return { ok: true, key: k, keywords: kws };
}
function contentTips(it, a, targets) {
  const tips = [];
  const tl = (a.title || '').toLowerCase(), dl = (a.desc || '').toLowerCase();
  const h1 = (a.h1s[0] || '').toLowerCase(), body = (a.mainText || '').toLowerCase();
  (targets || []).forEach(kw => {
    const k = String(kw).toLowerCase();
    if (!tl.includes(k)) tips.push({ kind: 'keyword', text: 'Incluez le mot-clé « ' + kw + ' » dans le titre SEO.' });
    if (!dl.includes(k)) tips.push({ kind: 'keyword', text: 'Mentionnez « ' + kw + ' » dans la description Google.' });
    if (a.h1s.length && !h1.includes(k)) tips.push({ kind: 'keyword', text: 'Idéalement, le H1 contient aussi « ' + kw + ' ».' });
    if (body && !body.includes(k)) tips.push({ kind: 'keyword', text: '« ' + kw + ' » n’apparaît pas encore dans le contenu principal.' });
  });
  if (!THIN_EXEMPT.has(it.tpl) && a.words < 300) {
    tips.push({ kind: 'content', text: 'Contenu encore léger (' + a.words + ' mots). Visez 300+ mots utiles (bénéfices, cas d’usage, FAQ).' });
  }
  if (a.words >= 400 && !a.h2) tips.push({ kind: 'structure', text: 'Ajoutez des sous-titres H2 pour structurer la page longue.' });
  if (a.imgsNoAlt) tips.push({ kind: 'media', text: a.imgsNoAlt + ' image' + (a.imgsNoAlt > 1 ? 's' : '') + ' sans texte alternatif (attribut alt).' });
  if (!a.h1s.length) tips.push({ kind: 'structure', text: 'Ajoutez un titre principal H1 clair sur le sujet de la page.' });
  return tips.slice(0, 8);
}

/* ====================================================================
   Pages connues du site
   ==================================================================== */
const isPub = x => x && x.status !== 'draft';

function sitePaths(data) {
  data = data || store.all();
  const out = [{ path: '/', label: 'Accueil', tpl: 'home' }];
  (data.pages || []).filter(isPub).forEach(p => out.push({ path: '/' + p.slug + '/', label: p.title, tpl: p.tpl || 'default' }));
  out.push({ path: '/etudes-de-cas/', label: 'Études de cas', tpl: 'cases' });
  (data.cases || []).filter(isPub).forEach(c => out.push({ path: '/etudes-de-cas/' + c.slug + '/', label: c.title, tpl: 'case' }));
  (data.articles || []).filter(a => isPub(a) && a.body && String(a.body).trim()).forEach(a => {
    out.push({ path: '/' + (a.slug || R.slugify(a.title).slice(0, 80)) + '/', label: a.title, tpl: 'article' });
  });
  return out;
}
function knownSet(data) {
  const s = new Set(['/sitemap.xml', '/robots.txt', '/404.html']);
  sitePaths(data).forEach(p => s.add(key(p.path)));
  return s;
}
function fileExists(p) {
  if (!fs.existsSync(path.join(SITE, 'index.html'))) return true; // site pas encore publié : on ne juge pas
  let rel;
  try { rel = decodeURIComponent(p).replace(/^\/+/, ''); } catch (e) { return false; }
  if (rel.includes('..')) return false;
  return fs.existsSync(path.join(SITE, rel));
}
function pathExists(p, known) {
  const k = key(p);
  if (known.has(k)) return true;
  if (/^\/(forms|api|backoffice)(\/|$)/.test(k)) return true;
  const m = /^(.+)\/page\/\d+$/.exec(k); // pagination des listes
  if (m && known.has(m[1])) return true;
  if (/^\/(assets|uploads)\//.test(k) || /\.[a-z0-9]{2,5}$/i.test(k)) return fileExists(p);
  return false;
}

/* ====================================================================
   Redirections (cache mémoire + écriture différée des compteurs)
   ==================================================================== */
let cRedir = null, rIdx = null, tRedir = null;
function listRedirects() {
  if (!cRedir) { cRedir = store.read('redirects', []); rIdx = null; }
  return cRedir;
}
function redirectIndex() {
  const list = listRedirects();
  if (!rIdx) {
    rIdx = new Map();
    list.forEach(r => { if (r.enabled !== false) rIdx.set(key(r.from), r); });
  }
  return rIdx;
}
function saveRedirects(list) {
  cRedir = list; rIdx = null;
  store.write('redirects', list);
  return list;
}
function flushRedirectHits() {
  if (tRedir) { clearTimeout(tRedir); tRedir = null; }
  if (cRedir) { try { store.write('redirects', cRedir, { backup: false }); } catch (e) { /* ignorer */ } }
}
function parseDest(to) {
  to = String(to || '').trim();
  return /^https?:\/\//i.test(to) ? to : normPath(to);
}
function cleanRedirect(b, existingId) {
  const from = normPath(b.from);
  const to = parseDest(b.to);
  if (!String(b.from || '').trim() || from === '/') throw fail(400, 'L’URL source est obligatoire (ex. /ancienne-page).');
  if (!String(b.to || '').trim()) throw fail(400, 'L’URL de destination est obligatoire.');
  if (/^https?:\/\//i.test(String(b.from || '').trim())) throw fail(400, 'L’URL source doit être un chemin (ex. /ancienne-page), pas une adresse complète.');
  if (key(from) === key(to)) throw fail(400, 'La source et la destination doivent être différentes.');
  const code = +b.code === 302 ? 302 : 301;
  const list = listRedirects();
  const old = list.find(r => r.id === existingId) || {};
  if (list.some(r => r.id !== existingId && key(r.from) === key(from))) throw fail(409, 'Une redirection existe déjà pour cette URL source.');
  return {
    id: existingId || rid(), from, to, code,
    enabled: b.enabled === false ? false : true,
    hits: Number.isFinite(+b.hits) ? +b.hits : (old.hits || 0),
    lastHit: old.lastHit || null,
    note: String(b.note || '').slice(0, 200),
    created: old.created || now(), updated: now()
  };
}
function redirectWarnings(item) {
  const w = [];
  const data = store.all();
  const known = knownSet(data);
  if (known.has(key(item.from)) && item.from !== '/') w.push('Cette URL existe encore sur le site : la redirection prendra le dessus sur la page.');
  if (!/^https?:\/\//i.test(item.to) && !pathExists(item.to, known)) w.push('La destination « ' + item.to + ' » n’existe pas sur le site.');
  const idx = new Map(listRedirects().filter(r => r.enabled !== false && r.id !== item.id).map(r => [key(r.from), r]));
  if (idx.has(key(item.to))) w.push('La destination est elle-même redirigée : cela crée une chaîne de redirections.');
  return w;
}
function redirectLog() { return store.read('seo-redirect-log', []); }
function pushRedirectLog(action, item, extra) {
  const list = redirectLog();
  list.unshift(Object.assign({
    id: rid(), at: now(), action,
    from: item && item.from, to: item && item.to, code: item && item.code, redirectId: item && item.id
  }, extra || {}));
  while (list.length > MAX_REDIR_LOG) list.pop();
  store.write('seo-redirect-log', list, { backup: false });
  return list;
}
function listRedirectLog() { return redirectLog(); }

function upsertRedirect(b, existingId) {
  const item = cleanRedirect(b, existingId || null);
  const list = listRedirects().slice();
  const i = list.findIndex(r => r.id === item.id);
  const prev = i >= 0 ? list[i] : null;
  if (i >= 0) list[i] = item; else list.unshift(item);
  saveRedirects(list);
  clear404(item.from, true);
  if (!prev) pushRedirectLog('create', item);
  else if (prev.enabled !== false && item.enabled === false) pushRedirectLog('disable', item);
  else if (prev.enabled === false && item.enabled !== false) pushRedirectLog('enable', item);
  else pushRedirectLog('update', item, { before: { from: prev.from, to: prev.to, code: prev.code } });
  return { items: list, item, warnings: redirectWarnings(item) };
}
function deleteRedirect(id) {
  const list = listRedirects();
  const gone = list.find(r => r.id === id);
  const next = saveRedirects(list.filter(r => r.id !== id));
  if (gone) pushRedirectLog('delete', gone);
  return next;
}
function importRedirects(raw, code) {
  const lines = String(raw || '').split(/\r?\n/);
  const out = { added: 0, skipped: 0, errors: [] };
  const list = listRedirects().slice();
  const seen = new Set(list.map(r => key(r.from)));
  const known = knownSet(store.all());
  lines.forEach((ln, i) => {
    const l = ln.trim();
    if (!l || l.startsWith('#')) return;
    const parts = l.split(/\s*(?:->|=>|→|;|,|\t)\s*|\s+/).filter(Boolean);
    if (parts.length < 2) { out.errors.push({ line: i + 1, text: l, msg: 'Format attendu : /ancienne-url -> /nouvelle-url' }); return; }
    try {
      const from = normPath(parts[0]); const to = parseDest(parts[1]);
      if (from === '/' ) throw fail(400, 'La source ne peut pas être la page d’accueil.');
      if (key(from) === key(to)) throw fail(400, 'Source et destination identiques.');
      if (seen.has(key(from))) { out.skipped++; return; }
      list.unshift({ id: rid(), from, to, code: +code === 302 ? 302 : 301, enabled: true, hits: 0, lastHit: null, note: 'Import en masse' + (!/^https?:\/\//i.test(to) && !pathExists(to, known) ? ' (destination à vérifier)' : ''), created: now(), updated: now() });
      seen.add(key(from)); out.added++;
    } catch (e) { out.errors.push({ line: i + 1, text: l, msg: e.message }); }
  });
  if (out.added) {
    saveRedirects(list);
    list.slice(0, out.added).forEach(r => {
      clear404(r.from, true); // ces URLs ne sont plus des 404
      pushRedirectLog('import', r);
    });
  }
  out.items = listRedirects();
  return out;
}
/** Redirection active pour un chemin public (enregistre le passage). */
function matchRedirect(rawPath) {
  const hit = redirectIndex().get(key(rawPath));
  if (!hit) return null;
  if (hit.to && key(hit.to) === key(rawPath)) return null;
  hit.hits = (hit.hits || 0) + 1; hit.lastHit = now();
  if (!tRedir) { tRedir = setTimeout(() => { tRedir = null; flushRedirectHits(); }, 4000); if (tRedir.unref) tRedir.unref(); }
  return { to: hit.to, code: hit.code || 301 };
}
function testRedirect(rawPath) {
  const known = knownSet(store.all());
  const idx = redirectIndex();
  const steps = []; const seen = new Set();
  let cur = String(rawPath || '').trim() || '/';
  for (let i = 0; i < 10; i++) {
    const k = key(cur);
    if (seen.has(k)) return { ok: false, status: 'loop', steps, final: cur, message: 'Boucle de redirections détectée.' };
    seen.add(k);
    const hit = idx.get(k);
    if (!hit) break;
    steps.push({ from: normPath(cur), to: hit.to, code: hit.code || 301 });
    cur = hit.to;
    if (/^https?:\/\//i.test(cur)) return { ok: true, status: 'external', steps, final: cur, message: 'Redirige vers un site externe.' };
  }
  const exists = pathExists(cur, known);
  return {
    ok: exists, status: exists ? 'ok' : 'missing', steps, final: normPath(cur),
    message: !steps.length ? (exists ? 'Aucune redirection : la page existe.' : 'Aucune redirection : la page est introuvable (404).')
      : exists ? 'OK : ' + steps.length + ' redirection' + (steps.length > 1 ? 's (chaîne à simplifier)' : '') + ' vers une page existante.' : 'La destination finale est introuvable (404).'
  };
}

/* ====================================================================
   Journal des 404 + suggestions
   ==================================================================== */
let c404 = null, t404 = null;
const list404 = () => { if (!c404) c404 = store.read('seo-404', []); return c404; };
function flush404() {
  if (t404) { clearTimeout(t404); t404 = null; }
  if (c404) { try { store.write('seo-404', c404, { backup: false }); } catch (e) { /* ignorer */ } }
}
function sched404() {
  if (!t404) { t404 = setTimeout(() => { t404 = null; flush404(); }, 3000); if (t404.unref) t404.unref(); }
}
process.on('exit', () => { try { if (t404) flush404(); if (tRedir) flushRedirectHits(); } catch (e) { /* ignorer */ } });

const BOT_RE = /(^|\/)(wp-admin|wp-login|wp-includes|wp-json|xmlrpc|phpmyadmin|cgi-bin|\.env|\.git|\.well-known\/(?!security))|\.(php\d?|asp|aspx|jsp|cgi|sql|bak|zip|rar)$/i;
const isBot = p => BOT_RE.test(p);

function log404(rawPath) {
  const p = normPath(rawPath);
  if (/^\/(api|backoffice|assets|uploads)(\/|$)/.test(p)) return;
  if (/\.(css|js|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|eot)$/i.test(p)) return;
  if (p.length > 300) return;
  let list = list404();
  const i = list.findIndex(x => x.path === p);
  if (i >= 0) { list[i].count = (list[i].count || 0) + 1; list[i].last = now(); }
  else list.unshift({ path: p, count: 1, first: now(), last: now() });
  if (list.length > MAX_404) {
    list.sort((a, b) => (isBot(a.path) - isBot(b.path)) || (b.count - a.count) || String(b.last).localeCompare(String(a.last)));
    list = list.slice(0, MAX_404); c404 = list;
  }
  sched404();
}
function clear404(p, quiet) {
  if (!p) { c404 = []; flush404(); return c404; }
  const k = key(p);
  c404 = list404().filter(x => key(x.path) !== k);
  quiet ? sched404() : flush404();
  return c404;
}

function lev(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const slugOf = p => noAccent(normPath(p)).toLowerCase().replace(/\.(html?|php|aspx?)$/, '').replace(/^\/+|\/+$/g, '').replace(/^(?:fr|en)\//, '');
function sim(a, b) {
  const x = slugOf(a), y = slugOf(b);
  if (!x || !y) return 0;
  const l = 1 - lev(x, y) / Math.max(x.length, y.length);
  const tx = new Set(x.split(/[\/_-]+/).filter(t => t.length > 2)), ty = new Set(y.split(/[\/_-]+/).filter(t => t.length > 2));
  let inter = 0; tx.forEach(t => { if (ty.has(t)) inter++; });
  const uni = tx.size + ty.size - inter;
  const jac = uni ? inter / uni : 0;
  let s = Math.max(l, 0.5 * l + 0.5 * jac);
  if (x.includes(y) || y.includes(x)) s = Math.max(s, 0.8);
  return s;
}
const INTENT = [
  [/(^|\/)(contact|nous-contacter|contactez)/i, 'contact'], [/(^|\/)(devis|quote|demande-de-devis)/i, 'devis'],
  [/(^|\/)(blog|actualites?|news|category|tag|articles?|insights?)(\/|$)/i, 'insights'], [/(^|\/)(faq|questions)/i, 'faq'],
  [/(^|\/)(services?|solutions?|prestations?|offres?)(\/|$)/i, 'hub'], [/(^|\/)(a-propos|about|qui-sommes|societe|entreprise|equipe)/i, 'default:a-propos']
];
function suggest404(p, paths) {
  if (isBot(p)) return null;
  const cands = paths.filter(c => c.path !== '/');
  let best = null;
  cands.forEach(c => {
    const s = sim(p, c.path);
    if (!best || s > best.s) best = { s, c };
  });
  if (best && best.s >= 0.5) return { to: best.c.path, label: best.c.label, confidence: Math.round(Math.min(best.s, 0.99) * 100) };
  for (const [re, tpl] of INTENT) {
    if (!re.test(p)) continue;
    const c = tpl.startsWith('default:') ? cands.find(x => x.path === '/' + tpl.slice(8) + '/') : cands.find(x => x.tpl === tpl);
    if (c) return { to: c.path, label: c.label, confidence: 60 };
  }
  return null;
}
function list404Enriched() {
  const paths = sitePaths(store.all());
  const idx = redirectIndex();
  return list404().map(x => {
    const bot = isBot(x.path);
    const handled = idx.has(key(x.path));
    const priority = x.count >= 10 ? 'high' : x.count >= 3 ? 'med' : 'low';
    return Object.assign({}, x, { bot, handled, priority, suggestion: handled ? null : suggest404(x.path, paths) });
  }).sort((a, b) => (a.bot - b.bot) || (a.handled - b.handled) || (b.count - a.count) || String(b.last).localeCompare(String(a.last)));
}

/* ====================================================================
   Audit
   ==================================================================== */
function collectPages(data) {
  R.setContext(data);
  const S = data.settings || {};
  const items = [];
  const push = o => {
    try { o.html = o.render(); } catch (e) { o.html = ''; o.error = String(e.message || e); }
    delete o.render; items.push(o);
  };
  const cu = s => ({ title: text((s || {}).title), desc: text((s || {}).desc) });
  push({ type: 'home', slug: '', path: '/', name: 'Accueil', tpl: 'home', editable: true, editUrl: '#/home', custom: { title: text(S.seo_home_title), desc: text(S.seo_home_desc) }, render: () => R.renderHome() });
  R.pages().forEach(p => push({ type: 'page', slug: p.slug, path: R.pageUrl(p.slug), name: p.title, tpl: p.tpl || 'default', editable: true, editUrl: '#/pages/edit/' + p.slug, custom: cu(p.seo), render: () => R.renderPage(p, 1).html }));
  push({ type: 'cases-index', slug: '', path: R.casesUrl(), name: 'Études de cas (liste)', tpl: 'cases', editable: true, editUrl: '#/cases', custom: { title: text(S.seo_cases_title), desc: text(S.seo_cases_desc) }, render: () => R.renderCasesIndex() });
  R.cases().forEach(c => push({ type: 'case', slug: c.slug, path: R.caseUrl(c), name: c.title, tpl: 'case', editable: true, editUrl: '#/cases/edit/' + c.slug, custom: cu(c.seo), render: () => R.renderCase(c) }));
  R.articles().filter(a => a.body && String(a.body).trim()).forEach(a => push({ type: 'article', slug: R.articleSlug(a), path: R.articleUrl(a), name: a.title, tpl: 'article', editable: false, editUrl: '#/articles', custom: { title: '', desc: '' }, render: () => R.renderArticle(a) }));
  return items;
}

const THIN_EXEMPT = new Set(['contact', 'devis', 'faq', 'hub', 'insights', 'cases', 'home']);

function gradeOf(s) { return s >= 90 ? 'Excellent' : s >= 75 ? 'Bon' : s >= 55 ? 'À améliorer' : 'Critique'; }

function analyze() {
  const data = store.all();
  const S = data.settings || {};
  const items = collectPages(data);
  const base = R.base().replace(/\/$/, '');
  const known = knownSet(data);
  const rIdxLocal = redirectIndex();

  /* 1) lecture de chaque page */
  const infos = items.map(it => Object.assign(it, { a: parseHtml(it.html) }));
  const titleMap = new Map(), descMap = new Map();
  infos.forEach(it => {
    if (it.a.title) { const k = it.a.title.toLowerCase(); (titleMap.get(k) || titleMap.set(k, []).get(k)).push(it); }
    if (it.a.desc) { const k = it.a.desc.toLowerCase(); (descMap.get(k) || descMap.set(k, []).get(k)).push(it); }
  });

  /* 2) liens internes : cibles, liens cassés, pages orphelines */
  const inbound = new Map();
  infos.forEach(it => {
    const targets = new Map();
    it.a.links.forEach(href => {
      href = String(href || '').trim();
      if (!href || href[0] === '#' || /^(mailto|tel|javascript|sms|whatsapp):/i.test(href)) return;
      if (/^https?:\/\//i.test(href)) { if (base && href.toLowerCase().startsWith(base.toLowerCase())) href = href.slice(base.length) || '/'; else return; }
      else if (href.startsWith('//') || href[0] !== '/') return;
      const p = href.split('#')[0].split('?')[0];
      if (!p) return;
      targets.set(key(p), p);
    });
    it.internal = [...targets.values()];
    it.internal.forEach(p => {
      if (key(p) === key(it.path)) return;
      const k = key(p);
      if (!inbound.has(k)) inbound.set(k, new Set());
      inbound.get(k).add(it.path);
    });
  });

  /* 3) problèmes par page */
  const issues = [];
  const brokenBy = new Map();
  const pathsForSuggest = sitePaths(data);
  const mk = (code, it, o) => {
    o = o || {};
    const def = CODES[code];
    return Object.assign({
      id: hid(code, it ? it.path : 'site', o.key || ''), code, severity: def.sev, cat: def.cat, title: def.t, tip: def.tip,
      path: it ? it.path : '/', page: it ? it.name : 'Site entier', pageKey: it ? it.type + ':' + it.slug : 'site',
      editable: it ? it.editable : false, pts: o.pts != null ? o.pts : def.pts, message: o.message || def.t, site: !!def.site
    }, o.extra || {});
  };
  const fixOf = (it, field, value) => (it.editable && value ? { fix: { type: it.type, slug: it.slug, field, value } } : {});

  infos.forEach(it => {
    const a = it.a; const out = [];
    if (it.error) out.push(mk('title_missing', it, { message: 'Erreur de génération de la page : ' + it.error, pts: 40 }));
    const tn = len(a.title), dn = len(a.desc);
    if (!tn) out.push(mk('title_missing', it));
    else {
      if (tn > T_MAX) out.push(mk('title_long', it, { message: 'Titre de ' + tn + ' caractères (max. ' + T_MAX + ') : « ' + a.title + ' »', extra: fixOf(it, 'title', suggestTitle(a.title, it.name)) }));
      else if (tn < T_MIN) out.push(mk('title_short', it, { message: 'Titre de ' + tn + ' caractères (min. ' + T_MIN + ') : « ' + a.title + ' »', extra: fixOf(it, 'title', suggestTitle(a.title, it.name)) }));
      const dup = titleMap.get(a.title.toLowerCase()) || [];
      if (dup.length > 1) out.push(mk('dup_title', it, { message: 'Même titre que : ' + dup.filter(x => x !== it).map(x => x.path).join(', ') }));
    }
    if (!dn) out.push(mk('desc_missing', it, { extra: fixOf(it, 'desc', suggestDesc('', a.lead)) }));
    else {
      if (dn > D_MAX) out.push(mk('desc_long', it, { message: 'Description de ' + dn + ' caractères (max. ' + D_MAX + ')', extra: fixOf(it, 'desc', suggestDesc(a.desc, a.lead)) }));
      else if (dn < D_MIN) out.push(mk('desc_short', it, { message: 'Description de ' + dn + ' caractères (min. ' + D_MIN + ')', extra: fixOf(it, 'desc', suggestDesc(a.desc, a.lead)) }));
      const dup = descMap.get(a.desc.toLowerCase()) || [];
      if (dup.length > 1) out.push(mk('dup_desc', it, { message: 'Même description que : ' + dup.filter(x => x !== it).map(x => x.path).join(', ') }));
    }
    if (!a.h1s.length) out.push(mk('h1_missing', it));
    else if (a.h1s.length > 1) out.push(mk('h1_multiple', it, { message: a.h1s.length + ' titres H1 sur la page' }));
    if (!THIN_EXEMPT.has(it.tpl) && a.words < 150) out.push(mk('thin_content', it, { message: 'Seulement ' + a.words + ' mots de contenu (visez 300+).' }));
    if (a.words > 400 && !a.h2) out.push(mk('h2_none', it, { message: a.words + ' mots sans aucun sous-titre H2.' }));
    if (a.imgsNoAlt) out.push(mk('img_alt', it, { message: a.imgsNoAlt + ' image' + (a.imgsNoAlt > 1 ? 's' : '') + ' sans attribut alt.', pts: Math.min(8, a.imgsNoAlt * 2) }));
    if (!a.canonical) out.push(mk('canonical_missing', it));
    if (/noindex/i.test(a.robots)) out.push(mk('noindex', it));
    if (!a.ld) out.push(mk('schema_missing', it));
    if (!a.og) out.push(mk('og_missing', it));
    const broken = [], viaRedirect = [];
    it.internal.forEach(p => {
      if (pathExists(p, known)) return;
      if (rIdxLocal.has(key(p))) viaRedirect.push(p); else broken.push(p);
    });
    broken.forEach(p => { const k = key(p); (brokenBy.get(k) || brokenBy.set(k, { target: p, pages: [] }).get(k)).pages.push(it); });
    viaRedirect.slice(0, 10).forEach(p => out.push(mk('redirect_link', it, { key: p, message: 'Le lien vers « ' + p + ' » passe par une redirection.', extra: { target: p } })));
    if (it.path !== '/' && it.type !== 'cases-index' && !(inbound.get(key(it.path)) || { size: 0 }).size) out.push(mk('orphan', it));
    it.out = out; it.out.forEach(x => issues.push(x));
    it.score = Math.max(0, Math.round(100 - out.reduce((s, x) => s + x.pts, 0)));
  });

  /* 4) problèmes du site entier */
  const siteIssues = [];
  const addSite = (code, o) => siteIssues.push(mk(code, null, o));
  /* liens cassés : ceux présents dans le menu / pied de page (sur la majorité des pages) = 1 seul problème */
  const everywhere = Math.max(3, Math.ceil(infos.length * 0.5));
  brokenBy.forEach(b => {
    const sg = suggest404(b.target, pathsForSuggest);
    const redirect = sg ? { from: normPath(b.target), to: sg.to, label: sg.label, confidence: sg.confidence } : null;
    if (b.pages.length >= everywhere) {
      siteIssues.push(mk('broken_link', null, { key: b.target, message: 'Lien cassé « ' + b.target + ' » présent sur ' + b.pages.length + ' pages (menu, pied de page ou bloc commun).', pts: 0, extra: { site: true, penalty: 3, path: b.target, target: b.target, pages: b.pages.length, redirect } }));
    } else {
      b.pages.forEach(it => {
        const x = mk('broken_link', it, { key: b.target, message: 'Lien cassé vers « ' + b.target + ' »', pts: 8, extra: { target: b.target, redirect } });
        it.out.push(x); issues.push(x);
      });
    }
  });
  infos.forEach(it => {
    const bl = it.out.filter(x => x.code === 'broken_link');
    if (bl.length > 2) bl.forEach(x => { x.pts = 4; });
    it.score = Math.max(0, Math.round(100 - it.out.reduce((s, x) => s + x.pts, 0)));
  });
  if (!text(S.site_url)) addSite('site_url');
  else if (!/^https:\/\//i.test(text(S.site_url))) addSite('site_https', { message: 'Adresse actuelle : ' + text(S.site_url) });
  let sitemapCount = null, robotsTxt = null, gscFile = false;
  const siteBuilt = fs.existsSync(path.join(SITE, 'index.html'));
  if (siteBuilt) {
    try { sitemapCount = (fs.readFileSync(path.join(SITE, 'sitemap.xml'), 'utf8').match(/<loc>/g) || []).length; } catch (e) { sitemapCount = null; }
    try { robotsTxt = fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8'); } catch (e) { robotsTxt = null; }
    try { gscFile = fs.readdirSync(SITE).some(f => /^google[a-z0-9]+\.html$/i.test(f)); } catch (e) { gscFile = false; }
    if (sitemapCount == null) addSite('sitemap_missing');
    else if (sitemapCount !== items.length) addSite('sitemap_stale', { message: 'Le sitemap liste ' + sitemapCount + ' URLs pour ' + items.length + ' pages en ligne.' });
    if (robotsTxt == null) addSite('robots_sitemap', { message: 'Fichier robots.txt introuvable.' });
    else {
      if (/^\s*Disallow:\s*\/\s*$/im.test(robotsTxt) && /User-agent:\s*\*/i.test(robotsTxt)) addSite('robots_block');
      if (!/^\s*Sitemap:/im.test(robotsTxt)) addSite('robots_sitemap');
    }
  }
  /* redirections : boucles, chaînes, destinations cassées */
  const redirects = listRedirects().filter(r => r.enabled !== false);
  redirects.forEach(r => {
    const t = testRedirect(r.from);
    if (t.status === 'loop') addSite('redir_loop', { key: r.id, message: 'La règle « ' + r.from + ' » tourne en boucle.', extra: { path: r.from } });
    else if (t.status === 'missing') addSite('redir_broken', { key: r.id, message: '« ' + r.from + ' » → « ' + r.to + ' » : destination introuvable.', extra: { path: r.from } });
    else if (t.steps.length > 1) addSite('redir_chain', { key: r.id, message: '« ' + r.from + ' » traverse ' + t.steps.length + ' redirections avant la page finale.', extra: { path: r.from } });
  });
  const pending404 = list404().filter(x => !isBot(x.path) && !redirectIndex().has(key(x.path)) && x.count >= 3);
  if (pending404.length) addSite('unhandled_404', { message: pending404.length + ' URL' + (pending404.length > 1 ? 's' : '') + ' en 404 avec 3 visites ou plus, sans redirection.', extra: { path: '/404', action: { tab: '404' } } });
  siteIssues.forEach(x => issues.push(x));

  /* 5) scores */
  const N = Math.max(1, infos.length);
  const sev = { high: 0, med: 1, low: 2 };
  issues.sort((a, b) => sev[a.severity] - sev[b.severity] || b.pts - a.pts || a.path.localeCompare(b.path));
  const counts = { high: 0, med: 0, low: 0 };
  issues.forEach(i => { counts[i.severity]++; });
  const catScore = {};
  Object.keys(CATS).forEach(c => {
    const lost = issues.filter(i => i.cat === c && !i.site).reduce((s, i) => s + i.pts, 0);
    const siteLost = siteIssues.filter(i => i.cat === c).reduce((s, i) => s + pen(i), 0);
    const n = issues.filter(i => i.cat === c).length;
    catScore[c] = { label: CATS[c], score: Math.max(0, Math.min(100, Math.round(100 - lost / N - siteLost))), issues: n };
  });
  const avgPage = infos.reduce((s, it) => s + it.score, 0) / N;
  const sitePenalty = Math.min(25, siteIssues.reduce((s, i) => s + pen(i), 0));
  const score = Math.max(0, Math.min(100, Math.round(avgPage - sitePenalty)));

  /* 6) synthèse par page */
  const metaAll = pageMetaAll();
  const pages = infos.map(it => {
    const a = it.a; const mine = it.out;
    const t = a.title.toLowerCase(), d = a.desc.toLowerCase(), h1 = (a.h1s[0] || '').toLowerCase();
    const targets = (metaAll[it.type + ':' + it.slug] || {}).keywords || [];
    const indexable = !/noindex/i.test(a.robots || '');
    return {
      key: it.type + ':' + it.slug, type: it.type, slug: it.slug, path: it.path, name: it.name, tpl: it.tpl,
      editable: it.editable, editUrl: it.editUrl,
      title: a.title, desc: a.desc, customTitle: !!it.custom.title, customDesc: !!it.custom.desc, custom: it.custom,
      score: it.score, indexable, robots: a.robots || '',
      issues: { high: mine.filter(x => x.severity === 'high').length, med: mine.filter(x => x.severity === 'med').length, low: mine.filter(x => x.severity === 'low').length, total: mine.length },
      issueIds: mine.map(x => x.id),
      words: a.words, h1: a.h1s.length, h2: a.h2, imgs: a.imgs, imgsNoAlt: a.imgsNoAlt,
      links: { internal: it.internal.length }, inbound: (inbound.get(key(it.path)) || { size: 0 }).size,
      keywords: keywordsOf(a.mainText).map(k => ({ w: k.w, n: k.n, t: t.includes(noAccent(k.w)) || t.includes(k.w), d: d.includes(k.w), h: h1.includes(k.w) })).slice(0, 6),
      targets,
      tips: contentTips(it, a, targets),
      suggest: { title: suggestTitle(a.title, it.name, targets), desc: suggestDesc(a.desc, a.lead, targets) },
      lead: a.lead.slice(0, 240)
    };
  });

  /* 7) check-list technique */
  const n = infos.length;
  const cover = fn => infos.filter(fn).length;
  const st = (ok, partial) => (ok ? 'ok' : partial ? 'warn' : 'bad');
  const tech = [
    { id: 'https', label: 'Adresse du site en HTTPS', status: text(S.site_url) ? st(/^https:\/\//i.test(text(S.site_url)), false) : 'bad', detail: text(S.site_url) || 'Non renseignée (Réglages)' },
    { id: 'canonical', label: 'Balise canonical sur toutes les pages', status: st(cover(i => i.a.canonical) === n, cover(i => i.a.canonical) > 0), detail: cover(i => i.a.canonical) + ' / ' + n + ' pages' },
    { id: 'schema', label: 'Données structurées (JSON-LD)', status: st(cover(i => i.a.ld) === n, cover(i => i.a.ld) > 0), detail: cover(i => i.a.ld) + ' / ' + n + ' pages' },
    { id: 'og', label: 'Aperçu de partage (Open Graph)', status: st(cover(i => i.a.og) === n, cover(i => i.a.og) > 0), detail: cover(i => i.a.og) + ' / ' + n + ' pages' },
    { id: 'index', label: 'Aucune page bloquée à l’indexation', status: st(!cover(i => /noindex/i.test(i.a.robots)), false), detail: cover(i => /noindex/i.test(i.a.robots)) + ' page(s) en noindex' },
    { id: 'sitemap', label: 'Plan du site (sitemap.xml)', status: !siteBuilt ? 'warn' : sitemapCount == null ? 'bad' : st(sitemapCount === n, true), detail: sitemapCount == null ? 'Introuvable : republiez le site' : sitemapCount + ' URLs listées' },
    { id: 'robots', label: 'Fichier robots.txt', status: !siteBuilt ? 'warn' : robotsTxt == null ? 'bad' : st(/^\s*Sitemap:/im.test(robotsTxt) && !siteIssues.some(x => x.code === 'robots_block'), true), detail: robotsTxt == null ? 'Introuvable' : (/^\s*Sitemap:/im.test(robotsTxt) ? 'Sitemap déclaré' : 'Sitemap non déclaré') },
    { id: 'gsc', label: 'Vérification Google Search Console', status: gscFile ? 'ok' : 'warn', detail: gscFile ? 'Fichier de validation en ligne' : 'Aucun fichier de validation détecté' },
    { id: 'links', label: 'Liens internes sains', status: st(!issues.some(i => i.code === 'broken_link'), false), detail: issues.filter(i => i.code === 'broken_link').length + ' lien(s) cassé(s)' },
    { id: 'redirects', label: 'Redirections saines', status: st(!siteIssues.some(i => /^redir_/.test(i.code)), false), detail: redirects.length + ' règle(s) active(s)' },
    { id: 'alt', label: 'Images avec texte alternatif', status: st(!cover(i => i.a.imgsNoAlt), true), detail: infos.reduce((s, i) => s + i.a.imgsNoAlt, 0) + ' image(s) sans alt' }
  ];

  return {
    at: now(), siteUrl: text(S.site_url), score, grade: gradeOf(score), counts, categories: catScore,
    totals: {
      pages: n, issues: issues.length, words: infos.reduce((s, i) => s + i.a.words, 0),
      fixable: issues.filter(i => i.fix).length, drafts: [].concat(data.pages || [], data.cases || []).filter(x => x.status === 'draft').length,
      redirects: listRedirects().length, errors404: list404().filter(x => !isBot(x.path)).length,
      indexable: pages.filter(p => p.indexable).length, noindex: pages.filter(p => !p.indexable).length
    },
    pages, issues, tech
  };
}

/* ---- historique du score ---- */
const history = () => store.read('seo-history', []);
function record(rep, force) {
  const h = history();
  const pt = { at: rep.at, score: rep.score, high: rep.counts.high, med: rep.counts.med, low: rep.counts.low };
  const last = h[h.length - 1];
  if (!last) h.push(pt);
  else if (force) {
    /* même résultat : on rafraîchit seulement la date ; sinon on ajoute un point à la courbe */
    if (last.score === pt.score && last.high === pt.high && last.med === pt.med && last.low === pt.low) h[h.length - 1] = pt; else h.push(pt);
  } else return h;
  while (h.length > MAX_HISTORY) h.shift();
  store.write('seo-history', h);
  return h;
}
function runAudit() {
  const rep = analyze();
  store.write('seo-audit', { at: rep.at, score: rep.score, counts: rep.counts, totals: rep.totals });
  record(rep, true);
  return rep;
}
const getAudit = () => store.read('seo-audit', null);

function actionsOf(rep) {
  const N = Math.max(1, rep.totals.pages);
  const g = new Map();
  rep.issues.forEach(i => {
    if (!g.has(i.code)) g.set(i.code, { code: i.code, title: i.title, tip: i.tip, severity: i.severity, cat: i.cat, count: 0, gain: 0, fixable: 0, samples: [], site: i.site });
    const x = g.get(i.code);
    x.count++; x.gain += i.site ? pen(i) : i.pts / N; if (i.fix) x.fixable++;
    if (x.samples.length < 3 && x.samples.indexOf(i.path) < 0) x.samples.push(i.path);
  });
  return [...g.values()].map(x => Object.assign(x, { gain: Math.round(x.gain * 10) / 10 })).sort((a, b) => b.gain - a.gain);
}

function overview() {
  const rep = analyze();
  const hist = history();
  if (!hist.length) record(rep, true);
  const h = history();
  const last = h[h.length - 1];
  const ref = last && last.score !== rep.score ? last : h[h.length - 2];
  const en = list404Enriched();
  const open404 = en.filter(x => !x.bot && !x.handled);
  return {
    at: rep.at, siteUrl: rep.siteUrl, score: rep.score, grade: rep.grade, delta: ref ? rep.score - ref.score : null,
    counts: rep.counts, categories: rep.categories, totals: rep.totals, tech: rep.tech,
    actions: actionsOf(rep).slice(0, 6),
    history: h.slice(-30),
    errors404: open404.length, bots404: en.filter(x => x.bot).length, top404: open404.slice(0, 5),
    redirects: listRedirects().length, redirectsEnabled: listRedirects().filter(r => r.enabled !== false).length,
    indexable: rep.totals.indexable, noindex: rep.totals.noindex,
    fixedMonth: listFixes().filter(f => sameMonth(f.at, rep.at)).length
  };
}

/* ====================================================================
   Modification des méta-données + corrections automatiques
   ==================================================================== */
const sstr = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

function writeMeta(type, slug, fields) {
  if (type === 'home') {
    const s = store.read('settings', {});
    if ('title' in fields) s.seo_home_title = fields.title;
    if ('desc' in fields) s.seo_home_desc = fields.desc;
    store.write('settings', s); return;
  }
  if (type === 'cases-index') {
    const s = store.read('settings', {});
    if ('title' in fields) s.seo_cases_title = fields.title;
    if ('desc' in fields) s.seo_cases_desc = fields.desc;
    store.write('settings', s); return;
  }
  const name = type === 'page' ? 'pages' : type === 'case' ? 'cases' : null;
  if (!name) throw fail(400, 'Ce type de page ne se modifie pas ici.');
  const list = store.read(name, []);
  const it = list.find(x => x.slug === slug);
  if (!it) throw fail(404, 'Page introuvable.');
  it.seo = Object.assign({}, it.seo || {});
  if ('title' in fields) it.seo.title = fields.title;
  if ('desc' in fields) it.seo.desc = fields.desc;
  store.write(name, list);
}
function setMeta(b) {
  b = b || {};
  const f = {};
  if (b.title !== undefined) f.title = sstr(b.title, 300);
  if (b.desc !== undefined) f.desc = sstr(b.desc, 500);
  writeMeta(String(b.type || ''), String(b.slug || ''), f);
  record(analyze(), true);
  return { ok: true };
}
function listFixes() { return store.read('seo-fixes', []); }
function pushFixes(entries) {
  if (!entries || !entries.length) return listFixes();
  const list = listFixes();
  entries.forEach(e => list.unshift(Object.assign({ at: now() }, e)));
  while (list.length > MAX_FIXES) list.pop();
  store.write('seo-fixes', list, { backup: false });
  return list;
}
const sameMonth = (a, b) => String(a || '').slice(0, 7) === String(b || '').slice(0, 7);

function applyFixes(b) {
  b = b || {};
  const rep = analyze();
  const wanted = b.all ? null : new Set(Array.isArray(b.ids) ? b.ids : []);
  const groups = new Map();
  const log = [];
  rep.issues.forEach(i => {
    if (!i.fix || (wanted && !wanted.has(i.id))) return;
    const k = i.fix.type + ':' + i.fix.slug;
    if (!groups.has(k)) groups.set(k, { type: i.fix.type, slug: i.fix.slug, path: i.path, page: i.page, f: {} });
    groups.get(k).f[i.fix.field] = sstr(i.fix.value, i.fix.field === 'title' ? 300 : 500);
    log.push({ code: i.code, field: i.fix.field, path: i.path, page: i.page, before: i.fix.field === 'title' ? (rep.pages.find(p => p.key === i.pageKey) || {}).title : (rep.pages.find(p => p.key === i.pageKey) || {}).desc, after: i.fix.value });
  });
  let applied = 0;
  groups.forEach(g => { writeMeta(g.type, g.slug, g.f); applied += Object.keys(g.f).length; });
  const after = applied ? analyze() : rep;
  if (applied) {
    record(after, true);
    pushFixes(log);
  }
  return { ok: true, applied, pages: groups.size, before: rep.score, score: after.score };
}

function report() {
  const rep = analyze();
  const hist = history();
  const fixes = listFixes();
  const month = String(rep.at).slice(0, 7);
  const monthFixes = fixes.filter(f => sameMonth(f.at, rep.at));
  const monthHist = hist.filter(p => sameMonth(p.at, rep.at));
  const start = monthHist[0] || hist[0] || null;
  const byCode = {};
  rep.issues.forEach(i => { byCode[i.code] = (byCode[i.code] || 0) + 1; });
  const remaining = Object.keys(byCode).map(code => ({
    code, count: byCode[code], title: (CODES[code] || {}).t || code, severity: (CODES[code] || {}).sev || 'med'
  })).sort((a, b) => b.count - a.count);
  return {
    at: rep.at, siteUrl: rep.siteUrl, score: rep.score, grade: rep.grade,
    month,
    evolution: {
      start: start ? start.score : null,
      current: rep.score,
      delta: start ? rep.score - start.score : null,
      points: monthHist.length ? monthHist : hist.slice(-12)
    },
    remaining: { total: rep.issues.length, high: rep.counts.high, med: rep.counts.med, low: rep.counts.low, byCode: remaining },
    fixed: { total: fixes.length, month: monthFixes.length, recent: fixes.slice(0, 40) },
    indexable: { yes: rep.totals.indexable, no: rep.totals.noindex },
    errors404: list404Enriched().filter(x => !x.bot && !x.handled).length,
    redirects: listRedirects().length,
    redirectsEnabled: listRedirects().filter(r => r.enabled !== false).length,
    pages: rep.totals.pages, words: rep.totals.words
  };
}

function csvEsc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }
function exportCsv(kind) {
  kind = String(kind || 'issues');
  const lines = [];
  const stamp = new Date().toISOString().slice(0, 10);
  if (kind === 'pages') {
    const rep = analyze();
    lines.push(['chemin', 'nom', 'score', 'indexable', 'titre', 'description', 'mots', 'alertes', 'mots_cles_cibles'].map(csvEsc).join(','));
    rep.pages.forEach(p => lines.push([p.path, p.name, p.score, p.indexable ? 'oui' : 'non', p.title, p.desc, p.words, p.issues.total, (p.targets || []).join(' | ')].map(csvEsc).join(',')));
    return { filename: 'seo-pages-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
  if (kind === '404') {
    lines.push(['chemin', 'visites', 'derniere', 'robot', 'redirigee', 'suggestion'].map(csvEsc).join(','));
    list404Enriched().forEach(x => lines.push([x.path, x.count, x.last, x.bot ? 'oui' : 'non', x.handled ? 'oui' : 'non', x.suggestion ? x.suggestion.to : ''].map(csvEsc).join(',')));
    return { filename: 'seo-404-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
  if (kind === 'redirects') {
    lines.push(['depuis', 'vers', 'code', 'active', 'visites', 'dernier', 'note', 'cree', 'modifie'].map(csvEsc).join(','));
    listRedirects().forEach(r => lines.push([r.from, r.to, r.code, r.enabled === false ? 'non' : 'oui', r.hits || 0, r.lastHit || '', r.note || '', r.created || '', r.updated || ''].map(csvEsc).join(',')));
    return { filename: 'seo-redirects-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
  if (kind === 'fixes') {
    lines.push(['date', 'page', 'chemin', 'code', 'champ', 'avant', 'apres'].map(csvEsc).join(','));
    listFixes().forEach(f => lines.push([f.at, f.page, f.path, f.code, f.field, f.before, f.after].map(csvEsc).join(',')));
    return { filename: 'seo-corrections-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
  if (kind === 'report') {
    const r = report();
    lines.push(['indicateur', 'valeur'].map(csvEsc).join(','));
    [['Mois', r.month], ['Score actuel', r.score], ['Note', r.grade], ['Score début de période', r.evolution.start], ['Évolution', r.evolution.delta],
      ['Problèmes restants', r.remaining.total], ['Prioritaires', r.remaining.high], ['Corrections ce mois', r.fixed.month],
      ['Pages indexables', r.indexable.yes], ['Pages noindex', r.indexable.no], ['404 ouvertes', r.errors404], ['Redirections actives', r.redirectsEnabled]
    ].forEach(row => lines.push(row.map(csvEsc).join(',')));
    lines.push('');
    lines.push(['ce_qui_reste', 'severite', 'nombre'].map(csvEsc).join(','));
    r.remaining.byCode.forEach(x => lines.push([x.title, x.severity, x.count].map(csvEsc).join(',')));
    return { filename: 'seo-rapport-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
  /* issues (défaut) */
  {
    const rep = analyze();
    lines.push(['severite', 'code', 'titre', 'page', 'chemin', 'message', 'corrigeable'].map(csvEsc).join(','));
    rep.issues.forEach(i => lines.push([i.severity, i.code, i.title, i.page, i.path, i.message, i.fix ? 'oui' : 'non'].map(csvEsc).join(',')));
    return { filename: 'seo-audit-' + stamp + '.csv', csv: '\uFEFF' + lines.join('\n') };
  }
}

function reportHtml() {
  const r = report();
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rows = r.remaining.byCode.map(x => '<tr><td>' + esc(x.title) + '</td><td>' + esc(x.severity) + '</td><td>' + x.count + '</td></tr>').join('');
  const fixes = r.fixed.recent.slice(0, 25).map(f => '<tr><td>' + esc(String(f.at).slice(0, 16).replace('T', ' ')) + '</td><td>' + esc(f.page) + '</td><td>' + esc(f.field) + '</td><td>' + esc((f.after || '').slice(0, 80)) + '</td></tr>').join('');
  return '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport SEO Navitrends — ' + esc(r.month) + '</title>'
    + '<style>body{font:14px/1.5 system-ui,Segoe UI,sans-serif;color:#1a1a1a;max-width:860px;margin:32px auto;padding:0 20px}'
    + 'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:28px 0 10px;border-bottom:1px solid #ddd;padding-bottom:6px}'
    + '.meta{color:#666;margin:0 0 20px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}'
    + '.k{border:1px solid #ddd;border-radius:8px;padding:12px}.k b{display:block;font-size:22px}'
    + 'table{width:100%;border-collapse:collapse}th,td{border:1px solid #e5e5e5;padding:8px;text-align:left;font-size:13px}'
    + 'th{background:#f6f7f9}@media print{.noprint{display:none}body{margin:0}}</style></head><body>'
    + '<p class="noprint"><button onclick="window.print()">Imprimer / enregistrer en PDF</button></p>'
    + '<h1>Rapport SEO — Navitrends</h1>'
    + '<p class="meta">Période ' + esc(r.month) + ' · généré le ' + esc(String(r.at).slice(0, 16).replace('T', ' ')) + ' · score ' + r.score + '/100 (' + esc(r.grade) + ')</p>'
    + '<div class="kpis"><div class="k"><b>' + r.score + '</b>Score actuel</div><div class="k"><b>' + (r.evolution.delta == null ? '—' : (r.evolution.delta > 0 ? '+' : '') + r.evolution.delta) + '</b>Évolution</div>'
    + '<div class="k"><b>' + r.fixed.month + '</b>Corrections ce mois</div><div class="k"><b>' + r.remaining.total + '</b>Restent à traiter</div></div>'
    + '<h2>Ce qui reste</h2><table><thead><tr><th>Problème</th><th>Sévérité</th><th>Nombre</th></tr></thead><tbody>'
    + (rows || '<tr><td colspan="3">Aucun problème détecté.</td></tr>') + '</tbody></table>'
    + '<h2>Ce qui a été corrigé (récent)</h2><table><thead><tr><th>Date</th><th>Page</th><th>Champ</th><th>Nouvelle valeur</th></tr></thead><tbody>'
    + (fixes || '<tr><td colspan="4">Aucune correction enregistrée pour l’instant.</td></tr>') + '</tbody></table>'
    + '<h2>Indexation</h2><p>' + r.indexable.yes + ' pages indexables · ' + r.indexable.no + ' en noindex · '
    + r.errors404 + ' URL 404 ouvertes · ' + r.redirectsEnabled + ' redirections actives</p>'
    + '</body></html>';
}

function reset() {
  if (t404) { clearTimeout(t404); t404 = null; }
  if (tRedir) { clearTimeout(tRedir); tRedir = null; }
  c404 = null; cRedir = null; rIdx = null;
}

module.exports = {
  analyze, runAudit, getAudit, overview, record,
  setMeta, applyFixes, setTargets, reset,
  list404, list404Enriched, log404, clear404,
  listRedirects, listRedirectLog, upsertRedirect, deleteRedirect, importRedirects, matchRedirect, testRedirect,
  report, reportHtml, exportCsv, listFixes,
  normPath, flush404,
  _t: { parseHtml, fitTitle, fitDesc, suggestTitle, suggestDesc, suggest404, sim, isBot, keywordsOf, sitePaths, knownSet, pathExists, contentTips }
};
