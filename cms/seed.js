/* Crée le contenu de départ (cms/data/*.json) à partir du contenu réel du site.
   Ne remplace jamais un fichier existant, sauf avec --force. Usage : node cms/seed.js [--force] */
const fs = require('fs');
const path = require('path');
const store = require('./lib/store');
const sch = require('./lib/schema.json');

const SRC = path.join(__dirname, 'seed-src');
const src = n => JSON.parse(fs.readFileSync(path.join(SRC, n + '.json'), 'utf8'));
const force = process.argv.includes('--force');

function put(name, build) {
  if (!force && fs.existsSync(path.join(store.DATA, name + '.json'))) { console.log('  conservé :', name); return; }
  store.write(name, build());
  console.log('  créé     :', name);
}

put('settings', () => Object.assign({}, sch.settingsFields, {
  site_name: 'Navitrends',
  site_url: 'https://navitrends.com',
  smtp_host: '', smtp_port: '587', smtp_secure: 'tls', smtp_user: '', smtp_pass: '', mail_from: '',
  blog_cats: [
    { name: 'ERP & Systèmes de gestion', url: 'https://navitrends.com/category/erp-systemes-de-gestion/' },
    { name: 'Automatisation & IA', url: 'https://navitrends.com/category/automatisation-intelligence-artificielle/' },
    { name: 'Intégration & Systèmes d’information', url: 'https://navitrends.com/category/integration-systemes-dinformation/' },
    { name: 'Pilotage de la performance', url: 'https://navitrends.com/category/accompagnement-operationnel-montee-en-competence-des-equipes/' },
    { name: 'Développement sur mesure', url: 'https://navitrends.com/category/developpement-web-applications-sur-mesure/' }
  ]
}));

put('home', () => src('home'));

put('pages', () => src('pages').map(p => ({
  slug: p.slug, title: p.title, tpl: p.template || 'default', menu: p.menu || '', order: p.menu_order, status: 'publish',
  hero: Object.assign({}, p.hero, { theme: p.theme }),
  service: p.service || {},
  extra: p.template === 'contact' || p.template === 'devis' ? JSON.parse(JSON.stringify(sch.extraDefaults[p.template])) : {},
  sections: p.sections || [],
  seo: { title: p.seo_title || '', desc: p.seo_desc || '' }
})));

put('cases', () => src('cases').map(c => ({
  slug: c.slug, title: c.title, order: c.menu_order, status: 'publish',
  case: { group: c.group, theme: c.theme, client: c.client, short_name: c.short_name, logo: c.logo, logo_alt: c.logo_alt, logo_dark: c.logo_dark ? 1 : 0, kicker: c.kicker, summary: c.summary, banner: c.banner, tags: c.tags },
  sections: c.sections,
  seo: { title: '', desc: '' }
})));

put('faq', () => src('faq').map(c => ({ name: c.name, items: c.items.map(i => ({ q: i.q, a: i.a })) })));

put('articles', () => src('insights').map((a, i) => ({
  id: 'a' + (i + 1), title: a.title, date: a.date, img: a.img, url: a.url, cat: '', slug: '', body: '', status: 'publish'
})));

put('mocks', () => src('mocks'));
console.log('Contenu prêt dans', store.DATA);
