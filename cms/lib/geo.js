/* Module GEO (Generative Engine Optimization) — visibilité dans les réponses IA.
   Analyse locale : schémas, entité marque, pages citables, crawlers IA, llms.txt.
   Sans API externe. */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const R = require('./render');
const seo = require('./seo');

const SITE = process.env.NV_SITE || path.join(store.ROOT, 'site');
const now = () => new Date().toISOString();
const text = s => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const fail = (status, message) => Object.assign(new Error(message), { status });

  const AI_BOTS = [
  { id: 'GPTBot', label: 'ChatGPT', note: 'Lecture du site pour ChatGPT.' },
  { id: 'OAI-SearchBot', label: 'Recherche OpenAI', note: 'Résultats de recherche OpenAI.' },
  { id: 'ChatGPT-User', label: 'ChatGPT (visite utilisateur)', note: 'Quand quelqu’un demande d’ouvrir une page depuis ChatGPT.' },
  { id: 'Google-Extended', label: 'Gemini (entraînement)', note: 'Concerne l’entraînement Gemini, pas la recherche Google classique.' },
  { id: 'ClaudeBot', label: 'Claude', note: 'Lecture du site pour Claude.' },
  { id: 'PerplexityBot', label: 'Perplexity', note: 'Peut servir pour les citations Perplexity.' },
  { id: 'Bytespider', label: 'ByteDance', note: 'Robot associé à ByteDance / TikTok.' }
];

function readRobots() {
  try { return fs.readFileSync(path.join(SITE, 'robots.txt'), 'utf8'); } catch (e) { return null; }
}
function readLlmsFile() {
  try { return fs.readFileSync(path.join(SITE, 'llms.txt'), 'utf8'); } catch (e) { return null; }
}
function geoSettings() {
  const s = store.read('settings', {});
  return {
    allowAi: s.geo_allow_ai !== false, // par défaut : autoriser
    llms: text(s.geo_llms_txt || ''),
    brandPitch: text(s.geo_brand_pitch || '')
  };
}

function parseLdTypes(html) {
  const types = new Set();
  const blocks = String(html || '').match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  blocks.forEach(block => {
    const m = />([\s\S]*)</.exec(block);
    if (!m) return;
    try {
      const j = JSON.parse(m[1]);
      const walk = n => {
        if (!n || typeof n !== 'object') return;
        if (Array.isArray(n)) return n.forEach(walk);
        if (n['@type']) (Array.isArray(n['@type']) ? n['@type'] : [n['@type']]).forEach(t => types.add(String(t)));
        if (n['@graph']) walk(n['@graph']);
        Object.keys(n).forEach(k => { if (k !== '@type' && typeof n[k] === 'object') walk(n[k]); });
      };
      walk(j);
    } catch (e) { /* JSON-LD invalide */ }
  });
  return [...types];
}

