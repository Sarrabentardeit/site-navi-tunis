/* Tour complet du back-office sur un serveur déjà lancé.
   Usage : node cms/tools/smoke.js http://127.0.0.1:8080 email password */
const BASE = (process.argv[2] || 'http://127.0.0.1:8080').replace(/\/$/, '');
const EMAIL = process.argv[3];
const PASS = process.argv[4];
if (!EMAIL || !PASS) { console.error('Usage: node cms/tools/smoke.js <url> <email> <password>'); process.exit(1); }

let cookie = '';
const out = [];
const ok = (name, detail) => { out.push({ ok: true, name, detail }); console.log('OK  ', name, detail || ''); };
const fail = (name, detail) => { out.push({ ok: false, name, detail }); console.log('FAIL', name, detail || ''); };

async function api(method, path, body, extra) {
  const headers = { 'X-NV': '1', ...(extra && extra.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  let b;
  if (body !== undefined && !(body instanceof Buffer) && !(body instanceof Uint8Array)) {
    headers['Content-Type'] = 'application/json';
    b = JSON.stringify(body);
  } else if (body !== undefined) b = body;
  const r = await fetch(BASE + path, { method, headers, body: b });
  const set = r.headers.getSetCookie ? r.headers.getSetCookie() : [];
  const raw = r.headers.get('set-cookie');
  if (set && set.length) cookie = set.map(c => c.split(';')[0]).join('; ');
  else if (raw) cookie = raw.split(',').map(c => c.split(';')[0].trim()).filter(Boolean).join('; ');
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  return { status: r.status, data, headers: r.headers };
}

(async () => {
  /* 1. session + login */
  let s = await api('GET', '/api/session');
  if (s.status !== 200) fail('session', s.status); else ok('session', 'needsSetup=' + s.data.needsSetup);
  const login = await api('POST', '/api/login', { email: EMAIL, password: PASS });
  if (login.status !== 200 || !login.data.user) { fail('login', JSON.stringify(login.data)); console.log(JSON.stringify(out, null, 2)); process.exit(1); }
  ok('login', login.data.user.email);

  /* 2. config + status */
  const cfg = await api('GET', '/api/config');
  if (cfg.status === 200 && cfg.data.schema) ok('config', Object.keys(cfg.data.schema || {}).join(',')); else fail('config', cfg.status);
  const st = await api('GET', '/api/status');
  if (st.status === 200) ok('status', JSON.stringify(st.data.counts)); else fail('status', st.status);

  /* 3. home — lire, modifier légèrement, restaurer */
  const home = await api('GET', '/api/home');
  if (home.status !== 200) fail('home get', home.status);
  else {
    const mark = ' [smoke]';
    const copy = JSON.parse(JSON.stringify(home.data));
    const prev = (copy.hero && copy.hero.h1) || '';
    if (copy.hero) copy.hero.h1 = prev.replace(mark, '') + mark;
    const put = await api('PUT', '/api/home', copy);
    if (put.status === 200 && put.data.publish) ok('home save+publish', put.data.publish.pages + ' pages');
    else fail('home save', JSON.stringify(put.data));
    copy.hero.h1 = prev.replace(mark, '');
    await api('PUT', '/api/home', copy);
    ok('home restore');
  }

  /* 4. pages — liste + édition a-propos */
  const pages = await api('GET', '/api/pages');
  if (pages.status === 200 && Array.isArray(pages.data) && pages.data.length) ok('pages list', pages.data.length + ' pages');
  else fail('pages list', pages.status);
  const apropos = await api('GET', '/api/pages/a-propos');
  if (apropos.status === 200) {
    const p = JSON.parse(JSON.stringify(apropos.data));
    const prev = (p.hero && p.hero.lead) || '';
    const mark = ' ·smoke';
    if (p.hero) p.hero.lead = String(prev).replace(mark, '') + mark;
    const put = await api('PUT', '/api/pages/a-propos', p);
    if (put.status === 200) ok('page a-propos save+publish'); else fail('page a-propos', JSON.stringify(put.data));
    if (p.hero) p.hero.lead = String(prev).replace(mark, '');
    await api('PUT', '/api/pages/a-propos', p);
    ok('page a-propos restore');
  } else fail('page a-propos get', apropos.status);

  /* 5. cases */
  const cases = await api('GET', '/api/cases');
  if (cases.status === 200 && Array.isArray(cases.data)) ok('cases list', cases.data.length + ' cas');
  else fail('cases list', cases.status);
  if (cases.data && cases.data[0]) {
    const slug = cases.data[0].slug;
    const one = await api('GET', '/api/cases/' + slug);
    if (one.status === 200) {
      const c = JSON.parse(JSON.stringify(one.data));
      const prev = (c.case && c.case.summary) || '';
      if (c.case) c.case.summary = String(prev).replace(' ·smoke', '') + ' ·smoke';
      const put = await api('PUT', '/api/cases/' + slug, c);
      if (put.status === 200) ok('case save+publish', slug); else fail('case save', JSON.stringify(put.data));
      if (c.case) c.case.summary = String(prev).replace(' ·smoke', '');
      await api('PUT', '/api/cases/' + slug, c);
      ok('case restore', slug);
    }
  }

  /* 6. articles */
  const arts = await api('GET', '/api/articles');
  if (arts.status === 200 && Array.isArray(arts.data)) {
    ok('articles list', arts.data.length + ' articles');
    const list = JSON.parse(JSON.stringify(arts.data));
    const put = await api('PUT', '/api/articles', { articles: list });
    if (put.status === 200) ok('articles reorder/save'); else fail('articles save', JSON.stringify(put.data));
  } else fail('articles list', arts.status);

  /* 7. faq */
  const faq = await api('GET', '/api/faq');
  if (faq.status === 200) {
    const cats = Array.isArray(faq.data) ? faq.data : (faq.data.categories || []);
    const put = await api('PUT', '/api/faq', { categories: cats });
    if (put.status === 200) ok('faq save+publish'); else fail('faq save', JSON.stringify(put.data));
  } else fail('faq get', faq.status);

  /* 8. requests */
  const reqs = await api('GET', '/api/requests');
  if (reqs.status === 200 && Array.isArray(reqs.data)) ok('requests list', reqs.data.length + ' demandes');
  else fail('requests', reqs.status);

  /* 9. media */
  const media = await api('GET', '/api/media');
  if (media.status === 200) ok('media', 'uploads=' + (media.data.uploads || []).length + ' theme=' + (media.data.theme || []).length);
  else fail('media', media.status);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const up = await api('POST', '/api/upload', png, { headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent('smoke-pixel.png') } });
  if (up.status === 200 && up.data.url) {
    ok('upload', up.data.url);
    const name = up.data.name || String(up.data.url || '').replace(/^\/uploads\//, '');
    const del = await api('DELETE', '/api/upload?name=' + encodeURIComponent(name));
    if (del.status === 200) ok('upload delete'); else fail('upload delete', del.status + ' ' + JSON.stringify(del.data));
  } else fail('upload', JSON.stringify(up.data));

  /* 10. settings */
  const settings = await api('GET', '/api/settings');
  if (settings.status === 200) {
    ok('settings get', settings.data.site_name || '');
    const put = await api('PUT', '/api/settings', settings.data);
    if (put.status === 200) ok('settings save+publish'); else fail('settings save', JSON.stringify(put.data));
  } else fail('settings', settings.status);

  /* 11. users */
  const users = await api('GET', '/api/users');
  if (users.status === 200) ok('users list', users.data.length + ' comptes'); else fail('users', users.status);

  /* 12. backup export */
  const exp = await api('GET', '/api/export');
  if (exp.status === 200 && (exp.data.settings || exp.data.pages)) ok('export', 'clés=' + Object.keys(exp.data).join(','));
  else fail('export', exp.status);

  /* 13. publish manuel */
  const pub = await api('POST', '/api/publish', {});
  if (pub.status === 200) ok('publish', pub.data.pages + ' pages / ' + pub.data.ms + 'ms'); else fail('publish', JSON.stringify(pub.data));

  /* 14. pages publiques */
  for (const path of ['/', '/a-propos/', '/services/', '/backoffice/']) {
    const r = await fetch(BASE + path);
    if (r.status === 200) ok('public ' + path); else fail('public ' + path, r.status);
  }

  const bad = out.filter(x => !x.ok);
  console.log('\n——— ' + (out.length - bad.length) + '/' + out.length + ' OK ———');
  if (bad.length) { bad.forEach(b => console.log(' ·', b.name, b.detail)); process.exitCode = 1; }
})().catch(e => { console.error(e); process.exit(1); });
