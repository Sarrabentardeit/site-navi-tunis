/* Publication : génère le site statique complet dans cms/site à partir du contenu. */
const fs = require('fs');
const path = require('path');
const store = require('./store');
const R = require('./render');

const ROOT = store.ROOT;
const SITE = process.env.NV_SITE || path.join(ROOT, 'site');
const STATIC = path.join(ROOT, 'static');
const UPLOADS = process.env.NV_UPLOADS || path.join(ROOT, 'uploads');

const put = (dir, rel, html) => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
};

function publish() {
  const t0 = Date.now();
  const data = store.all();
  R.setContext(data);

  const tmp = SITE + '.new', old = SITE + '.old';
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });

  const urls = [];
  const add = (p, pri) => urls.push({ loc: p, pri });

  /* accueil */
  put(tmp, 'index.html', R.renderHome()); add('/', '1.0');

  /* pages */
  R.pages().forEach(p => {
    const r = R.renderPage(p, 1);
    put(tmp, p.slug + '/index.html', r.html); add(R.pageUrl(p.slug), p.tpl === 'service' ? '0.9' : '0.7');
    for (let n = 2; n <= r.pages_total; n++) { const rn = R.renderPage(p, n); put(tmp, p.slug + '/page/' + n + '/index.html', rn.html); }
  });

  /* études de cas */
  put(tmp, 'etudes-de-cas/index.html', R.renderCasesIndex()); add(R.casesUrl(), '0.8');
  R.cases().forEach(c => { put(tmp, 'etudes-de-cas/' + c.slug + '/index.html', R.renderCase(c)); add(R.caseUrl(c), '0.6'); });

  /* articles internes (ceux qui ont un texte) */
  R.articles().forEach(a => {
    if (a.body && String(a.body).trim()) { const s = R.articleSlug(a); put(tmp, s + '/index.html', R.renderArticle(a)); add('/' + s + '/', '0.5'); }
  });

  put(tmp, '404.html', R.render404());

  /* référencement + GEO */
  const b = R.base().replace(/\/$/, '');
  const day = new Date().toISOString().slice(0, 10);
  put(tmp, 'sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + urls.map(u => '  <url><loc>' + R.esc(b + u.loc) + '</loc><lastmod>' + day + '</lastmod><priority>' + u.pri + '</priority></url>').join('\n') + '\n</urlset>\n');
  let robotsTxt = 'User-agent: *\nAllow: /\nDisallow: /backoffice/\nDisallow: /api/\n\nSitemap: ' + b + '/sitemap.xml\n';
  let llmsTxt = '';
  try {
    const geo = require('./geo');
    robotsTxt = geo.robotsTxtForPublish(b, geo.geoSettings().allowAi);
    llmsTxt = geo.llmsForPublish();
  } catch (e) { /* module GEO optionnel au boot */ }
  put(tmp, 'robots.txt', robotsTxt);
  if (llmsTxt) put(tmp, 'llms.txt', llmsTxt);

  /* fichiers statiques */
  fs.mkdirSync(path.join(tmp, 'assets', 'css'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'assets', 'js'), { recursive: true });
  fs.copyFileSync(path.join(STATIC, 'main.css'), path.join(tmp, 'assets', 'css', 'main.css'));
  fs.copyFileSync(path.join(STATIC, 'main.js'), path.join(tmp, 'assets', 'js', 'main.js'));
  fs.cpSync(path.join(STATIC, 'img'), path.join(tmp, 'assets', 'img'), { recursive: true });
  if (fs.existsSync(UPLOADS)) fs.cpSync(UPLOADS, path.join(tmp, 'uploads'), { recursive: true });

  /* fichiers racine (ex. vérification Google Search Console) */
  fs.readdirSync(STATIC).forEach(name => {
    if (/^google[a-z0-9]+\.html$/i.test(name) || name === 'favicon.ico') {
      fs.copyFileSync(path.join(STATIC, name), path.join(tmp, name));
    }
  });

  /* bascule */
  fs.rmSync(old, { recursive: true, force: true });
  if (fs.existsSync(SITE)) fs.renameSync(SITE, old);
  fs.renameSync(tmp, SITE);
  fs.rmSync(old, { recursive: true, force: true });

  return { pages: urls.length, ms: Date.now() - t0, at: new Date().toISOString() };
}

module.exports = { publish, SITE, UPLOADS };

if (require.main === module) console.log(publish());