function botPolicy(robotsTxt, botId) {
  if (!robotsTxt) return { status: 'unknown', detail: 'robots.txt introuvable' };
  const lines = robotsTxt.split(/\r?\n/);
  let active = null, disallowAll = false, allowAll = false, explicit = false;
  for (let i = 0; i < lines.length; i++) {
    const ua = /^\s*User-agent:\s*(.+)\s*$/i.exec(lines[i]);
    if (ua) {
      const name = ua[1].trim();
      active = (name === '*' || name.toLowerCase() === botId.toLowerCase()) ? name : null;
      if (name.toLowerCase() === botId.toLowerCase()) explicit = true;
      continue;
    }
    if (!active) continue;
    if (/^\s*Disallow:\s*\/\s*$/i.test(lines[i])) {
      if (active.toLowerCase() === botId.toLowerCase() || active === '*') disallowAll = true;
    }
    if (/^\s*Allow:\s*\/\s*$/i.test(lines[i])) {
      if (active.toLowerCase() === botId.toLowerCase() || active === '*') allowAll = true;
    }
    if (/^\s*User-agent:/i.test(lines[i])) { /* handled above */ }
  }
  /* re-scan with proper UA blocks */
  let block = null; const blocks = [];
  lines.forEach(ln => {
    const ua = /^\s*User-agent:\s*(.+)\s*$/i.exec(ln);
    if (ua) { block = { ua: ua[1].trim(), rules: [] }; blocks.push(block); return; }
    if (block && /^\s*(Allow|Disallow)\s*:/i.test(ln)) block.rules.push(ln.trim());
  });
  const specific = blocks.find(b => b.ua.toLowerCase() === botId.toLowerCase());
  const star = blocks.find(b => b.ua === '*');
  const use = specific || star;
  if (!use) return { status: 'allow', detail: 'Aucune règle → autorisé par défaut', explicit: false };
  const blocked = use.rules.some(r => /^Disallow:\s*\/\s*$/i.test(r));
  const allowed = use.rules.some(r => /^Allow:\s*\/\s*$/i.test(r));
  if (blocked && !allowed) return { status: 'block', detail: specific ? 'Bloqué explicitement' : 'Bloqué via User-agent: *', explicit: !!specific };
  return { status: 'allow', detail: specific ? 'Autorisé explicitement' : 'Autorisé (règle globale)', explicit: !!specific };
}

function defaultLlms() {
  const data = store.all();
  const S = data.settings || {};
  const b = (S.site_url || 'https://navitrends.com').replace(/\/$/, '');
  const name = S.site_name || 'Navitrends';
  const pitch = text(S.geo_brand_pitch) || text(S.org_desc) || (name + ' — intégration ERP, automatisation et logiciels sur mesure.');
  const lines = ['# ' + name, '', '> ' + pitch, '', '## Pages essentielles', ''];
  const paths = seo._t.sitePaths(data).filter(p => ['home', 'hub', 'contact', 'devis', 'faq', 'insights', 'cases', 'default', 'service'].includes(p.tpl) || p.path === '/');
  const seen = new Set();
  paths.forEach(p => {
    if (seen.has(p.path)) return; seen.add(p.path);
    lines.push('- [' + p.label + '](' + b + p.path + '): ' + p.label);
  });
  lines.push('', '## Contact', '');
  if (S.tn_email) lines.push('- Email Tunisie : ' + S.tn_email);
  if (S.uk_email) lines.push('- Email UK : ' + S.uk_email);
  if (S.tn_phone) lines.push('- Téléphone : ' + S.tn_phone);
  lines.push('');
  return lines.join('\n');
}

function citationScore(page, types) {
  let s = 40;
  if (page.words >= 300) s += 15;
  if (page.words >= 600) s += 10;
  if (page.h2 >= 2) s += 10;
  if (page.h1 === 1) s += 8;
  if (types.includes('FAQPage')) s += 12;
  if (types.includes('Article') || types.includes('BlogPosting')) s += 8;
  if (types.includes('Service') || types.includes('ProfessionalService')) s += 6;
  if (page.indexable) s += 8; else s -= 25;
  if (page.inbound >= 1) s += 5;
  if (page.desc && page.desc.length >= 70) s += 5;
  return Math.max(0, Math.min(100, s));
}

