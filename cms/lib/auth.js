/* Comptes administrateurs et sessions (mots de passe hachés avec scrypt, cookie signé HMAC). */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const TTL = 12 * 3600 * 1000;
const COOKIE = 'nv_sess';

function secret() {
  const f = path.join(store.DATA, 'secret.key');
  try { return fs.readFileSync(f, 'utf8').trim(); } catch (e) { /* première utilisation */ }
  const s = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}
const SECRET = secret();

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64);
  return 'scrypt$' + salt.toString('hex') + '$' + h.toString('hex');
}
function checkPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p[0] !== 'scrypt' || p.length !== 3) { crypto.scryptSync(pw, 'x', 64); return false; }
  const h = crypto.scryptSync(pw, Buffer.from(p[1], 'hex'), 64);
  const b = Buffer.from(p[2], 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

const users = () => store.read('users', []);
const saveUsers = u => store.write('users', u);
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, created: u.created });

function addUser({ name, email, password }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Adresse e-mail invalide.'), { status: 400 });
  if (String(password || '').length < 10) throw Object.assign(new Error('Le mot de passe doit contenir au moins 10 caractères.'), { status: 400 });
  const list = users();
  if (list.some(u => u.email === email)) throw Object.assign(new Error('Un compte existe déjà avec cette adresse.'), { status: 409 });
  const u = { id: crypto.randomBytes(6).toString('hex'), name: String(name || email.split('@')[0]).trim().slice(0, 80), email, hash: hashPassword(password), created: new Date().toISOString() };
  list.push(u); saveUsers(list);
  return u;
}

function updateUser(id, { name, email, password }) {
  const list = users();
  const i = list.findIndex(u => u.id === id);
  if (i < 0) throw Object.assign(new Error('Compte introuvable.'), { status: 404 });
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error('Adresse e-mail invalide.'), { status: 400 });
  if (list.some(u => u.email === email && u.id !== id)) throw Object.assign(new Error('Un compte existe déjà avec cette adresse.'), { status: 409 });
  list[i].name = String(name || email.split('@')[0]).trim().slice(0, 80);
  list[i].email = email;
  if (password != null && String(password) !== '') {
    if (String(password).length < 10) throw Object.assign(new Error('Le mot de passe doit contenir au moins 10 caractères.'), { status: 400 });
    list[i].hash = hashPassword(password);
  }
  saveUsers(list);
  return list[i];
}

function sign(payload) { return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); }
function makeToken(user) {
  const payload = Buffer.from(JSON.stringify({ u: user.id, e: Date.now() + TTL })).toString('base64url');
  return payload + '.' + sign(payload);
}
function parseCookies(req) {
  const o = {};
  String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return o;
}
function userFromReq(req) {
  const t = parseCookies(req)[COOKIE]; if (!t) return null;
  const [payload, sig] = t.split('.'); if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let d; try { d = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (e) { return null; }
  if (!d || d.e < Date.now()) return null;
  return users().find(u => u.id === d.u) || null;
}
const cookieHeader = (token, secure, clear) =>
  COOKIE + '=' + (clear ? '' : encodeURIComponent(token)) + '; HttpOnly; SameSite=Strict; Path=/' + (secure ? '; Secure' : '') + '; Max-Age=' + (clear ? 0 : TTL / 1000);

/* limitation des tentatives de connexion (mémoire) */
const attempts = new Map();
function throttled(key) { const a = attempts.get(key); return !!(a && a.n >= 8 && a.until > Date.now()); }
function fail(key) { const a = attempts.get(key) || { n: 0, until: 0 }; a.n++; a.until = Date.now() + 15 * 60 * 1000; attempts.set(key, a); }
function ok(key) { attempts.delete(key); }

module.exports = { users, saveUsers, publicUser, addUser, updateUser, hashPassword, checkPassword, makeToken, userFromReq, cookieHeader, throttled, fail, ok };
