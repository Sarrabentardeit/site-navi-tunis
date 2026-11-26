/* Moteur de rendu : transforme le contenu (cms/data) en pages HTML statiques.
   Portage du thème WordPress Navitrends (même HTML, mêmes classes CSS). */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATIC = path.join(__dirname, '..', 'static');
const sprite = fs.readFileSync(path.join(STATIC, 'sprite.svg'), 'utf8');
const ver = f => crypto.createHash('md5').update(fs.readFileSync(path.join(STATIC, f))).digest('hex').slice(0, 8);

let X = null; // contexte courant (contenu)

/* ---------- utilitaires ---------- */
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const rich = s => esc(s).replace(/\*\*(.+?)\*\*/gs, '<strong>$1</strong>').replace(/\{\{(.+?)\}\}/gs, '<span class="grad">$1</span>');
const slugify = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
const lines = v => Array.isArray(v) ? v.map(String).filter(s => s.trim() !== '') : String(v == null ? '' : v).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
const paraList = v => Array.isArray(v) ? v.map(String).filter(s => s.trim() !== '') : String(v == null ? '' : v).split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
const pastel = k => ['blue', 'gold', 'lilac', 'mint', 'rose', 'sky'][k % 6];
const short = (s, n = 156) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length <= n ? s : s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'; };
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const dateLabel = d => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? (+m[3]) + ' ' + MONTHS[+m[2] - 1] + ' ' + m[1] : ''; };
const nl2br = s => esc(s).replace(/\n/g, '<br>');

const S = k => (X.settings[k] == null || X.settings[k] === '' ? '' : X.settings[k]);
const base = () => String(X.settings.site_url || 'https://navitrends.com').replace(/\/+$/, '') + '/';
const siteName = () => X.settings.site_name || 'Navitrends';