function analyze() {
  const data = store.all();
  const S = data.settings || {};
  const cfg = geoSettings();
  const robotsTxt = readRobots();
  const llmsLive = readLlmsFile();
  const rep = seo.analyze();

  R.setContext(data);
  const pages = [];
  const typeCount = {};
  let withFaq = 0, withArticle = 0, withService = 0;

  /* réutilise le HTML déjà rendu via collectPages indirect : on re-parse depuis l’audit pages + render rapide */
  const items = [];
  const push = o => {
    try { o.html = o.render(); } catch (e) { o.html = ''; }
    delete o.render; items.push(o);
  };
  push({ type: 'home', slug: '', path: '/', name: 'Accueil', tpl: 'home', render: () => R.renderHome() });
  R.pages().forEach(p => push({ type: 'page', slug: p.slug, path: R.pageUrl(p.slug), name: p.title, tpl: p.tpl || 'default', render: () => R.renderPage(p, 1).html }));
  push({ type: 'cases-index', slug: '', path: R.casesUrl(), name: 'Études de cas', tpl: 'cases', render: () => R.renderCasesIndex() });
  R.cases().forEach(c => push({ type: 'case', slug: c.slug, path: R.caseUrl(c), name: c.title, tpl: 'case', render: () => R.renderCase(c) }));
  R.articles().filter(a => a.body && String(a.body).trim()).forEach(a => push({ type: 'article', slug: R.articleSlug(a), path: R.articleUrl(a), name: a.title, tpl: 'article', render: () => R.renderArticle(a) }));

  const byPath = {};
  rep.pages.forEach(p => { byPath[p.path] = p; });

  items.forEach(it => {
    const types = parseLdTypes(it.html);
    types.forEach(t => { typeCount[t] = (typeCount[t] || 0) + 1; });
    if (types.includes('FAQPage')) withFaq++;
    if (types.includes('Article') || types.includes('BlogPosting')) withArticle++;
    if (types.includes('Service') || types.includes('ProfessionalService')) withService++;
    const base = byPath[it.path] || { words: 0, h1: 0, h2: 0, indexable: true, inbound: 0, desc: '', score: 0, issues: { total: 0 } };
    const cite = citationScore(base, types);
    pages.push({
      key: it.type + ':' + it.slug, type: it.type, slug: it.slug, path: it.path, name: it.name, tpl: it.tpl,
      types, cite, words: base.words, h2: base.h2, h1: base.h1, indexable: base.indexable,
      inbound: base.inbound, seoScore: base.score,
      answerReady: base.words >= 300 && base.h2 >= 1 && base.indexable
    });
  });

  const bots = AI_BOTS.map(b => Object.assign({}, b, botPolicy(robotsTxt, b.id)));
  const blockedBots = bots.filter(b => b.status === 'block').length;

  const entity = {
    name: text(S.site_name),
    url: text(S.site_url),
    desc: text(S.org_desc),
    logo: text(S.org_logo),
    pitch: cfg.brandPitch || text(S.org_desc),
    sameAs: [S.facebook, S.linkedin].filter(Boolean).length,
    contact: !!(S.tn_email || S.uk_email || S.tn_phone)
  };
  const entityScore = [
    entity.name ? 20 : 0, entity.url ? 15 : 0, entity.desc ? 20 : 0,
    entity.logo ? 15 : 0, entity.sameAs ? 10 : 0, entity.contact ? 20 : 0
  ].reduce((a, b) => a + b, 0);

  const schemaScore = Math.min(100, Math.round(
    (typeCount.Organization ? 25 : 0) + (typeCount.WebSite ? 15 : 0) + (typeCount.BreadcrumbList ? 10 : 0)
    + Math.min(25, withFaq * 8) + Math.min(15, withArticle * 5) + Math.min(10, withService * 5)
  ));

  const answerPages = pages.filter(p => p.answerReady).length;
  const contentScore = Math.min(100, Math.round((answerPages / Math.max(1, pages.length)) * 70 + Math.min(30, pages.filter(p => p.cite >= 70).length * 6)));
  const crawlScore = Math.max(0, 100 - blockedBots * 12);
  const llmsScore = llmsLive && llmsLive.length > 40 ? 100 : cfg.llms.length > 40 ? 70 : 20;

  const score = Math.round(entityScore * 0.25 + schemaScore * 0.25 + contentScore * 0.3 + crawlScore * 0.1 + llmsScore * 0.1);
  const grade = score >= 90 ? 'Excellent' : score >= 75 ? 'Bon' : score >= 55 ? 'À améliorer' : 'Faible';

  const actions = [];
  if (!entity.desc) actions.push({ id: 'org_desc', title: 'Décrire la société', tip: 'Deux ou trois phrases claires sur ce que fait Navitrends.', tab: 'entity', gain: 8 });
  if (!entity.logo) actions.push({ id: 'org_logo', title: 'Ajouter le logo', tip: 'Indiquez l’adresse du logo dans les Réglages : il apparaît aussi dans les infos société.', tab: 'entity', gain: 5 });
  if (!withFaq) actions.push({ id: 'faq', title: 'Compléter la FAQ', tip: 'Des questions-réponses nettes aident beaucoup quand on cherche une réponse précise.', tab: 'content', gain: 10 });
  if (answerPages < Math.ceil(pages.length * 0.4)) actions.push({ id: 'answers', title: 'Enrichir les pages trop courtes', tip: 'Visez environ 300 mots utiles, avec des sous-titres, une idée principale par page.', tab: 'content', gain: 12 });
  if (!llmsLive || llmsLive.length < 40) actions.push({ id: 'llms', title: 'Publier le résumé du site', tip: 'Petit fichier facultatif (/llms.txt). Sans effet sur Google Search.', tab: 'llms', gain: 4 });
  if (blockedBots) actions.push({ id: 'bots', title: 'Revoir les robots bloqués', tip: blockedBots + ' robot(s) actuellement bloqué(s) dans robots.txt.', tab: 'bots', gain: 6 });
  if (!typeCount.Organization) actions.push({ id: 'schema', title: 'Vérifier les infos société', tip: 'Republiez le site si la fiche société n’apparaît plus dans les pages.', tab: 'schema', gain: 10 });

  return {
    at: now(),
    score, grade,
    categories: {
      entity: { label: 'Fiche société', score: entityScore },
      schema: { label: 'Infos structurées', score: schemaScore },
      content: { label: 'Pages claires', score: contentScore },
      crawl: { label: 'Accès des robots', score: crawlScore },
      llms: { label: 'Fichier résumé', score: llmsScore }
    },
    entity,
    schema: { types: typeCount, withFaq, withArticle, withService, pagesWithLd: pages.filter(p => p.types.length).length },
    pages: pages.sort((a, b) => b.cite - a.cite),
    bots,
    llms: {
      live: llmsLive,
      draft: cfg.llms || defaultLlms(),
      published: !!(llmsLive && llmsLive.length > 20),
      url: ((S.site_url || '') + '/llms.txt').replace(/([^:]\/)\/+/g, '$1')
    },
    allowAi: cfg.allowAi,
    actions: actions.sort((a, b) => b.gain - a.gain),
    totals: { pages: pages.length, answerReady: answerPages, citeStrong: pages.filter(p => p.cite >= 85).length }
  };
}

