/* Stockage du contenu : fichiers JSON dans cms/data (écriture atomique + sauvegardes automatiques). */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.NV_DATA || path.join(ROOT, 'data');
const KEEP = 40; // nombre de sauvegardes conservées par fichier

fs.mkdirSync(DATA, { recursive: true });

const file = name => path.join(DATA, name + '.json');

function read(name, def) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch (e) { return def; }
}

/* données techniques (journaux, caches) : inutile de les sauvegarder à chaque écriture */
const NOBACKUP = new Set(['sessions', 'seo-404', 'seo-history', 'seo-audit', 'seo-redirect-log', 'seo-fixes', 'visibility-gsc', 'visibility-ranks']);

function write(name, value, opts) {
  const f = file(name);
  const json = JSON.stringify(value, null, 1);
  try {
    if (fs.existsSync(f) && !NOBACKUP.has(name) && !(opts && opts.backup === false)) {
      const dir = path.join(DATA, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      fs.copyFileSync(f, path.join(dir, name + '.' + stamp + '.json'));
      const olds = fs.readdirSync(dir).filter(x => x.startsWith(name + '.')).sort();
      while (olds.length > KEEP) fs.unlinkSync(path.join(dir, olds.shift()));
    }
  } catch (e) { /* la sauvegarde ne doit jamais bloquer l'enregistrement */ }
  const tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, f);
}

const NAMES = ['settings', 'home', 'pages', 'cases', 'faq', 'articles'];

function all() {
  const o = {};
  NAMES.forEach(n => { o[n] = read(n, n === 'settings' || n === 'home' ? {} : []); });
  o.mocks = read('mocks', {});
  return o;
}

module.exports = { ROOT, DATA, read, write, all, NAMES };
