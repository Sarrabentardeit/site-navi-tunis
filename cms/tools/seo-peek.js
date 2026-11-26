/* Aperçu console de l'audit SEO (lecture seule). Usage : node cms/tools/seo-peek.js */
const seo = require('../lib/seo');
const r = seo.analyze();
console.log('Score', r.score, '(' + r.grade + ')', JSON.stringify(r.counts));
console.log('Catégories', JSON.stringify(Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, v.score]))));
const c = {};
r.issues.forEach(i => { const k = i.code + (i.site ? ' (site)' : ''); c[k] = (c[k] || 0) + 1; });
console.log('Problèmes', c);
r.issues.filter(i => i.code === 'broken_link').slice(0, 14).forEach(i => console.log(' lien', i.site ? 'SITE' : 'page', i.path, '->', i.redirect ? i.redirect.to + ' (' + i.redirect.confidence + '%)' : '—'));
r.issues.filter(i => i.fix).forEach(i => console.log(' fix', i.code, i.path, '=>', i.fix.value, '(' + i.fix.value.length + ')'));