function saveLlms(body) {
  const raw = String((body && body.text != null) ? body.text : '');
  if (raw.length > 50000) throw fail(400, 'Fichier trop long (max. 50 Ko).');
  const s = store.read('settings', {});
  s.geo_llms_txt = raw;
  if (body && body.allowAi != null) s.geo_allow_ai = !!body.allowAi;
  if (body && body.brandPitch != null) s.geo_brand_pitch = text(body.brandPitch).slice(0, 500);
  store.write('settings', s);
  return { ok: true, draft: s.geo_llms_txt, allowAi: s.geo_allow_ai !== false };
}

function resetLlms() {
  return { text: defaultLlms() };
}

/** Contenu robots.txt enrichi GEO (appelé depuis publish). */
function robotsTxtForPublish(baseUrl, allowAi) {
  let out = 'User-agent: *\nAllow: /\nDisallow: /backoffice/\nDisallow: /api/\n\n';
  if (allowAi === false) {
    AI_BOTS.forEach(b => { out += 'User-agent: ' + b.id + '\nDisallow: /\n\n'; });
  }
  out += 'Sitemap: ' + baseUrl.replace(/\/$/, '') + '/sitemap.xml\n';
  return out;
}

function llmsForPublish() {
  const s = store.read('settings', {});
  const custom = text(s.geo_llms_txt);
  return custom || defaultLlms();
}

module.exports = {
  analyze, saveLlms, resetLlms, defaultLlms,
  robotsTxtForPublish, llmsForPublish, geoSettings, AI_BOTS,
  _t: { parseLdTypes, botPolicy, citationScore }
};