/* ---------- liens et images ---------- */
const img = p => { p = String(p || ''); if (!p) return ''; if (/^(https?:)?\/\//.test(p) || p[0] === '/') return p; return '/assets/img/' + p.replace(/^\/+/, ''); };
const pageUrl = slug => '/' + slug + '/';
const url = u => {
  u = String(u == null ? '' : u).trim();
  if (u === '' || u === '#') return '/';
  if (/^(https?:|mailto:|tel:|\/|#)/.test(u)) return u;
  return '/' + u.replace(/^\/+|\/+$/g, '') + '/';
};
const published = a => (a || []).filter(x => x.status !== 'draft');
const pages = () => published(X.pages).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const pageByTpl = (tpl, fb) => { const p = pages().find(x => x.tpl === tpl); return p ? pageUrl(p.slug) : (fb ? '/' + fb + '/' : '/'); };
const casesUrl = () => '/etudes-de-cas/';
const caseUrl = c => '/etudes-de-cas/' + c.slug + '/';
const insightsUrl = () => pageByTpl('insights', 'insights');
const cases = () => published(X.cases).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
const articles = () => published(X.articles); // l'ordre de la liste fait foi (le plus récent en premier)
const articleSlug = a => a.slug || slugify(a.title).slice(0, 80);
const articleUrl = a => (a.body && String(a.body).trim()) ? '/' + articleSlug(a) + '/' : (a.url || '#');
const heroData = p => Object.assign({ h1: '', label: '', tagline: '', intro: [], actions: 0, icon: '', banner: '', tags: [], theme: '' }, p.hero || {});
const caseData = c => Object.assign({ group: '', theme: 'blue', client: '', short_name: '', logo: '', logo_alt: '', logo_dark: 0, kicker: '', summary: '', banner: '', tags: [] }, c.case || {});

function services() {
  return pages().filter(p => p.tpl === 'service').map((p, i) => {
    const sv = p.service || {}; const h = heroData(p);
    return {
      slug: p.slug, url: pageUrl(p.slug), title: p.title, short: sv.short || p.title, sub: sv.sub || '',
      card_title: sv.card_title || p.title, card_desc: sv.card_desc || '', card_tag: sv.card_tag || sv.sub || '', hub_desc: sv.hub_desc || sv.card_desc || '',
      mock: sv.mock || '', glyph: sv.glyph || '◎', theme: h.theme || 'blue', mi: 'm' + ((i % 6) + 1)
    };
  });
}
const aboutPages = () => pages().filter(p => p.menu === 'about');

/* ---------- composants ---------- */
function ul(items, cls = 'pg-list') {
  items = lines(items); if (!items.length) return '';
  return '<ul class="' + esc(cls) + '">' + items.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
}
const paras = ps => paraList(ps).map(p => '<p>' + esc(p) + '</p>\n').join('');

function visHtml(icon, banner, tags) {
  const pos = ['left:5%;top:4%;--r:-4deg', 'right:5%;top:13%;--r:3deg;--d:-3s', 'left:6%;bottom:4%;--r:-3deg;--d:-1.5s'];
  const cls = ['', 'b', 'g'];
  return '<div class="cs-vis pg-vis" aria-hidden="true">'
    + (icon ? '<div class="pg-ico"><svg><use href="#i-' + esc(icon) + '"/></svg></div>' : '')
    + (banner ? '<p class="cs-banner">' + esc(banner) + '</p>' : '')
    + lines(tags).slice(0, 3).map((t, k) => '<span class="stk pill" style="' + pos[k] + '"><i class="' + cls[k % 3] + '"></i>' + esc(t) + '</span>').join('')
    + '</div>';
}
const mockHtml = key => (X.mocks && X.mocks[key]) ? X.mocks[key].split('{{ASSETS}}').join('/assets/img') : '';

function heroHtml(o) {
  o = Object.assign({ crumbs: [], label: '', h1: '', tagline: '', intro: [], actions: 0, visual: '', service: false, pad: '', after: '', sp_vis: false }, o);
  const tg = o.service ? 'h2' : 'p';
  const intro = paraList(o.intro);
  let crumb = '<a href="/">Home</a>';
  o.crumbs.forEach((c, i) => {
    crumb += '<span aria-hidden="true">/</span>';
    crumb += (i === o.crumbs.length - 1 || !c[1]) ? '<span aria-current="page">' + esc(c[0]) + '</span>' : '<a href="' + esc(c[1]) + '">' + esc(c[0]) + '</a>';
  });
  return '    <section class="sp-hero"' + (o.pad ? ' style="padding-bottom:' + esc(o.pad) + '"' : '') + '>\n'
    + '      <div class="aurora" aria-hidden="true"><i></i><i></i><i></i><i></i></div>\n      <div class="container">\n'
    + '        <nav class="crumb" aria-label="Fil d’Ariane">' + crumb + '</nav>\n'
    + '        <div class="' + (o.visual ? 'sp-grid' : 'sp-copy sp-wide') + '">\n' + (o.visual ? '          <div class="sp-copy">\n' : '')
    + (o.label ? '            <p class="label reveal">' + esc(o.label) + '</p>\n' : '')
    + '            <h1 class="reveal" style="--i:1"><span class="gr">' + esc(o.h1) + '</span></h1>\n'
    + (o.tagline ? '            <' + tg + ' class="sp-tag reveal" style="--i:2">' + esc(o.tagline) + '</' + tg + '>\n' : '')
    + (intro.length ? '            <div class="sp-intro reveal" style="--i:3">' + intro.map(p => '<p>' + esc(p) + '</p>').join('') + '</div>\n' : '')
    + o.after
    + (o.actions ? '            <div class="' + (o.service ? 'hero-actions' : 'pg-actions') + ' reveal" style="--i:4"><a class="btn btn-dark" href="' + esc(url('devis')) + '">Demander un devis <span class="arr">→</span></a><a class="btn btn-line" href="' + esc(url('contact')) + '">Nous contacter</a></div>\n' : '')
    + (o.visual ? '          </div>\n' : '')
    + (o.visual ? '          <div class="' + (o.sp_vis ? 'sp-vis ' : '') + 'reveal" style="--i:2"' + (o.sp_vis ? ' aria-hidden="true"' : '') + '>' + o.visual + '</div>\n' : '')
    + '        </div>\n      </div>\n    </section>\n';
}

function pageHero(p, crumbs) {
  const h = heroData(p); const isService = p.tpl === 'service';
  const visual = isService ? mockHtml((p.service || {}).mock) : ((h.icon || h.banner || lines(h.tags).length) ? visHtml(h.icon, h.banner, h.tags) : '');
  return heroHtml({
    crumbs: crumbs || [[p.title, '']], label: h.label, h1: h.h1 || p.title, tagline: h.tagline, intro: h.intro,
    actions: h.actions, visual, service: isService, sp_vis: isService, pad: isService ? '' : '30px'
  });
}

/* ---------- sections ---------- */
function secHead(s) {
  if (!s.label && !s.h2 && !s.intro) return '';
  return '<header class="sec-head reveal">' + (s.label ? '<p class="label">' + esc(s.label) + '</p>' : '') + (s.h2 ? '<h2>' + rich(s.h2) + '</h2>' : '') + (s.intro ? '<p>' + rich(s.intro) + '</p>' : '') + '</header>';
}
function secWrap(s, inner, cls = '', pt = 20) {
  pt = s.pt != null && s.pt !== '' ? parseInt(s.pt, 10) : pt;
  const id = s.id ? ' id="' + esc(slugify(s.id)) + '"' : '';
  return '<section class="section' + (cls ? ' ' + esc(cls) : '') + '"' + id + ' style="padding-top:' + pt + 'px"><div class="container">' + inner + '</div></section>\n';
}
function btnPair(s) {
  const t1 = s.btn1_t || 'Demander un devis', u1 = s.btn1_u || 'devis', t2 = s.btn2_t || 'Nous contacter', u2 = s.btn2_u || 'contact';
  return '<div class="hero-actions"><a class="btn btn-gold" href="' + esc(url(u1)) + '">' + esc(t1) + ' <span class="arr">→</span></a><a class="btn btn-line-light" href="' + esc(url(u2)) + '">' + esc(t2) + '</a></div>';
}

function renderSection(s, st) {
  const type = s.type || ''; let o = '';
  const idAttr = s.id ? ' id="' + esc(slugify(s.id)) + '"' : '';
  switch (type) {
    case 'numbered': {
      st.count++;
      const n = s.n ? s.n : String(st.count).padStart(2, '0');
      o += '<section class="section cs-block"' + idAttr + ' style="padding-top:20px"><div class="container"><div class="' + (s.panel ? 'cs-panel ' : '') + 'cs-grid">';
      o += '<div class="cs-side reveal"><span class="cs-n" aria-hidden="true">' + esc(n) + '</span><p class="label">' + esc(s.label || '') + '</p></div>';
      o += '<div class="cs-main reveal" style="--i:1"><h2>' + rich(s.h2 || '') + '</h2>' + paras(s.ps) + ul(s.list);
      if (s.quote) o += '<p class="pg-quote">' + esc(s.quote) + '</p>';
      o += paras(s.after) + ul(s.after_list) + '</div></div></div></section>\n';
      break;
    }
    case 'text':
      o = secWrap(s, secHead(s) + '<div class="pg-prose reveal">' + paras(s.ps) + '</div>', '', 40); break;
    case 'steps': {
      let inner = secHead(s) + '<ol class="sp-steps">';
      (s.items || []).forEach((it, k) => {
        inner += '<li class="sp-step c-' + pastel(k) + '" style="--i:' + k + '"><span class="sp-n" aria-hidden="true">' + (k + 1) + '</span><div><h3>' + esc(it.t || '') + '</h3>';
        (it.body || []).forEach(b => { if (b.type === 'ul') inner += ul(b.items, 'cl'); else if (b.text) inner += '<p>' + esc(b.text) + '</p>'; });
        if (it.goal) inner += '<p class="goal">' + esc(it.goal) + '</p>';
        inner += '</div></li>';
      });
      o = secWrap(s, inner + '</ol>', 'sp-approach', 20); break;
    }
    case 'cards': {
      const cols = String(s.cols || '3');
      let inner = secHead(s) + '<div class="exp-cards' + (cols !== '3' ? ' c' + esc(cols) : '') + (s.cls ? ' ' + esc(s.cls) : '') + '">';
      (s.items || []).forEach((it, k) => {
        inner += '<article class="exp-card c-' + pastel(k) + ' reveal" style="--i:' + k + '"><span class="exp-num" aria-hidden="true">0' + (k + 1) + '</span><h3>' + esc(it.t || '') + '</h3>';
        if (it.d) inner += '<p>' + esc(it.d) + '</p>';
        inner += ul(it.list, 'cl') + '</article>';
      });
      inner += '</div>';
      if (s.outro) inner += '<p class="exp-outro reveal">' + esc(s.outro) + '</p>';
      o = secWrap(s, inner, 'sp-exp', 20); break;
    }
    case 'tiles': {
      let inner = secHead(s) + '<ul class="tiles">';
      lines(s.items).forEach((t, k) => { inner += '<li class="tile c-' + pastel(k) + ' reveal" style="--i:' + (k % 3) + '"><b aria-hidden="true">' + (s.numbered ? (k + 1) : '✓') + '</b><span>' + esc(t) + '</span></li>'; });
      inner += '</ul>';
      if (s.outro) inner += '<p class="exp-outro reveal">' + esc(s.outro) + '</p>';
      o = secWrap(s, inner, '', 20); break;
    }
    case 'who':
      o = '<section class="section sp-who"' + idAttr + ' style="padding-top:20px"><div class="container who-grid">'
        + '<div class="who-card dark reveal"><h2>' + rich(s.a_h2 || '') + '</h2>' + (s.a_lead ? '<p>' + esc(s.a_lead) + '</p>' : '') + ul(s.a_list, 'who-list') + '</div>'
        + '<div class="who-card light reveal" style="--i:1"><h2>' + rich(s.b_h2 || '') + '</h2>' + (s.b_lead ? '<p>' + esc(s.b_lead) + '</p>' : '') + ul(s.b_list, 'who-list') + '</div>'
        + '</div></section>\n'; break;
    case 'bad':
      o = secWrap(s, '<div class="pw-card bad wide reveal"><p class="pw-lead">' + esc(s.lead || '') + '</p>' + ul(s.list, 'pw-list') + '</div>', '', 20); break;
    case 'why': {
      let inner = secHead({ label: s.label, h2: s.h2 });
      inner += '<div class="pw-grid"><div class="pw-card bad reveal"><p class="pw-lead">' + esc(s.leadA || '') + '</p>' + ul(s.problems, 'pw-list') + '</div>';
      inner += '<div class="pw-card good reveal" style="--i:1"><p class="pw-lead">' + esc(s.leadB || '') + '</p>' + ul(s.gains, 'pw-list') + '</div></div>';
      o = secWrap(s, inner, 'sp-why', s.pt != null ? s.pt : 60); break;
    }
    case 'marquee': {
      const items = lines(s.items); if (!items.length) break;
      o = '<section class="tools sp-keys" aria-label="Mots-clés"><div class="marquee big" aria-hidden="true"><div class="marquee-track" data-marquee style="--dur:40s">' + items.map(t => '<span class="mq">' + esc(t) + '</span>').join('') + '</div></div></section>\n'; break;
    }
    case 'panel':
      o = secWrap(s, '<div class="cs-panel reveal" style="text-align:center"><p class="label">' + esc(s.label || '') + '</p><h2 style="font-size:clamp(26px,3.6vw,46px);max-width:820px;margin:0 auto">' + rich(s.h2 || '') + '</h2><p style="max-width:700px;margin:20px auto 0;font-size:18px">' + esc(s.p || '') + '</p></div>', '', 0); break;
    case 'close':
      o = '<section class="sp-close"' + idAttr + ' style="padding-top:20px"><div class="container"><div class="close-box reveal">'
        + (s.label ? '<p class="label light">' + esc(s.label) + '</p>' : '')
        + '<h2>' + rich(s.h2 || '') + '</h2>' + paras(s.ps)
        + (s.cta_t ? '<p class="close-cta"><span aria-hidden="true">👉</span> <strong>' + esc(s.cta_t) + '</strong>' + (s.cta_p ? '<br>' + esc(s.cta_p) : '') + '</p>' : '')
        + (!s.nobtn ? btnPair(s) : '')
        + '</div></div></section>\n'; break;
    case 'cta':
      o = '<section class="sp-close" style="padding-top:0"><div class="container"><div class="cs-cta reveal"><h2>' + rich(s.h2 || '') + '</h2><p>' + esc(s.p || '') + '</p>'
        + '<div class="hero-actions"><a class="btn btn-dark" href="' + esc(url('devis')) + '">Demander un devis <span class="arr">→</span></a><a class="btn btn-line" href="' + esc(url('contact')) + '">Nous contacter</a></div></div></div></section>\n'; break;
    case 'html':
      o = '<section class="section" style="padding-top:20px"><div class="container pg-prose">' + String(s.html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '') + '</div></section>\n'; break;
  }
  return o;
}
const renderSections = list => { const st = { count: 0 }; return (Array.isArray(list) ? list : []).filter(s => s && typeof s === 'object').map(s => renderSection(s, st)).join(''); };

/* ---------- études de cas / articles ---------- */
function caseCard(c, i = 0) {
  const d = caseData(c);
  const logo = d.logo
    ? '<div class="case-logo' + (d.logo_dark ? ' dark' : '') + '"><img src="' + esc(img(d.logo)) + '" alt="' + esc(d.logo_alt) + '" loading="lazy"></div>'
    : '<div class="case-logo ico" aria-hidden="true"><span><svg><use href="#i-heart"/></svg></span></div>';
  return '<a class="case c-' + esc(d.theme) + ' reveal" style="--i:' + (i | 0) + '" href="' + esc(caseUrl(c)) + '">' + logo
    + '<div class="case-tx"><span class="case-tag">' + esc(d.group) + '</span><h3>' + esc(c.title) + '</h3>'
    + (d.client ? '<small class="case-client">Client : ' + esc(d.client) + '</small>' : '')
    + '<p>' + esc(d.summary) + '</p><em>Voir l’étude de cas</em></div></a>';
}
function postCard(a, i = 0) {
  const href = articleUrl(a);
  const ext = /^https?:/.test(href);
  return '<article class="reveal" style="--i:' + (i % 3) + '"><a class="thumb" href="' + esc(href) + '" tabindex="-1" aria-hidden="true">' + (a.img ? '<img src="' + esc(img(a.img)) + '" width="768" height="512" loading="lazy" alt="">' : '') + '</a>'
    + '<time datetime="' + esc(a.date) + '">' + esc(dateLabel(a.date)) + '</time><h3><a href="' + esc(href) + '"' + (ext ? ' rel="noopener"' : '') + '>' + esc(a.title) + '</a></h3></article>';
}
const PER_PAGE = 12;
function postsSection(pageNo) {
  const all = articles(); const total = Math.max(1, Math.ceil(all.length / PER_PAGE));
  const list = all.slice((pageNo - 1) * PER_PAGE, pageNo * PER_PAGE);
  const cats = X.settings.blog_cats || [];
  let o = '<section class="section" style="padding-top:30px"><div class="container">';
  if (cats.length) o += '<div class="cat-links reveal" style="justify-content:center;margin:0 0 40px">' + cats.map(c => '<a href="' + esc(c.url) + '">' + esc(c.name) + '</a>').join('') + '</div>';
  o += '<div class="posts p3">' + list.map((a, i) => postCard(a, i)).join('\n') + '</div>';
  if (total > 1) {
    const base0 = insightsUrl();
    const link = n => n === 1 ? base0 : base0 + 'page/' + n + '/';
    let pg = '';
    if (pageNo > 1) pg += '<a class="prev page-numbers" href="' + link(pageNo - 1) + '">←</a>';
    for (let n = 1; n <= total; n++) pg += n === pageNo ? '<span aria-current="page" class="page-numbers current">' + n + '</span>' : '<a class="page-numbers" href="' + link(n) + '">' + n + '</a>';
    if (pageNo < total) pg += '<a class="next page-numbers" href="' + link(pageNo + 1) + '">→</a>';
    o += '<nav class="nv-pagination" aria-label="Pagination">' + pg + '</nav>';
  }
  return { html: o + '</div></section>', total };
}

/* ---------- en-tête / pied de page / newsletter ---------- */
function headerHtml(isFront) {
  const sv = services(), about = aboutPages(), cs = cases(), cats = X.settings.blog_cats || [];
  const aboutUrl = pages().some(p => p.slug === 'a-propos') ? '/a-propos/' : '/a-propos/';
  const contact = pageByTpl('contact', 'contact'), devis = pageByTpl('devis', 'devis');
  let h = '  <header class="header" id="header">\n    <div class="container header-in">\n';
  h += '      <a class="brand" href="/" aria-label="' + esc(siteName()) + ' – Accueil"><img src="' + esc(img('logo.png')) + '" width="300" height="122" alt="' + esc(siteName()) + '"></a>\n';
  h += '      <nav class="nav" id="main-nav" aria-label="Navigation principale">\n        <ul>\n';
  h += '          <li><a href="/"' + (isFront ? ' aria-current="page"' : '') + '>Accueil</a></li>\n';
  if (sv.length) {
    h += '          <li class="has-sub mega">\n            <a href="' + esc(pageByTpl('hub', 'services')) + '">Services</a>\n            <button class="sub-toggle" aria-label="Ouvrir le sous-menu Services" aria-expanded="false"></button>\n            <div class="sub mega-panel">\n              <ul class="mega-grid">\n';
    sv.forEach(s => { h += '                <li><a href="' + esc(s.url) + '"><span class="mi ' + esc(s.mi) + '">' + esc(s.glyph) + '</span><span><b>' + esc(s.short) + '</b><small>' + esc(s.sub) + '</small></span></a></li>\n'; });
    h += '              </ul>\n            </div>\n          </li>\n';
  }
  if (cs.length) {
    h += '          <li class="has-sub">\n            <a href="' + casesUrl() + '">Études de cas</a>\n            <button class="sub-toggle" aria-label="Ouvrir le sous-menu Études de cas" aria-expanded="false"></button>\n            <ul class="sub">\n              <li><a href="' + casesUrl() + '">Toutes les études de cas</a></li>\n';
    cs.forEach(c => { h += '              <li><a href="' + esc(caseUrl(c)) + '">' + esc(caseData(c).short_name || c.title) + '</a></li>\n'; });
    h += '            </ul>\n          </li>\n';
  }
  h += '          <li class="has-sub">\n            <a href="' + esc(insightsUrl()) + '">Insights</a>\n';
  if (cats.length) h += '            <button class="sub-toggle" aria-label="Ouvrir le sous-menu Insights" aria-expanded="false"></button>\n            <ul class="sub">\n' + cats.map(c => '              <li><a href="' + esc(c.url) + '">' + esc(c.name) + '</a></li>\n').join('') + '            </ul>\n';
  h += '          </li>\n          <li class="has-sub">\n            <a href="' + aboutUrl + '">A Propos</a>\n';
  if (about.length) h += '            <button class="sub-toggle" aria-label="Ouvrir le sous-menu A Propos" aria-expanded="false"></button>\n            <ul class="sub">\n' + about.map(p => '              <li><a href="' + esc(pageUrl(p.slug)) + '">' + esc(p.title) + '</a></li>\n').join('') + '            </ul>\n';
  h += '          </li>\n';
  h += '          <li><a href="' + esc(contact) + '">Contact</a></li>\n';
  h += '          <li class="only-m"><a href="' + esc(pageByTpl('faq', 'faq')) + '">FAQ</a></li>\n';
  h += '          <li class="only-m"><a href="' + esc(S('stages_url')) + '">Catalogue de stages</a></li>\n';
  h += '          <li class="only-m"><a class="btn btn-dark" href="' + esc(devis) + '">Devis</a></li>\n        </ul>\n      </nav>\n';
  h += '      <div class="hd-cta desk">\n        <a class="btn btn-soft btn-sm" href="' + esc(contact) + '">Nous contacter</a>\n        <a class="btn btn-dark btn-sm" href="' + esc(devis) + '">Devis <span class="arr">→</span></a>\n      </div>\n';
  h += '      <button class="burger" id="burger" aria-label="Ouvrir le menu" aria-expanded="false" aria-controls="main-nav"><span></span><span></span></button>\n    </div>\n  </header>\n';
  return h;
}

function footerHtml() {
  const sv = services(), about = aboutPages(), wm = S('wordmark');
  const addr = t => nl2br(String(t).replace(/\n/g, ' '));
  let h = '  <footer class="footer">\n    <div class="container footer-grid">\n      <div>\n';
  h += '        <a class="flogo" href="/" aria-label="' + esc(siteName()) + '"><img src="' + esc(img('logo.png')) + '" width="300" height="122" alt="' + esc(siteName()) + '" loading="lazy"></a>\n';
  h += '        <p>' + esc(S('footer_p1')) + '</p>\n        <p>' + esc(S('footer_p2')) + '</p>\n      </div>\n';
  h += '      <nav aria-label="Services">\n        <h2>Services</h2>\n        <ul>\n' + sv.map(s => '          <li><a href="' + esc(s.url) + '">' + esc(s.short) + '</a></li>\n').join('') + '          <li><a href="' + esc(insightsUrl()) + '">Insights</a></li>\n        </ul>\n      </nav>\n';
  h += '      <nav aria-label="Navigation pied de page">\n        <h2>Navitrends</h2>\n        <ul>\n          <li><a href="/">Accueil</a></li>\n          <li><a href="/a-propos/">A Propos</a></li>\n          <li><a href="' + casesUrl() + '">Études de cas</a></li>\n';
  h += about.map(p => '          <li><a href="' + esc(pageUrl(p.slug)) + '">' + esc(p.title) + '</a></li>\n').join('');
  h += '          <li><a href="' + esc(pageByTpl('faq', 'faq')) + '">FAQ</a></li>\n          <li><a href="' + esc(pageByTpl('contact', 'contact')) + '">Contact</a></li>\n          <li><a href="' + esc(S('stages_url')) + '">Catalogue de stages</a></li>\n        </ul>\n      </nav>\n';
  h += '      <div>\n        <h2>' + esc(S('tn_name')) + '</h2>\n        <address>' + addr(S('tn_address')) + '<br><a href="mailto:' + esc(S('tn_email')) + '">' + esc(S('tn_email')) + '</a><br><a href="tel:' + esc(S('tn_tel')) + '">' + esc(S('tn_phone')) + '</a></address>\n';
  h += '        <h2>' + esc(S('uk_name')) + '</h2>\n        <address>' + addr(S('uk_address')) + '<br><a href="mailto:' + esc(S('uk_email')) + '">' + esc(S('uk_email')) + '</a><br><a href="tel:' + esc(S('uk_tel')) + '">' + esc(S('uk_phone')) + '</a></address>\n      </div>\n    </div>\n';
  h += '    <div class="legal container">\n      <p>' + esc(S('legal_1')) + '</p>\n      <p>' + esc(S('legal_2')) + '</p>\n      <p><a href="' + esc(S('facebook')) + '" rel="noopener">Facebook</a> · <a href="' + esc(S('linkedin')) + '" rel="noopener">LinkedIn</a></p>\n    </div>\n';
  if (wm) h += '    <div class="wordmark reveal" aria-hidden="true"><div class="wm-blobs"><i></i><i></i><i></i><i class="cur"></i></div><div class="wm-track">' + Array(4).fill('<span class="wm-text">' + esc(wm) + '</span>').join('') + '</div></div>\n';
  return h + '  </footer>\n';
}

function ctaHtml(path0) {
  const c = (X.home && X.home.cta) || {};
  return '    <section class="cta" id="newsletter">\n      <div class="container">\n        <div class="cta-box reveal">\n'
    + '          <p class="label">' + esc(c.label || 'Newsletter') + '</p>\n          <h2>' + rich(c.h2 || '') + '</h2>\n          <p>' + esc(c.p || '') + '</p>\n'
    + '          <p class="form-ok" id="nl-ok" role="status" style="display:none">Merci, votre inscription est bien prise en compte.</p>\n'
    + '          <form class="newsletter" action="/forms/newsletter" method="post">\n'
    + '            <input type="hidden" name="action" value="nv_newsletter">\n            <input type="hidden" name="nv_back" value="' + esc(path0) + '">\n'
    + '            <div class="hp" aria-hidden="true"><label>Ne pas remplir <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>\n'
    + '            <label class="sr-only" for="nl-email">Email</label>\n            <input id="nl-email" type="email" name="email" placeholder="Votre email" autocomplete="email" required>\n            <button class="btn btn-dark" type="submit">S’inscrire</button>\n          </form>\n'
    + '          <p class="form-note" id="nl-err" role="alert" style="color:#b3261e;margin-top:10px" hidden>Adresse e-mail invalide ou envoi impossible. Merci de réessayer.</p>\n'
    + '        </div>\n      </div>\n    </section>\n';
}

/* ---------- gabarit de page (SEO inclus) ---------- */
function orgNode() {
  const b = base();
  const logo = S('org_logo') || (b.replace(/\/$/, '') + img('logo.png'));
  return {
    '@type': 'Organization', '@id': b + '#organization', name: siteName(), url: b, logo, description: S('org_desc'),
    sameAs: [S('facebook'), S('linkedin')].filter(Boolean),
    contactPoint: [
      { '@type': 'ContactPoint', telephone: S('tn_phone'), email: S('tn_email'), contactType: 'sales' },
      { '@type': 'ContactPoint', telephone: S('uk_phone'), email: S('uk_email'), contactType: 'customer service' }
    ]
  };
}

/* doc : { path, title, desc, ogType, bodyClass, main, crumbs:[[nom,url]], extraLd:[], ogImage, isHome } */
function shell(doc) {
  const b = base();
  const canonical = b.replace(/\/$/, '') + doc.path;
  const graph = [orgNode(), { '@type': 'WebSite', '@id': b + '#website', url: b, name: siteName(), inLanguage: 'fr-FR', publisher: { '@id': b + '#organization' } }];
  if (!doc.isHome && doc.crumbs) {
    const items = [['Home', b]].concat(doc.crumbs.map(c => [c[0], b.replace(/\/$/, '') + (c[1] || doc.path)]));
    graph.push({ '@type': 'BreadcrumbList', itemListElement: items.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: c[1] })) });
  }
  (doc.extraLd || []).forEach(n => graph.push(n(canonical, b)));
  const ogImg = doc.ogImage ? (/^https?:/.test(doc.ogImage) ? doc.ogImage : b.replace(/\/$/, '') + doc.ogImage) : (S('org_logo') || b.replace(/\/$/, '') + img('logo.png'));
  const ld = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
  return '<!DOCTYPE html>\n<html lang="fr-FR">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n'
    + '<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
    + '<meta name="theme-color" content="#faf9f6"><meta name="color-scheme" content="light">\n'
    + '<title>' + esc(doc.title) + '</title>\n'
    + (doc.desc ? '<meta name="description" content="' + esc(doc.desc) + '">\n' : '')
    + '<meta name="robots" content="index, follow, max-image-preview:large">\n'
    + '<link rel="canonical" href="' + esc(canonical) + '">\n'
    + '<meta property="og:type" content="' + (doc.ogType || 'website') + '">\n<meta property="og:locale" content="fr_FR"><meta property="og:site_name" content="' + esc(siteName()) + '">\n'
    + '<meta property="og:title" content="' + esc(doc.title) + '">\n' + (doc.desc ? '<meta property="og:description" content="' + esc(doc.desc) + '">\n' : '')
    + '<meta property="og:url" content="' + esc(canonical) + '">\n<meta property="og:image" content="' + esc(ogImg) + '">\n'
    + '<link rel="icon" href="' + esc(img('logo.png')) + '">\n'
    + '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap">\n'
    + '<link rel="stylesheet" href="/assets/css/main.css?v=' + ver('main.css') + '">\n'
    + '<script type="application/ld+json">' + ld + '</script>\n'
    + '</head>\n<body' + (doc.bodyClass ? ' class="' + esc(doc.bodyClass) + '"' : '') + '>\n'
    + sprite + '\n  <a class="skip-link" href="#main">Aller au contenu</a>\n  <div class="scroll-progress" id="scroll-progress" aria-hidden="true"></div>\n\n'
    + headerHtml(!!doc.isHome) + '\n<main id="main">\n' + doc.main + ctaHtml(doc.path) + '</main>\n' + footerHtml()
    + '<script src="/assets/js/main.js?v=' + ver('main.js') + '" defer></script>\n</body>\n</html>\n';
}

const themeClass = t => 'sp t-' + String(t || 'blue').replace(/[^a-z]/g, '');

/* ---------- formulaires ---------- */
const formSvg = p => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
const extraOf = (p, defs) => Object.assign({}, defs, p.extra || {});

function contactBlock(p) {
  const ex = extraOf(p, require('./schema.json').extraDefaults.contact);
  return `    <section class="section" id="formulaire" style="padding-top:50px">
      <div class="container form-wrap">
        <div class="form-side">
          <div class="ct-card reveal">
            <h2>${esc(ex.card_h2)}</h2>
            <div class="ct-item"><span class="mi m1" aria-hidden="true">${formSvg('<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>')}</span><span><small>${esc(S('tn_name'))}</small><address style="font-style:normal">${nl2br(S('tn_address'))}</address></span></div>
            <div class="ct-item"><span class="mi m2" aria-hidden="true">${formSvg('<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/>')}</span><span><small>E-mail</small><a href="mailto:${esc(S('tn_email'))}">${esc(S('tn_email'))}</a></span></div>
            <div class="ct-item"><span class="mi m3" aria-hidden="true">${formSvg('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>')}</span><span><small>Téléphone</small><a href="tel:${esc(S('tn_tel'))}">${esc(S('tn_phone'))}</a></span></div>
            <div class="ct-social"><a href="${esc(S('facebook'))}" rel="noopener">Facebook</a><a href="${esc(S('linkedin'))}" rel="noopener">LinkedIn</a></div>
          </div>
        </div>
        <form class="pg-form reveal" style="--i:1" action="/forms/contact" method="post">
          <input type="hidden" name="action" value="nv_contact">
          <input type="hidden" name="nv_page" value="${esc(p.slug)}">
          <input type="hidden" name="nv_back" value="${esc(pageUrl(p.slug))}">
          <div class="hp" aria-hidden="true"><label>Ne pas remplir <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <h2>${esc(ex.form_h2)}</h2>
          <p>${esc(ex.form_p)}</p>
          <div class="fld"><label for="c-name">Nom</label><input id="c-name" name="nom" type="text" autocomplete="name" required></div>
          <div class="fld"><label for="c-mail">Email</label><input id="c-mail" name="email" type="email" autocomplete="email" required></div>
          <div class="fld"><label for="c-msg">Message</label><textarea id="c-msg" name="message" required></textarea></div>
          <button class="btn btn-dark" type="submit">${esc(ex.btn)} <span class="arr">→</span></button>
          <p class="form-ok" role="status">${esc(ex.ok_msg)}</p>
          <p class="form-err" role="alert" hidden>Votre message n’a pas pu être envoyé. Vérifiez les champs et réessayez.</p>
${ex.form_note ? '          <p class="form-note">' + esc(ex.form_note) + '</p>\n' : ''}        </form>
      </div>
    </section>
`;
}

function devisBlock(p) {
  const ex = extraOf(p, require('./schema.json').extraDefaults.devis);
  return `    <section class="section" id="formulaire" style="padding-top:50px">
      <div class="container form-wrap">
        <div class="form-side">
          <div class="side-card c-gold reveal">
            <h2>${esc(ex.why_h2)}</h2>
            ${ul(ex.why_list)}
          </div>
          <div class="side-card c-blue reveal" style="--i:1">
            <h2>${esc(ex.steps_h2)}</h2>
            <ol class="side-steps">${lines(ex.steps_list).map(t => '<li>' + esc(t) + '</li>').join('')}</ol>
          </div>
        </div>
        <form class="pg-form reveal" style="--i:1" action="/forms/devis" method="post">
          <input type="hidden" name="action" value="nv_devis">
          <input type="hidden" name="nv_page" value="${esc(p.slug)}">
          <input type="hidden" name="nv_back" value="${esc(pageUrl(p.slug))}">
          <div class="hp" aria-hidden="true"><label>Ne pas remplir <input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>
          <h2>${esc(ex.form_h2)}</h2>
          <p>${esc(ex.form_p)}</p>
          <div class="fld-row">
            <div class="fld"><label for="d-name">Nom</label><input id="d-name" name="nom" type="text" autocomplete="name" required></div>
            <div class="fld"><label for="d-phone">Téléphone</label><input id="d-phone" name="telephone" type="tel" autocomplete="tel"></div>
          </div>
          <div class="fld-row">
            <div class="fld"><label for="d-mail">Email</label><input id="d-mail" name="email" type="email" autocomplete="email" required></div>
            <div class="fld"><label for="d-company">Société</label><input id="d-company" name="societe" type="text" autocomplete="organization"></div>
          </div>
          <div class="fld"><label for="d-service">Services</label>
            <select id="d-service" name="services">
              <option value="">Choisir un service</option>
              ${lines(ex.services).map(t => '<option>' + esc(t) + '</option>').join('')}
            </select>
          </div>
          <div class="fld"><label for="d-project">Projet</label><textarea id="d-project" name="projet" required></textarea></div>
          <button class="btn btn-dark" type="submit">${esc(ex.btn)} <span class="arr">→</span></button>
          <p class="form-ok" role="status">${esc(ex.ok_msg)}</p>
          <p class="form-err" role="alert" hidden>Votre demande n’a pas pu être envoyée. Vérifiez les champs et réessayez.</p>
        </form>
      </div>
    </section>
`;
}

function faqBlock() {
  const cats = X.faq || []; let n = 0;
  let o = '    <section class="section" style="padding-top:40px">\n      <div class="container">\n';
  o += '        <nav class="faq-nav reveal" aria-label="Catégories de la FAQ">' + cats.map((c, i) => '<a href="#cat-' + (i + 1) + '">' + esc(c.name) + '</a>').join('') + '</nav>\n';
  cats.forEach((c, ci) => {
    o += '        <section class="faq-cat c-' + pastel(ci) + '" id="cat-' + (ci + 1) + '">\n          <header class="reveal"><b aria-hidden="true">' + (ci + 1) + '</b><h2>' + esc(c.name) + '</h2></header>\n          <div class="faq-list reveal">\n';
    (c.items || []).forEach(it => {
      n++;
      o += '            <details class="faq"><summary><span class="q">' + String(n).padStart(2, '0') + '</span>' + esc(it.q) + '</summary><div class="ans">' + paraList(it.a).map(t => '<p>' + esc(t) + '</p>').join('') + '</div></details>\n';
    });
    o += '          </div>\n        </section>\n';
  });
  return o + '      </div>\n    </section>\n';
}

function hubBlock() {
  return '    <section class="section" style="padding-top:60px">\n      <div class="container">\n        <div class="svc-cards">\n'
    + services().map((s, k) => '          <a class="svc-card c-' + esc(s.theme) + ' reveal" style="--i:' + (k % 3) + '" href="' + esc(s.url) + '">\n            <span class="mi ' + esc(s.mi) + '" aria-hidden="true">' + esc(s.glyph) + '</span>\n            <h3>' + esc(s.card_title) + '</h3>\n            <span class="sub">(' + esc(s.card_tag) + ')</span>\n            <p>' + esc(s.hub_desc) + '</p>\n            <em>Voir plus</em>\n          </a>\n').join('')
    + '        </div>\n      </div>\n    </section>\n';
}

function moreServices(p) {
  return '    <section class="section sp-more" style="padding-top:0">\n      <div class="container">\n        <header class="sec-head reveal">\n          <p class="label">Services</p>\n          <h2>Nos autres expertises</h2>\n        </header>\n        <ul class="more-grid">\n'
    + services().map((o, k) => o.slug === p.slug ? '' : '          <li class="reveal" style="--i:' + (k % 3) + '"><a href="' + esc(o.url) + '"><span class="mi ' + esc(o.mi) + '" aria-hidden="true">' + esc(o.glyph) + '</span><span><b>' + esc(o.short) + '</b><small>' + esc(o.sub) + '</small></span><i aria-hidden="true">→</i></a></li>\n').join('')
    + '        </ul>\n      </div>\n    </section>\n';
}

/* ---------- pages ---------- */
function pageSeo(p) {
  const s = p.seo || {};
  const h = heroData(p);
  const intro = paraList(h.intro);
  const t = (h.tagline || '') + (intro.length ? ' – ' + intro[0] : '');
  return { title: (s.title || '').trim() || p.title + ' – Société Navitrends', desc: (s.desc || '').trim() || short(t.trim()) };
}

function renderPage(p, pageNo) {
  const h = heroData(p); const seo = pageSeo(p); const tpl = p.tpl || 'default';
  let main = '';
  const crumbs = tpl === 'service' ? [['Services', pageByTpl('hub', 'services')], [p.title, '']] : [[p.title, '']];
  main += pageHero(p, crumbs);
  let path0 = pageUrl(p.slug); let pages_total = 1;
  if (tpl === 'contact') main += contactBlock(p);
  else if (tpl === 'devis') main += devisBlock(p);
  else if (tpl === 'faq') main += faqBlock();
  else if (tpl === 'hub') main += hubBlock();
  else if (tpl === 'insights') { const ps = postsSection(pageNo || 1); main += ps.html; pages_total = ps.total; if (pageNo > 1) path0 = path0 + 'page/' + pageNo + '/'; }
  main += renderSections(p.sections);
  if (tpl === 'service') main += moreServices(p);
  const extraLd = [(canonical, b) => ({ '@type': 'WebPage', '@id': canonical + '#page', url: canonical, name: seo.title, description: seo.desc, inLanguage: 'fr-FR', isPartOf: { '@id': b + '#website' } })];
  if (tpl === 'service') extraLd.push((canonical, b) => ({ '@type': 'Service', '@id': canonical + '#service', name: p.title, serviceType: (p.service || {}).short || p.title, description: paraList(h.intro).join(' '), url: canonical, provider: { '@id': b + '#organization' }, areaServed: ['Tunisie', 'Europe', 'Royaume-Uni', 'Moyen-Orient'] }));
  if (tpl === 'faq') extraLd.push((canonical) => {
    const qa = []; (X.faq || []).forEach(c => (c.items || []).forEach(it => qa.push({ '@type': 'Question', name: it.q, acceptedAnswer: { '@type': 'Answer', text: it.a } })));
    return { '@type': 'FAQPage', '@id': canonical + '#faq', mainEntity: qa };
  });
  return {
    html: shell({ path: path0, title: seo.title + (pageNo > 1 ? ' – page ' + pageNo : ''), desc: seo.desc, bodyClass: themeClass(h.theme), main, crumbs, extraLd }),
    path: path0, pages_total
  };
}

function renderCase(c) {
  const d = caseData(c);
  const logoImg = d.logo ? '<div class="case-logo' + (d.logo_dark ? ' dark' : '') + '"><img src="' + esc(img(d.logo)) + '" alt="' + esc(d.logo_alt) + '"></div>' : '<div class="case-logo ico"><span><svg><use href="#i-heart"/></svg></span></div>';
  const pos = ['left:5%;top:4%;--r:-4deg', 'right:5%;top:13%;--r:3deg;--d:-3s', 'left:6%;bottom:4%;--r:-3deg;--d:-1.5s'];
  let vis = '<div class="cs-vis" aria-hidden="true">' + logoImg + '<p class="cs-banner">' + esc(d.banner) + '</p>';
  lines(d.tags).slice(0, 3).forEach((t, k) => { vis += '<span class="stk pill" style="' + pos[k] + '"><i class="' + ['', 'b', 'g'][k % 3] + '"></i>' + esc(t) + '</span>'; });
  vis += '</div>';
  let after = '<div class="cs-client reveal" style="--i:3">' + (d.logo ? '<img src="' + esc(img(d.logo)) + '" alt="' + esc(d.logo_alt) + '" height="44">' : '') + '<span>Client : <strong>' + esc(d.client) + '</strong></span></div>';
  after += '<div class="cs-tags reveal" style="--i:4">' + lines(d.tags).map(t => '<span>' + esc(t) + '</span>').join('') + '</div>';
  let main = heroHtml({ crumbs: [['Études de cas', casesUrl()], [d.short_name || c.title, '']], label: d.kicker, h1: c.title, tagline: d.summary, after, visual: vis });
  main += renderSections(c.sections);
  const all = cases(); const idx = all.findIndex(x => x.slug === c.slug); const others = [];
  if (idx >= 0 && all.length > 1) { others.push(all[(idx + 1) % all.length]); if (all.length > 2) others.push(all[(idx + 2) % all.length]); }
  if (others.length) main += '    <section class="section" style="padding-top:0">\n      <div class="container">\n        <header class="sec-head reveal">\n          <p class="label">Études de cas</p>\n          <h2>À lire aussi</h2>\n        </header>\n        <div class="cases-grid g2">\n          ' + others.map((o, i) => caseCard(o, i)).join('\n') + '\n        </div>\n      </div>\n    </section>\n';
  const s = c.seo || {};
  const title = (s.title || '').trim() || c.title + ' – Étude de cas Navitrends';
  const desc = (s.desc || '').trim() || short(d.summary);
  return shell({
    path: caseUrl(c), title, desc, ogType: 'article', bodyClass: themeClass(d.theme), main,
    crumbs: [['Études de cas', casesUrl()], [c.title, '']],
    extraLd: [(canonical, b) => ({ '@type': 'Article', '@id': canonical + '#article', headline: c.title, description: d.summary, inLanguage: 'fr-FR', mainEntityOfPage: canonical, author: { '@id': b + '#organization' }, publisher: { '@id': b + '#organization' } })],
    ogImage: d.logo ? img(d.logo) : ''
  });
}

function renderCasesIndex() {
  const groups = new Map();
  cases().forEach(c => { const g = caseData(c).group || 'Réalisations'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(c); });
  let main = heroHtml({ crumbs: [['Études de cas', '']], label: S('cases_label'), h1: S('cases_h1'), tagline: S('cases_tag'), intro: [S('cases_intro')], pad: '20px' });
  groups.forEach((list, name) => {
    const n = list.length;
    main += '    <section class="section" style="padding-top:20px">\n      <div class="container">\n        <header class="sec-head reveal">\n          <p class="label">' + esc(name + ' · ' + n + ' étude' + (n > 1 ? 's' : '') + ' de cas') + '</p>\n          <h2>' + esc(name) + '</h2>\n        </header>\n        <div class="cases-grid g' + (n <= 2 ? 2 : 3) + '">\n          ' + list.map((c, i) => caseCard(c, i)).join('\n') + '\n        </div>\n      </div>\n    </section>\n';
  });
  return shell({
    path: casesUrl(), title: S('seo_cases_title') || 'Nos réalisations – Études de cas ERPNext et logiciels sur mesure – Société Navitrends',
    desc: S('seo_cases_desc') || 'Études de cas Navitrends : ERPNext, digitalisation industrielle et logiciels sur mesure — défis, solutions conçues et bénéfices visés.',
    bodyClass: themeClass('sky'), main, crumbs: [['Études de cas', '']]
  });
}

function renderArticle(a) {
  const main = heroHtml({ crumbs: [['Insights', insightsUrl()], [a.title, '']], label: a.cat || 'Insights', h1: a.title, tagline: dateLabel(a.date), pad: '20px' })
    + '    <article class="section" style="padding-top:30px">\n      <div class="container pg-article">\n'
    + (a.img ? '        <img class="pg-cover reveal" src="' + esc(img(a.img)) + '" alt="" loading="lazy">\n' : '')
    + '        <div class="pg-prose reveal">' + paraList(a.body).map(t => '<p>' + esc(t) + '</p>').join('') + '</div>\n      </div>\n    </article>\n';
  const p = '/' + articleSlug(a) + '/';
  return shell({
    path: p, title: a.title + ' – Société Navitrends', desc: short(paraList(a.body)[0] || a.title), ogType: 'article', bodyClass: themeClass('sky'), main,
    crumbs: [['Insights', insightsUrl()], [a.title, '']], ogImage: a.img ? img(a.img) : '',
    extraLd: [(canonical, b) => ({ '@type': 'Article', '@id': canonical + '#article', headline: a.title, datePublished: a.date, inLanguage: 'fr-FR', mainEntityOfPage: canonical, author: { '@id': b + '#organization' }, publisher: { '@id': b + '#organization' } })]
  });
}

function render404() {
  const main = heroHtml({
    crumbs: [['Page introuvable', '']], label: 'Erreur 404', h1: 'Cette page est introuvable',
    tagline: 'La page que vous cherchez a été déplacée ou n’existe plus.', actions: 1, visual: visHtml('target', 'Retrouvons votre chemin', ['Accueil', 'Services', 'Contact'])
  });
  return shell({ path: '/404.html', title: 'Page introuvable – Société Navitrends', desc: '', bodyClass: themeClass('rose'), main, crumbs: [['Page introuvable', '']] });
}

/* ---------- accueil ---------- */
function renderHome() {
  const h = X.home || {};
  const g = (sec, key, def = '') => (h[sec] && h[sec][key] != null ? h[sec][key] : def);
  const on = sec => !h[sec] || h[sec].show == null || !!h[sec].show && h[sec].show !== '0';
  const sv = services(); const hero = h.hero || {};
  let typed = lines(hero.typed || ['performance']); if (!typed.length) typed = ['performance'];
  const addr = t => nl2br(String(t).replace(/\n/g, ' '));
  const head = (sec, tag = 'header') => `        <header class="sec-head reveal">
          <p class="label">${esc(g(sec, 'label'))}</p>
          <h2>${rich(g(sec, 'h2'))}</h2>
          <p>${rich(g(sec, 'intro'))}</p>
        </header>
`;
  let o = '';
  o += `    <!-- HERO -->
    <section class="hero" id="top">
      <div class="aurora" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="hero-float" aria-hidden="true">
        <span class="ff f1" data-depth="30"><i>⚙</i>ERP</span>
        <span class="ff f2" data-depth="-22"><i>⚡</i>Workflows APA</span>
        <span class="ff f3" data-depth="38"><i>✦</i>IA</span>
        <span class="ff f4" data-depth="-30"><i>◎</i>Odoo</span>
      </div>
      <div class="container">
        ${hero.badge ? '<p class="badge reveal"><b>★</b> ' + esc(hero.badge) + '</p>' : ''}
        <h1 class="reveal" style="--i:1">${rich(hero.h1 || '')} <span class="grad live typed-wrap"><span id="typed" data-words="${esc(JSON.stringify(typed))}">${esc(typed[0])}</span></span><span class="caret" aria-hidden="true"></span></h1>
        <p class="lead reveal" style="--i:2">${rich(hero.lead || '')}</p>
        <div class="hero-actions reveal" style="--i:3">
          ${hero.btn1_t ? '<a class="btn btn-dark" href="' + esc(url(hero.btn1_u || 'devis')) + '">' + esc(hero.btn1_t) + ' <span class="arr">→</span></a>' : ''}
          ${hero.btn2_t ? '<a class="btn btn-line" href="' + esc(url(hero.btn2_u || 'services')) + '">' + esc(hero.btn2_t) + '</a>' : ''}
        </div>
      </div>
      ${lines(hero.marquee).length ? '<div class="marquee hero-marquee reveal" style="--i:5" aria-label="Technologies et expertises">\n        <div class="marquee-track" data-marquee>\n          ' + lines(hero.marquee).map(t => '<span class="mq">' + esc(t) + '</span>').join('') + '\n        </div>\n      </div>' : ''}
    </section>
`;
  if ((h.stats || []).length) {
    o += '\n    <!-- CHIFFRES -->\n    <section class="why" aria-label="Chiffres clés">\n      <div class="container why-grid">\n'
      + h.stats.map((s, i) => '        <div class="reveal" style="--i:' + i + '"><strong>' + esc(s.pre || '') + '<span class="count" data-to="' + esc(s.to || '0') + '">' + esc(s.to || '') + '</span>' + esc(s.suf || '') + '</strong><p>' + esc(s.text || '') + '</p></div>\n').join('')
      + '      </div>\n    </section>\n';
  }
  if (sv.length) {
    o += '\n    <!-- SERVICES -->\n    <section class="section" id="services" style="padding-top:40px">\n      <div class="container">\n' + head('services')
      + '        <div class="svc-wrap">\n          <div class="svc-track" id="svc-track">\n'
      + sv.map((s, i) => `            <article class="svc reveal" style="--i:${i}">
              <a href="${esc(s.url)}">
                <h3>${esc(s.card_title)}</h3>
                <p class="tag">${esc(s.card_tag)}</p>
                <p class="desc">${esc(s.card_desc)}</p>
                <span class="more">Voir plus</span>
                ${mockHtml(s.mock)}
              </a>
            </article>
`).join('')
      + '          </div>\n          <div class="svc-nav">\n            <button type="button" class="svc-btn" id="svc-prev" aria-label="Services précédents">←</button>\n            <button type="button" class="svc-btn" id="svc-next" aria-label="Services suivants">→</button>\n          </div>\n        </div>\n      </div>\n    </section>\n';
  }
  if (on('change') && h.change && (h.change.rows || []).length) {
    o += '\n    <!-- LE MONDE CHANGE -->\n    <section class="section change" id="a-propos">\n      <div class="container">\n' + head('change') + '        <div class="feat">\n';
    h.change.rows.forEach((r, i) => {
      const vis = r.vis || 'flow'; const col = r.color || 'blue';
      let v;
      if (vis === 'steps') v = `              <img class="cut" src="${esc(img(r.img))}" width="512" height="420" alt="${esc(r.alt || '')}" loading="lazy">
              <div class="steps" aria-hidden="true"><div class="st s1"><b>1</b>Audit</div><div class="st s2"><b>2</b>Plan</div><div class="st s3"><b>3</b>Go !</div></div>
              <span class="stk pill" style="left:0;top:10%;--r:-4deg" aria-hidden="true"><i class="g"></i>Audit processus</span>
              <span class="stk ico" style="right:4%;top:6%;--r:8deg;--d:-2s;--bg:linear-gradient(135deg,#ff8d7a,#c0392b)" aria-hidden="true"><svg><use href="#i-target"/></svg></span>
              <span class="stk pill" style="left:34%;top:38%;--r:3deg;--d:-4s" aria-hidden="true"><i class="b"></i>Roadmap</span>
`;
      else {
        v = `              <div class="fv-photo" data-speed=".04"><img src="${esc(img(r.img))}" width="900" height="600" alt="${esc(r.alt || '')}" loading="lazy"></div>\n`;
        if (vis === 'card') v += `              <div class="u-card" aria-hidden="true">
                <b>Stocks &amp; facturation</b>
                <div class="row"><div class="donut"></div><ul class="legend"><li><i></i>Achats</li><li><i class="g"></i>Ventes</li><li><i class="l"></i>Stock</li></ul></div>
                <div class="bars"><i style="--h:45%"></i><i style="--h:72%"></i><i style="--h:55%"></i><i style="--h:92%"></i><i style="--h:66%"></i><i style="--h:80%"></i></div>
              </div>
              <span class="stk pill" style="left:0;top:8%;--r:-4deg" aria-hidden="true"><i class="b"></i>ERP ⇄ CRM</span>
              <span class="stk ico" style="left:4%;bottom:14%;--r:-8deg;--d:-2s;--bg:linear-gradient(135deg,#9a7bff,#5b3fd1)" aria-hidden="true"><svg><use href="#i-link"/></svg></span>
              <span class="stk pill" style="right:6%;top:2%;--r:4deg;--d:-3s" aria-hidden="true"><i></i>API connectée</span>
`;
        else v += `              <div class="u-flow" aria-hidden="true">
                <div class="r"><svg><use href="#i-check"/></svg>Nouvelle commande</div>
                <div class="r on"><svg><use href="#i-bolt"/></svg>Traitement auto</div>
                <div class="r"><svg><use href="#i-check"/></svg>Facture envoyée</div>
                <div class="r dim"><svg><use href="#i-link"/></svg>Notification</div>
              </div>
              <span class="stk pill" style="left:0;top:8%;--r:-4deg" aria-hidden="true"><i class="live"></i>Workflow actif</span>
              <span class="stk ico" style="left:6%;bottom:12%;--r:-8deg;--d:-2s;--bg:linear-gradient(135deg,#ffd77a,#F0B323)" aria-hidden="true"><svg><use href="#i-bolt"/></svg></span>
`;
      }
      o += `          <article class="feat-row f-${esc(col)}${r.rev ? ' rev' : ''}" style="--i:${i}">
            <div class="feat-tx">
              <small>${esc(r.small || '')}</small>
              <h3>${esc(r.h3 || '')}</h3>
              <ul class="checks">${lines(r.list).map(li => '<li>' + esc(li) + '</li>').join('')}</ul>
              ${r.link_t ? '<a class="link" href="' + esc(url(r.link_u || '')) + '">' + esc(r.link_t) + ' <span>→</span></a>' : ''}
            </div>
            <div class="feat-vis">
${v}            </div>
          </article>
`;
    });
    o += '        </div>\n      </div>\n    </section>\n';
  }
  if (on('approach') && h.approach && (h.approach.tabs || []).length) {
    const tabs = h.approach.tabs;
    o += '\n    <!-- APPROCHE (ONGLETS) -->\n    <section class="when" id="approche">\n      <div class="container">\n' + head('approach')
      + '        <div class="tabs" role="tablist" aria-label="Services">\n' + tabs.map((t, i) => '          <button class="tab" role="tab" id="tab-' + i + '" aria-selected="' + (i === 0 ? 'true' : 'false') + '" aria-controls="panel-' + i + '">' + esc(t.tab || '') + '</button>\n').join('') + '        </div>\n'
      + tabs.map((t, i) => `        <div class="panel${i === 0 ? ' on' : ''}" data-t="${i}" role="tabpanel" id="panel-${i}" aria-labelledby="tab-${i}">
          <div class="tx">
            <h3>${esc(t.h3 || '')}</h3>
            <p>${esc(t.p || '')}</p>
            ${t.btn_t ? '<a class="btn btn-dark" href="' + esc(url(t.btn_u || '')) + '">' + esc(t.btn_t) + ' <span class="arr">→</span></a>' : ''}
          </div>
          <ul>${lines(t.steps).map((st, k) => '<li><b>' + (k + 1) + '</b>' + esc(st) + '</li>').join('')}</ul>
        </div>
`).join('') + '      </div>\n    </section>\n';
  }
  if (on('tools')) {
    o += '\n    <!-- OUTILS -->\n    <section class="tools" id="outils">\n      <div class="container">\n' + head('tools') + '      </div>\n';
    if (lines(g('tools', 'm1', [])).length) o += '      <div class="marquee big reveal" aria-label="Solutions ERP et domaines de gestion">\n        <div class="marquee-track" data-marquee style="--dur:46s">' + lines(g('tools', 'm1', [])).map(t => '<span class="mq">' + esc(t) + '</span>').join('') + '</div>\n      </div>\n';
    if (lines(g('tools', 'm2', [])).length) o += '      <div class="marquee big rev reveal" style="--i:1" aria-label="Automatisation et intégration">\n        <div class="marquee-track" data-marquee style="--dur:52s">' + lines(g('tools', 'm2', [])).map(t => '<span class="mq">' + esc(t) + '</span>').join('') + '</div>\n      </div>\n';
    o += '    </section>\n';
  }
  const ab = h.about || {};
  if (Object.keys(ab).length) {
    o += `
    <!-- A PROPOS -->
    <section class="section" style="padding-top:20px">
      <div class="container about-wrap">
        <div class="about-media reveal">
          <img src="${esc(img(ab.img))}" width="1024" height="1024" alt="${esc(ab.alt || '')}" loading="lazy">
          ${ab.stick_n ? '<div class="about-stick"><span>' + esc(ab.stick_n) + '</span>' + nl2br(ab.stick_t || '') + '</div>' : ''}
        </div>
        <div class="about-copy reveal" style="--i:1">
          <p class="label">${esc(ab.label || '')}</p>
          <h2>${rich(ab.h2 || '')}</h2>
          ${ab.intro ? '<p class="intro">' + rich(ab.intro) + '</p>' : ''}
          ${paraList(ab.ps).map(p => '<p>' + rich(p) + '</p>').join('')}
          ${lines(ab.list).length ? '<ul class="checks">' + lines(ab.list).map(li => '<li>' + esc(li) + '</li>').join('') + '</ul>' : ''}
          ${ab.btn_t ? '<a class="btn btn-dark" href="' + esc(url(ab.btn_u || '')) + '">' + esc(ab.btn_t) + ' <span class="arr">→</span></a>' : ''}
        </div>
      </div>
    </section>
`;
  }
  const cs = cases().slice(0, 5);
  if (cs.length) {
    o += `
    <!-- REALISATIONS -->
    <section class="section" id="realisations" style="padding-top:20px">
      <div class="container">
        <header class="sec-head split reveal">
          <div>
            <p class="label">${esc(g('cases', 'label'))}</p>
            <h2>${rich(g('cases', 'h2'))}</h2>
            <p>${rich(g('cases', 'intro'))}</p>
          </div>
          <a class="link" href="${casesUrl()}">${esc(g('cases', 'link_t', 'Voir toutes les études de cas'))} <span>→</span></a>
        </header>
        <div class="cases-grid g5">
          ${cs.map((c, i) => caseCard(c, i % 3)).join('\n')}
        </div>
      </div>
    </section>
`;
  }
  if (on('presence')) {
    o += `
    <!-- PRESENCE -->
    <section class="presence" id="presence">
      <div class="container">
        <div class="presence-box">
          <div class="reveal">
            <p class="label light">${esc(g('presence', 'label'))}</p>
            <h2>${rich(g('presence', 'h2'))}</h2>
            <p>${esc(g('presence', 'p'))}</p>
          </div>
          <div class="reveal" style="--i:1">
            <div class="offices">
              <address class="office">
                <h3>${esc(S('tn_name'))}</h3>
                ${addr(S('tn_address'))}
                <a href="mailto:${esc(S('tn_email'))}">${esc(S('tn_email'))}</a>
                <a href="tel:${esc(S('tn_tel'))}">${esc(S('tn_phone'))}</a>
              </address>
              <address class="office">
                <h3>${esc(S('uk_name'))}</h3>
                ${addr(S('uk_address'))}
                <a href="mailto:${esc(S('uk_email'))}">${esc(S('uk_email'))}</a>
                <a href="tel:${esc(S('uk_tel'))}">${esc(S('uk_phone'))}</a>
              </address>
            </div>
          </div>
        </div>
      </div>
    </section>
`;
  }
  o += `
    <!-- BLOG -->
    <section class="section" id="insights" style="padding-top:0">
      <div class="container">
        <header class="sec-head split reveal">
          <div>
            <p class="label">${esc(g('blog', 'label'))}</p>
            <h2>${rich(g('blog', 'h2'))}</h2>
            <p>${rich(g('blog', 'intro'))}</p>
          </div>
          <a class="link" href="${esc(insightsUrl())}">${esc(g('blog', 'link_t', 'Voir tous les articles'))} <span>→</span></a>
        </header>
        <div class="posts">
          ${articles().slice(0, 4).map((a, i) => postCard(a, i)).join('\n')}
        </div>
      </div>
    </section>
`;
  if ((h.join || []).length) {
    o += '\n    <!-- REJOINDRE / PARTENAIRE -->\n    <section class="join">\n      <div class="container join-grid">\n' + h.join.map((j, i) => `        <a class="join-card${i % 2 ? ' alt' : ''} photo reveal"${i ? ' style="--i:' + i + '"' : ''} href="${esc(url(j.link_u || ''))}">
          <img src="${esc(img(j.img))}" width="353" height="450" alt="${esc(j.alt || '')}" loading="lazy">
          <div>
            <p class="label light">${esc(j.label || '')}</p>
            <h3>${esc(j.h3 || '')}</h3>
            <p>${esc(j.p || '')}</p>
            <span class="link light">${esc(j.link_t || '')}</span>
          </div>
        </a>
`).join('') + '      </div>\n    </section>\n';
  }
  if (on('lucky')) {
    const lk = h.lucky || {};
    o += `
    <!-- JOUR DE CHANCE -->
    <section class="lucky" id="projet">
      <div class="container">
        <div class="lucky-box reveal">
          <p class="label light">${esc(lk.label || '')}</p>
          <h2>${rich(lk.h2 || '')}</h2>
          <p class="lucky-sub">${esc(lk.sub || '')}</p>
          <div class="scratch" id="scratch">
            <div class="scratch-under">
              ${(lk.cells || []).slice(0, 3).map((c, i) => '<div class="s-c c' + (i + 1) + '"><strong>' + esc(c.n || '') + '</strong><span>' + esc(c.t || '') + '</span></div>').join('')}
            </div>
            <canvas id="scratch-canvas" aria-hidden="true"></canvas>
          </div>
          <button class="scratch-skip" id="scratch-skip" type="button">Tout révéler</button>
          <div class="hero-actions">
            <a class="btn btn-gold" href="${esc(url('devis'))}">Demander un devis <span class="arr">→</span></a>
            <a class="btn btn-line-light" href="${esc(url('contact'))}">Nous contacter</a>
          </div>
        </div>
      </div>
    </section>
`;
  }
  return shell({ path: '/', title: S('seo_home_title'), desc: S('seo_home_desc'), bodyClass: '', main: o, isHome: true });
}

/* ---------- API du module ---------- */
function setContext(data) { X = data; }

module.exports = {
  setContext, renderHome, renderPage, renderCase, renderCasesIndex, renderArticle, render404,
  pages, cases, articles, articleSlug, articleUrl, caseUrl, casesUrl, pageUrl, slugify, base, esc
};
