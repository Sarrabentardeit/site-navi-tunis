/* Compare la structure HTML de cms/site avec la référence statique v4 (sans les attributs variables). */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const main = h => { const i = h.indexOf('<main id="main">'); const j = h.indexOf('</main>'); return h.slice(i, j); };
const norm = h => h.replace(/\s*<br ?\/?>\s*/g, '<br>').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\s(href|src|action|value|data-words|datetime|content)="[^"]*"/g, '').replace(/\s+/g, ' ').replace(/> </g, '><')
  .replace(/&#039;/g, '’').replace(/&#038;/g, '&').replace(/&amp;/g, '&').replace(/&nbsp;|\u00a0/g, ' ')
  .replace(/<div class="hp"[\s\S]*?<\/div>/g, '').replace(/<input type="hidden"[^>]*>/g, '')
  .replace(/<p class="form-err"[^>]*>.*?<\/p>/g, '').replace(/<p class="form-ok" id="nl-ok"[^>]*>.*?<\/p>/g, '').replace(/<p class="form-note" id="nl-err"[^>]*>.*?<\/p>/g, '')
  .replace(/ aria-label="[^"]*"/g, '').replace(/ (hidden|style="display:none")/g, '').trim();
const tokens = h => norm(h).split(/(?=<)|(?<=>)/).filter(Boolean);
const args = process.argv.slice(2);
const list = args.length ? args : ['', 'a-propos', 'services', 'contact', 'devis', 'faq', 'insights', 'integration-optimisation-derp', 'automatisation-des-processus-metiers',
  'developpement-dapplications-web-et-mobiles-sur-mesure', 'integration-de-systemes-structuration-des-donnees', 'accompagnement-operationnel-montee-en-competence-des-equipes',
  'conseil-en-transformation-digitale-optimisation-des-processus', 'notre-demarche-qualite', 'devenir-partenaire-navitrends', 'rejoindre-navitrends',
  'strategie-navitrends-2026-creer-de-la-valeur-durable', 'etudes-de-cas', 'etudes-de-cas/patient-management', 'etudes-de-cas/imc-metrology'];
list.forEach(s => {
  const a = path.join(ROOT, 'cms', 'site', s, 'index.html'), b = path.join(ROOT, 'v4', s, 'index.html');
  if (!fs.existsSync(a) || !fs.existsSync(b)) { console.log((s || '/'), 'fichier manquant', fs.existsSync(a), fs.existsSync(b)); return; }
  const A = tokens(main(fs.readFileSync(a, 'utf8').replace(/\r\n/g, '\n'))), B = tokens(main(fs.readFileSync(b, 'utf8').replace(/\r\n/g, '\n')));
  let i = 0; while (i < A.length && i < B.length && A[i] === B[i]) i++;
  const ok = i === A.length && i === B.length;
  console.log((s || '/').padEnd(62), A.length, B.length, ok ? 'IDENTIQUE' : 'diff @' + i);
  if (!ok) { console.log('   cms :', A.slice(i, i + 4).join(' ').slice(0, 200)); console.log('   v4  :', B.slice(i, i + 4).join(' ').slice(0, 200)); }
});
