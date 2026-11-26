/* Back-office Navitrends — application d'administration (JavaScript natif, sans dépendance). */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var CFG = null, ME = null, STATUS = null;
  var dirty = false;
  var opened = (typeof WeakSet !== 'undefined') ? new WeakSet() : { add: function () {}, has: function () { return false; }, 'delete': function () {} };

  /* ---------- outils ---------- */
  function h(tag, props) {
    var e = document.createElement(tag);
    if (props) Object.keys(props).forEach(function (k) {
      var v = props[k];
      if (v == null || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(parent, c) {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(parent, x); });
    else parent.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function toast(msg, type) {
    var t = h('div', { 'class': 'toast ' + (type || ''), text: msg });
    document.getElementById('toasts').appendChild(t);
    setTimeout(function () { t.remove(); }, type === 'err' ? 7000 : 3500);
  }
  function api(method, path, body, raw) {
    var o = { method: method, headers: { 'X-NV': '1' }, credentials: 'same-origin' };
    if (raw) { o.body = raw.body; Object.keys(raw.headers || {}).forEach(function (k) { o.headers[k] = raw.headers[k]; }); }
    else if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch('/api' + path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== '/login' && path !== '/session') { ME = null; route(); throw new Error(j.error || 'Session expirée.'); }
        if (!r.ok) throw new Error(j.error || 'Erreur ' + r.status);
        return j;
      });
    });
  }
  function guard(fn) { return function () { var a = arguments; return Promise.resolve().then(function () { return fn.apply(null, a); }).catch(function (e) { toast(e.message || 'Erreur', 'err'); }); }; }
  function confirmLeave() { return !dirty || window.confirm('Des modifications ne sont pas enregistrées. Quitter quand même ?'); }
  function setDirty(v) { dirty = v; var d = document.getElementById('dirty'); if (d) d.textContent = v ? '● Modifications non enregistrées' : ''; }
  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  function go(hash) { if (location.hash === '#' + hash) route(); else location.hash = hash; }
  function fmtDate(iso) { try { return new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }
  function toArr(v) { if (Array.isArray(v)) return v; if (v == null || v === '') return []; return String(v).split(/\n/); }
  function obj(o, k) { if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {}; return o[k]; }
  function imgSrc(v) { if (!v) return ''; return /^(https?:)?\/\//.test(v) || v[0] === '/' ? v : '/assets/img/' + v; }
  function summary(item) {
    var v = item.h2 || item.t || item.tab || item.h3 || item.label || item.text || item.n || item.a_h2 || item.lead || item.p || item.name || item.q || '';
    if (Array.isArray(v)) v = v[0] || '';
    if (!v && Array.isArray(item.items)) v = item.items[0] || '';
    v = String(v || '').replace(/\{\{|\}\}|\*\*/g, '');
    return v.length > 70 ? v.slice(0, 68) + '…' : v;
  }

  /* ---------- sélecteur d'images ---------- */
  function mediaModal(onPick) {
    var bg = h('div', { 'class': 'modal-bg' });
    var body = h('div', { 'class': 'body' });
    var close = function () { bg.remove(); };
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    var modal = h('div', { 'class': 'modal' }, h('header', null, h('h2', { text: 'Choisir une image' }), h('button', { 'class': 'btn btn-sm', text: 'Fermer', onclick: close })), body);
    bg.appendChild(modal); document.body.appendChild(bg);
    function load() {
      clear(body); body.appendChild(h('p', { text: 'Chargement…' }));
      api('GET', '/media').then(function (m) {
        clear(body);
        body.appendChild(uploader(function (r) { onPick(r.url); close(); }, 'Déposez une image ici ou cliquez pour en téléverser une (PNG, JPG, WebP, GIF — 8 Mo max.)'));
        body.appendChild(h('h3', { text: 'Mes images téléversées' }));
        var g = h('div', { 'class': 'media-grid' });
        m.uploads.forEach(function (f) { g.appendChild(h('button', { 'class': 'mi', type: 'button', onclick: function () { onPick(f.url); close(); } }, h('span', { 'class': 'im', style: 'background-image:url(' + f.url + ')' }), h('span', { 'class': 'cap', text: f.name }))); });
        body.appendChild(m.uploads.length ? g : h('p', { 'class': 'nv-help', text: 'Aucune image téléversée pour le moment.' }));
        body.appendChild(h('h3', { text: 'Images du site' }));
        var g2 = h('div', { 'class': 'media-grid' });
        m.theme.forEach(function (f) { g2.appendChild(h('button', { 'class': 'mi', type: 'button', onclick: function () { onPick(f.name); close(); } }, h('span', { 'class': 'im', style: 'background-image:url(' + f.url + ')' }), h('span', { 'class': 'cap', text: f.name }))); });
        body.appendChild(g2);
      }).catch(function (e) { toast(e.message, 'err'); });
    }
    load();
  }
  function uploader(done, label) {
    var inp = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif', style: 'display:none' });
    var box = h('div', { 'class': 'drop' }, label || 'Déposez une image ici ou cliquez', inp);
    function send(file) {
      if (!file) return;
      box.firstChild.textContent = 'Envoi de « ' + file.name + ' »…';
      api('POST', '/upload', undefined, { body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) } })
        .then(function (r) { toast('Image ajoutée', 'ok'); done(r); }).catch(function (e) { toast(e.message, 'err'); box.firstChild.textContent = label || 'Déposez une image ici ou cliquez'; });
    }
    box.addEventListener('click', function () { inp.click(); });
    inp.addEventListener('change', function () { send(inp.files[0]); });
    box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('over'); });
    box.addEventListener('dragleave', function () { box.classList.remove('over'); });
    box.addEventListener('drop', function (e) { e.preventDefault(); box.classList.remove('over'); send(e.dataTransfer.files[0]); });
    return box;
  }

  /* ---------- moteur de champs (piloté par les schémas du serveur) ---------- */
  function renderFields(parent, fields, data, onChange) { (fields || []).forEach(function (f) { parent.appendChild(renderField(f, data, onChange)); }); }
  function renderField(f, data, onChange) {
    var t = f.t === 't' ? 'text' : f.t;
    var wrap = h('div', { 'class': 'nv-f nv-t-' + t });
    var inp, lab;
    var help = function () { if (f.h) wrap.appendChild(h('p', { 'class': 'nv-help', text: f.h })); };
    var val = function () { return data[f.k] == null ? '' : data[f.k]; };
    switch (t) {
      case 'text': case 'password': case 'date':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        inp = h('input', { type: t === 'text' ? 'text' : t, placeholder: f.p || '' });
        inp.value = (t === 'password' && val() === '__keep__') ? '' : val();
        if (t === 'password' && val() === '__keep__') inp.placeholder = '(inchangé — saisissez pour le remplacer)';
        inp.addEventListener('input', function () { data[f.k] = (t === 'password' && inp.value === '') ? '__keep__' : inp.value; onChange(); });
        wrap.appendChild(inp); help(); break;
      case 'area':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        inp = h('textarea', { rows: f.rows || 3 }); inp.value = val();
        inp.addEventListener('input', function () { data[f.k] = inp.value; onChange(); });
        wrap.appendChild(inp); help(); break;
      case 'para':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        inp = h('textarea', { rows: f.rows || 5 }); inp.value = toArr(data[f.k]).join('\n\n');
        inp.addEventListener('input', function () { data[f.k] = inp.value.split(/\n\s*\n/).map(function (s) { return s.trim(); }).filter(Boolean); onChange(); });
        wrap.appendChild(inp); help(); break;
      case 'lines':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        inp = h('textarea', { rows: Math.min(10, Math.max(3, toArr(data[f.k]).length + 1)) }); inp.value = toArr(data[f.k]).join('\n');
        inp.addEventListener('input', function () { data[f.k] = inp.value.split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean); onChange(); });
        wrap.appendChild(inp); help(); break;
      case 'check':
        inp = h('input', { type: 'checkbox' }); inp.checked = !!(data[f.k] && data[f.k] !== '0');
        inp.addEventListener('change', function () { data[f.k] = inp.checked ? 1 : 0; onChange(); });
        wrap.appendChild(h('label', { 'class': 'nv-check' }, inp, f.l)); break;
      case 'select':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        inp = h('select');
        Object.keys(f.o || {}).forEach(function (k) { var o = h('option', { text: f.o[k] }); o.value = k; inp.appendChild(o); });
        inp.value = data[f.k] != null && f.o && (data[f.k] in f.o) ? data[f.k] : (f.o ? Object.keys(f.o)[0] : '');
        inp.addEventListener('change', function () { data[f.k] = inp.value; onChange(); });
        wrap.appendChild(inp); help(); break;
      case 'image':
        wrap.appendChild(h('label', { 'class': 'nv-l', text: f.l }));
        var thumb = h('img', { 'class': 'nv-thumb', alt: '' });
        inp = h('input', { type: 'text', placeholder: 'Adresse de l’image ou bouton « Choisir »' }); inp.value = data[f.k] || '';
        var show = function () { var s = imgSrc(inp.value); if (s) { thumb.src = s; thumb.style.display = ''; } else thumb.style.display = 'none'; };
        inp.addEventListener('input', function () { data[f.k] = inp.value; show(); onChange(); });
        wrap.appendChild(h('div', { 'class': 'nv-img' }, thumb, inp, h('button', { 'class': 'btn btn-sm', type: 'button', text: 'Choisir…', onclick: function () { mediaModal(function (u) { inp.value = u; data[f.k] = u; show(); onChange(); }); } })));
        show(); help(); break;
      case 'group':
        var det = h('details', { 'class': 'nv-group' }, h('summary', { text: f.l }));
        var inner = h('div', { 'class': 'nv-group-in' });
        renderFields(inner, f.f, obj(data, f.k), onChange);
        det.appendChild(inner); wrap.appendChild(det); break;
      case 'rows': wrap.appendChild(renderList(f, data, onChange, false)); break;
      case 'variants': wrap.appendChild(renderList(f, data, onChange, true)); break;
    }
    return wrap;
  }
  function renderList(f, data, onChange, isVariants) {
    if (!Array.isArray(data[f.k])) data[f.k] = [];
    var arr = data[f.k], disc = f.vk || 'type';
    var box = h('div', { 'class': 'nv-rows' }, h('div', { 'class': 'nv-l nv-rows-title', text: f.l }));
    var list = h('div', { 'class': 'nv-rows-list' }); box.appendChild(list);
    var fieldsOf = function (item) { return isVariants ? ((f.v[item[disc]] || {}).f || []) : f.f; };
    var labelOf = function (item) { return isVariants ? ((f.v[item[disc]] || {}).l || item[disc]) : ''; };
    var titleOf = function (item, i) {
      var s = isVariants ? summary(item) : (f.tk && item[f.tk] ? summary({ t: Array.isArray(item[f.tk]) ? item[f.tk][0] : item[f.tk] }) : summary(item));
      return s || (isVariants ? '' : 'Élément ' + (i + 1));
    };
    function draw() {
      clear(list);
      arr.forEach(function (item, i) {
        var card = h('div', { 'class': 'nv-row' + (opened.has(item) ? ' open' : '') });
        var title = h('span', { 'class': 'nv-row-title', text: titleOf(item, i) });
        var tog = h('button', { 'class': 'nv-row-toggle', type: 'button', onclick: function () { if (opened.has(item)) opened['delete'](item); else opened.add(item); card.classList.toggle('open'); } },
          h('span', { 'class': 'nv-row-n', text: String(i + 1) }), isVariants ? h('span', { 'class': 'nv-row-kind', text: labelOf(item) }) : null, title);
        var mk = function (t, ttl, fn) { return h('button', { 'class': 'nv-ic', type: 'button', title: ttl, text: t, onclick: function (e) { e.stopPropagation(); fn(); } }); };
        var head = h('div', { 'class': 'nv-row-head' }, tog,
          mk('↑', 'Monter', function () { if (i > 0) { arr.splice(i - 1, 0, arr.splice(i, 1)[0]); draw(); onChange(); } }),
          mk('↓', 'Descendre', function () { if (i < arr.length - 1) { arr.splice(i + 1, 0, arr.splice(i, 1)[0]); draw(); onChange(); } }),
          mk('⧉', 'Dupliquer', function () { var c = JSON.parse(JSON.stringify(item)); arr.splice(i + 1, 0, c); opened.add(c); draw(); onChange(); }),
          mk('✕', 'Supprimer', function () { if (window.confirm('Supprimer cet élément ?')) { arr.splice(i, 1); draw(); onChange(); } }));
        var body = h('div', { 'class': 'nv-row-body' });
        renderFields(body, fieldsOf(item), item, function () { title.textContent = titleOf(item, i); onChange(); });
        card.appendChild(head); card.appendChild(body); list.appendChild(card);
      });
      if (!arr.length) list.appendChild(h('p', { 'class': 'nv-empty', text: 'Aucun élément pour le moment.' }));
    }
    draw();
    var addBox = h('div', { 'class': 'nv-add' }), sel = null;
    if (isVariants) { sel = h('select'); Object.keys(f.v || {}).forEach(function (k) { var o = h('option', { text: f.v[k].l }); o.value = k; sel.appendChild(o); }); addBox.appendChild(sel); }
    addBox.appendChild(h('button', { 'class': 'btn btn-sm', type: 'button', text: '+ ' + (f.add || 'Ajouter'), onclick: function () {
      var item = {}; if (isVariants) item[disc] = sel.value; arr.push(item); opened.add(item); draw(); onChange();
    } }));
    box.appendChild(addBox);
    return box;
  }
  function panel(title, open) {
    var d = h('details', { 'class': 'nv-panel' }, h('summary', { text: title })); if (open) d.open = true;
    var inner = h('div', { 'class': 'nv-panel-in' }); d.appendChild(inner);
    return { root: d, body: inner };
  }
  var field = function (k, t, l, x) { var o = { k: k, t: t, l: l }; if (x) Object.keys(x).forEach(function (y) { o[y] = x[y]; }); return o; };

  /* ---------- gabarit général ---------- */
  var NAV = [
    ['/', 'Tableau de bord', '⌂'], ['grp', 'Contenu'], ['/home', 'Page d’accueil', '★'], ['/pages', 'Pages et services', '☰'], ['/cases', 'Études de cas', '◎'],
    ['/articles', 'Articles (Insights)', '✎'], ['/faq', 'FAQ', '?'], ['grp', 'Échanges'], ['/requests', 'Demandes reçues', '✉'], ['/media', 'Images', '▣'],
    ['grp', 'Référencement'], ['/seo', 'SEO', '◈'], ['/geo', 'GEO', '✦'], ['/visibility', 'Visibilité', '◉'],
    ['grp', 'Administration'], ['/settings', 'Réglages du site', '⚙'], ['/users', 'Comptes', '☺'], ['/backup', 'Sauvegarde', '⤓']
  ];
  function layout(path, title, actions, content) {
    clear(app);
    var side = h('aside', { 'class': 'side' });
    side.appendChild(h('div', { 'class': 'brand' }, h('img', { src: '/assets/img/logo.png', alt: 'Navitrends' }), h('b', { text: 'Back-office' })));
    var nav = h('nav');
    NAV.forEach(function (n) {
      if (n[0] === 'grp') { nav.appendChild(h('div', { 'class': 'grp', text: n[1] })); return; }
      var on = n[0] === '/' ? path === '/' : (path === n[0] || path.indexOf(n[0] + '/') === 0);
      var a = h('a', { href: '#' + n[0], 'class': on ? 'on' : '', onclick: function (e) { if (!confirmLeave()) e.preventDefault(); else { setDirty(false); side.classList.remove('open'); } } }, h('span', { 'class': 'ic', text: n[2] }), n[1]);
      if (n[0] === '/requests' && STATUS && STATUS.unread) a.appendChild(h('span', { 'class': 'badge', text: String(STATUS.unread) }));
      nav.appendChild(a);
    });
    side.appendChild(nav);
    side.appendChild(h('div', { 'class': 'foot' },
      h('div', { 'class': 'me', text: ME.name + ' · ' + ME.email }),
      h('a', { 'class': 'btn btn-sm', href: '/', target: '_blank', rel: 'noopener', text: 'Voir le site ↗' }),
      h('button', { 'class': 'btn btn-sm btn-gold', text: 'Publier le site', onclick: guard(function () { return api('POST', '/publish', {}).then(function (r) { toast('Site publié (' + r.pages + ' pages)', 'ok'); }); }) }),
      h('button', { 'class': 'btn btn-sm', text: 'Se déconnecter', onclick: function () { if (!confirmLeave()) return; setDirty(false); api('POST', '/logout', {}).then(function () { ME = null; route(); }); } })));
    var top = h('div', { 'class': 'top' }, h('button', { 'class': 'btn btn-sm menu-btn', text: '☰', onclick: function () { side.classList.toggle('open'); } }), h('h1', { text: title }), h('span', { 'class': 'dirty', id: 'dirty' }), h('div', { 'class': 'acts' }, actions));
    app.appendChild(h('div', { 'class': 'shell' }, side, h('div', { 'class': 'main' }, top, h('div', { 'class': 'content' }, content))));
    window.scrollTo(0, 0);
  }
  function saveButton(fn, label) {
    var b = h('button', { 'class': 'btn btn-primary', text: label || 'Enregistrer et publier' });
    b.addEventListener('click', function () { b.disabled = true; Promise.resolve().then(fn).then(function () { setDirty(false); }).catch(function (e) { toast(e.message || 'Erreur', 'err'); }).then(function () { b.disabled = false; }); });
    return b;
  }

  /* ---------- écrans ---------- */
  function screenLogin(needsSetup) {
    clear(app);
    var email = h('input', { type: 'email', 'class': 'in', autocomplete: 'username', required: true, placeholder: 'vous@navitrends.com' });
    var pw = h('input', { type: 'password', 'class': 'in', autocomplete: needsSetup ? 'new-password' : 'current-password', required: true, placeholder: needsSetup ? '10 caractères minimum' : '••••••••••' });
    var name = h('input', { type: 'text', 'class': 'in', autocomplete: 'name', placeholder: 'Prénom Nom' });
    var err = h('p', { 'class': 'err' });
    var form = h('form', { 'class': 'auth-form', onsubmit: function (e) {
      e.preventDefault(); err.textContent = '';
      api('POST', needsSetup ? '/setup' : '/login', { email: email.value, password: pw.value, name: name.value }).then(function (r) { ME = r.user; route(); }).catch(function (x) { err.textContent = x.message; });
    } },
      h('div', { 'class': 'auth-kicker', text: needsSetup ? 'Première installation' : 'Espace administrateur' }),
      h('h1', { text: needsSetup ? 'Créer votre compte' : 'Connexion' }),
      h('p', { 'class': 'sub', text: needsSetup ? 'Un seul compte suffit pour commencer. Vous pourrez en ajouter d’autres ensuite.' : 'Accédez à la gestion du contenu, des demandes et des réglages du site.' }),
      needsSetup ? h('div', { 'class': 'f' }, h('label', { 'class': 'nv-l', text: 'Nom affiché' }), name) : null,
      h('div', { 'class': 'f' }, h('label', { 'class': 'nv-l', text: 'Adresse e-mail' }), email),
      h('div', { 'class': 'f' }, h('label', { 'class': 'nv-l', text: 'Mot de passe' }), pw),
      err,
      h('button', { 'class': 'btn btn-primary auth-submit', type: 'submit', text: needsSetup ? 'Créer le compte et entrer' : 'Se connecter' }),
      h('p', { 'class': 'auth-foot', text: 'Après connexion, chaque enregistrement publie le site automatiquement.' }));
    var panel = h('aside', { 'class': 'auth-panel' },
      h('img', { src: '/assets/img/logo.png', alt: 'Navitrends', 'class': 'auth-logo' }),
      h('p', { 'class': 'auth-brand', text: 'Back-office' }),
      h('h2', { text: 'Gérez tout le site depuis un seul endroit' }),
      h('ul', { 'class': 'auth-list' },
        h('li', { text: 'Pages, services et page d’accueil' }),
        h('li', { text: 'Études de cas, articles et FAQ' }),
        h('li', { text: 'Demandes (contact, devis, newsletter)' }),
        h('li', { text: 'Images, réglages et sauvegarde' })),
      h('a', { 'class': 'auth-site', href: '/', target: '_blank', rel: 'noopener', text: 'Voir le site public ↗' }));
    app.appendChild(h('div', { 'class': 'auth' }, h('div', { 'class': 'auth-shell' }, panel, h('div', { 'class': 'auth-card' }, form))));
    (needsSetup ? name : email).focus();
  }

  function screenDashboard() {
    var st = STATUS;
    var el = h('div', { 'class': 'dash' });
    if (st.unsent) el.appendChild(h('div', { 'class': 'note bad', text: st.unsent + ' demande(s) n’ont pas pu être envoyées par e-mail. Elles restent dans « Demandes reçues ».' }));
    var warn = h('div');
    api('GET', '/settings').then(function (s) {
      if (!s.smtp_host) warn.appendChild(h('div', { 'class': 'note warn' }, 'Envoi d’e-mails non configuré. Les demandes sont enregistrées ici, mais aucun e-mail n’est envoyé. ', h('a', { href: '#/settings', text: 'Configurer →' })));
    });
    el.appendChild(warn);
    el.appendChild(h('section', { 'class': 'dash-sec' },
      h('div', { 'class': 'dash-h' }, h('h2', { text: 'Vue d’ensemble' }), h('p', { text: st.lastPublish ? 'Dernière publication : ' + fmtDate(st.lastPublish.at) + ' · ' + st.lastPublish.pages + ' pages' : 'Site prêt à être publié' })),
      h('div', { 'class': 'grid g4' },
        stat('#/pages', st.counts.pages, 'Pages et services'),
        stat('#/cases', st.counts.cases, 'Études de cas'),
        stat('#/articles', st.counts.articles, 'Articles'),
        stat('#/requests', st.unread, 'Demandes non lues', st.requests + ' au total'))));
    el.appendChild(h('section', { 'class': 'dash-sec' },
      h('div', { 'class': 'dash-h' }, h('h2', { text: 'Modifier le contenu' }), h('p', { text: 'Chaque enregistrement met le site à jour tout de suite.' })),
      h('div', { 'class': 'grid g3' },
        quick('#/seo', '◈', 'SEO', 'Titres, 404, redirections, rapport'),
        quick('#/geo', '✦', 'GEO', 'Présentation claire et résumé du site'),
        quick('#/visibility', '◉', 'Visibilité', 'GSC, positions, mots-clés, rapport'),
        quick('#/home', '★', 'Page d’accueil', 'Bandeau, chiffres, boutons, blocs'),
        quick('#/pages', '☰', 'Pages et services', 'Créer, modifier, SEO, ordre'),
        quick('#/cases', '◎', 'Études de cas', 'Réalisations clients'),
        quick('#/articles', '✎', 'Articles (Insights)', 'Pages internes ou liens externes'),
        quick('#/faq', '?', 'FAQ', 'Questions et réponses'),
        quick('#/media', '▣', 'Images', 'Téléverser et réutiliser'))));
    el.appendChild(h('section', { 'class': 'dash-sec' },
      h('div', { 'class': 'dash-h' }, h('h2', { text: 'Échanges et administration' }), h('p', { text: 'Messages reçus, comptes et sauvegarde.' })),
      h('div', { 'class': 'grid g3' },
        quick('#/requests', '✉', 'Demandes reçues', (st.unread ? st.unread + ' non lue(s) · ' : '') + 'Contact, devis, newsletter'),
        quick('#/settings', '⚙', 'Réglages du site', 'Coordonnées, SMTP, pied de page'),
        quick('#/backup', '⤓', 'Sauvegarde', 'Exporter ou restaurer tout le contenu'))));
    return { title: 'Tableau de bord', el: el };
  }
  function stat(href, n, label, sub) {
    var a = h('a', { 'class': 'stat', href: href }, h('b', { text: String(n) }), h('span', { text: label }));
    if (sub) a.appendChild(h('small', { text: sub }));
    return a;
  }
  function quick(href, ic, title, desc) {
    return h('a', { 'class': 'quick', href: href },
      h('span', { 'class': 'quick-ic', text: ic }),
      h('span', { 'class': 'quick-t', text: title }),
      h('span', { 'class': 'quick-d', text: desc }));
  }

  function screenHome() {
    return api('GET', '/home').then(function (data) {
      var el = h('div');
      el.appendChild(h('p', { 'class': 'hint', text: 'Les cartes de services, les réalisations et les articles se mettent à jour automatiquement depuis les « Pages et services », les « Études de cas » et les « Articles ».' }));
      renderFields(el, CFG.schema.home, data, function () { setDirty(true); });
      return { title: 'Page d’accueil', el: el, actions: [h('a', { 'class': 'btn', href: '/', target: '_blank', rel: 'noopener', text: 'Voir ↗' }), saveButton(function () { return api('PUT', '/home', data).then(function () { toast('Accueil enregistré et publié', 'ok'); }); })] };
    });
  }

  function screenPages() {
    var filter = 'all';
    return api('GET', '/pages').then(function (list) {
      var el = h('div'), holder = h('div');
      function draw() {
        clear(holder);
        var vis = list.filter(function (p) { return filter === 'all' ? true : filter === 'service' ? p.tpl === 'service' : p.tpl !== 'service'; });
        if (!vis.length) { holder.appendChild(h('div', { 'class': 'empty', text: 'Aucune page.' })); return; }
        var tb = h('tbody');
        vis.forEach(function (p, i) {
          var move = function (d) {
            var all = list.slice().sort(function (a, b) { return a.order - b.order; });
            var idxs = []; all.forEach(function (x, k) { if (vis.indexOf(x) >= 0) idxs.push(k); });
            var vi = vis.indexOf(p), a = idxs[vi], b = idxs[vi + d]; if (b == null) return;
            var tmp = all[a]; all[a] = all[b]; all[b] = tmp;
            api('POST', '/order/pages', { slugs: all.map(function (x) { return x.slug; }) }).then(function () { return api('GET', '/pages'); }).then(function (l) { list = l; draw(); toast('Ordre enregistré', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
          };
          tb.appendChild(h('tr', null,
            h('td', null, h('a', { 'class': 't', href: '#/pages/edit/' + p.slug, text: p.title })),
            h('td', { 'class': 'hide-s' }, h('code', { text: '/' + p.slug + '/' })),
            h('td', null, h('span', { 'class': 'pill', text: (CFG.types[p.tpl] || p.tpl).split(' (')[0] })),
            h('td', null, h('span', { 'class': 'pill ' + (p.status === 'draft' ? 'gray' : 'green'), text: p.status === 'draft' ? 'Brouillon' : 'Publiée' })),
            h('td', { 'class': 'act' },
              h('button', { 'class': 'btn btn-sm', title: 'Monter', text: '↑', disabled: i === 0, onclick: function () { move(-1); } }), ' ',
              h('button', { 'class': 'btn btn-sm', title: 'Descendre', text: '↓', disabled: i === vis.length - 1, onclick: function () { move(1); } }), ' ',
              h('a', { 'class': 'btn btn-sm', href: '/' + p.slug + '/', target: '_blank', rel: 'noopener', text: 'Voir' }), ' ',
              h('a', { 'class': 'btn btn-sm btn-primary', href: '#/pages/edit/' + p.slug, text: 'Modifier' }), ' ',
              h('button', { 'class': 'btn btn-sm btn-danger', text: 'Supprimer', onclick: function () {
                if (!window.confirm('Supprimer définitivement la page « ' + p.title + ' » ? Son adresse ne fonctionnera plus.')) return;
                api('DELETE', '/pages/' + p.slug).then(function () { list = list.filter(function (x) { return x.slug !== p.slug; }); draw(); toast('Page supprimée', 'ok'); }).catch(function (e) { toast(e.message, 'err'); });
              } }))));
        });
        holder.appendChild(h('table', { 'class': 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Titre' }), h('th', { 'class': 'hide-s', text: 'Adresse' }), h('th', { text: 'Type' }), h('th', { text: 'État' }), h('th'))), tb));
      }
      var tabs = h('div', { 'class': 'tabs2' });
      [['all', 'Toutes'], ['service', 'Services'], ['other', 'Autres pages']].forEach(function (t) {
        tabs.appendChild(h('button', { text: t[1], 'class': filter === t[0] ? 'on' : '', onclick: function () { filter = t[0]; Array.prototype.forEach.call(tabs.children, function (b) { b.classList.remove('on'); }); this.classList.add('on'); draw(); } }));
      });
      tabs.firstChild.classList.add('on');
      el.appendChild(tabs); el.appendChild(holder); draw();
      return { title: 'Pages et services', el: el, actions: [h('a', { 'class': 'btn btn-primary', href: '#/pages/new', text: '+ Nouvelle page' })] };
    });
  }

  function seoPanel(root, data, label) {
    var p = panel('Référencement Google (SEO)', false);
    root.appendChild(p.root);
    var seo = obj(data, 'seo');
    var titleI = h('input', { type: 'text', value: seo.title || '', placeholder: 'Titre affiché dans Google' });
    var descI = h('textarea', { rows: '3', placeholder: 'Résumé accrocheur pour Google (~155 caractères)' });
    descI.value = seo.desc || '';
    var titleMeta = h('p', { 'class': 'nv-help seo-count' });
    var descMeta = h('p', { 'class': 'nv-help seo-count' });
    function refreshCounts() {
      var tl = (seo.title || '').trim().length;
      var dl = (seo.desc || '').trim().length;
      titleMeta.textContent = tl + ' caractère' + (tl === 1 ? '' : 's') + ' · idéal 50–60' + (tl > 60 ? ' · trop long' : tl && tl < 30 ? ' · un peu court' : tl ? ' · OK' : ' · vide = titre de page + marque');
      titleMeta.className = 'nv-help seo-count' + (tl > 60 ? ' bad' : tl && tl >= 30 && tl <= 60 ? ' ok' : '');
      descMeta.textContent = dl + ' caractère' + (dl === 1 ? '' : 's') + ' · idéal 140–160' + (dl > 160 ? ' · trop long' : dl && dl < 70 ? ' · un peu court' : dl ? ' · OK' : ' · recommandé');
      descMeta.className = 'nv-help seo-count' + (dl > 160 ? ' bad' : dl && dl >= 70 && dl <= 160 ? ' ok' : '');
    }
    titleI.addEventListener('input', function () { seo.title = titleI.value; setDirty(true); refreshCounts(); });
    descI.addEventListener('input', function () { seo.desc = descI.value; setDirty(true); refreshCounts(); });
    refreshCounts();
    p.body.appendChild(h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: 'Titre pour Google' + (label || '') }), titleI, titleMeta));
    p.body.appendChild(h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: 'Description pour Google' }), descI, descMeta));
    p.body.appendChild(h('p', { 'class': 'nv-help', text: 'Astuce : menu « SEO Intelligence » pour auditer tout le site.' }));
  }
  function sectionsPanel(root, data) {
    var p = panel('Sections de la page', true);
    renderFields(p.body, [{ k: 'sections', t: 'variants', l: 'Sections (dans l’ordre d’affichage)', vk: 'type', v: CFG.schema.sections, add: 'Ajouter une section' }], data, function () { setDirty(true); });
    root.appendChild(p.root);
  }

  function screenPageEdit(slug) {
    var isNew = !slug;
    var load = isNew ? Promise.resolve({ title: '', slug: '', tpl: 'default', menu: '', status: 'publish', order: 500, hero: { theme: 'blue', actions: 1 }, service: {}, extra: {}, sections: [], seo: {} }) : api('GET', '/pages/' + slug);
    return load.then(function (data) {
      ['hero', 'service', 'extra', 'seo'].forEach(function (k) { if (!data[k] || Array.isArray(data[k])) data[k] = {}; });
      if (!Array.isArray(data.sections)) data.sections = [];
      var oldSlug = isNew ? null : data.slug;
      var el = h('div'), body = h('div');
      var dirtyFn = function () { setDirty(true); };
      var ident = panel('Identité de la page', true);
      renderFields(ident.body, [field('title', 't', 'Titre de la page', { h: 'Utilisé dans le menu, le fil d’Ariane et Google.' }), field('slug', 't', 'Adresse (fin de l’URL)', { h: 'Ex. : mon-offre → /mon-offre/. Lettres minuscules, chiffres et tirets. Changer l’adresse d’une page existante casse les anciens liens et le référencement.', p: isNew ? 'laisser vide = automatique' : '' }),
        field('status', 'select', 'État', { o: { publish: 'Publiée (visible sur le site)', draft: 'Brouillon (non publiée)' } })], data, dirtyFn);
      var typeBox = h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: 'Type de page' }));
      var sel = h('select');
      Object.keys(CFG.types).forEach(function (k) { var o = h('option', { text: CFG.types[k] }); o.value = k; sel.appendChild(o); });
      sel.value = data.tpl || 'default';
      sel.addEventListener('change', function () {
        data.tpl = sel.value;
        var def = CFG.extraDefaults[data.tpl];
        if (def && !Array.isArray(def)) Object.keys(def).forEach(function (k) { if (data.extra[k] == null || data.extra[k] === '') data.extra[k] = JSON.parse(JSON.stringify(def[k])); });
        setDirty(true); drawBody();
      });
      typeBox.appendChild(sel);
      ident.body.appendChild(typeBox);
      var cb = h('input', { type: 'checkbox' }); cb.checked = data.menu === 'about';
      cb.addEventListener('change', function () { data.menu = cb.checked ? 'about' : ''; setDirty(true); });
      ident.body.appendChild(h('label', { 'class': 'nv-check' }, cb, 'Afficher dans le sous-menu « A Propos » et dans le pied de page'));
      el.appendChild(ident.root); el.appendChild(body);
      function drawBody() {
        clear(body);
        var p1 = panel('Bandeau du haut', true); renderFields(p1.body, CFG.schema.hero, data.hero, dirtyFn); body.appendChild(p1.root);
        if (data.tpl === 'service') { var p2 = panel('Carte du service (menu, accueil, liste des services)', false); renderFields(p2.body, CFG.schema.service, data.service, dirtyFn); body.appendChild(p2.root); }
        var ex = CFG.schema.extra[data.tpl];
        if (ex && ex.length) { var p3 = panel('Textes du formulaire et de la page', false); renderFields(p3.body, ex, data.extra, dirtyFn); body.appendChild(p3.root); }
        if (data.tpl === 'hub') body.appendChild(h('div', { 'class': 'note good', text: 'Les cartes de cette page sont créées automatiquement à partir de vos pages de type « Page service ».' }));
        if (data.tpl === 'faq') body.appendChild(h('div', { 'class': 'note good' }, 'Les questions s’éditent dans ', h('a', { href: '#/faq', text: 'FAQ' }), '.'));
        if (data.tpl === 'insights') body.appendChild(h('div', { 'class': 'note good' }, 'La liste des articles s’édite dans ', h('a', { href: '#/articles', text: 'Articles (Insights)' }), '.'));
        sectionsPanel(body, data); seoPanel(body, data);
      }
      drawBody();
      var save = saveButton(function () {
        if (isNew) return api('POST', '/pages', data).then(function (r) { toast('Page créée et publiée', 'ok'); setDirty(false); location.hash = '#/pages/edit/' + r.slug; });
        return api('PUT', '/pages/' + oldSlug, data).then(function (r) { oldSlug = r.slug; data.slug = r.slug; toast('Page enregistrée et publiée', 'ok'); if (r.slug !== slug) { setDirty(false); location.hash = '#/pages/edit/' + r.slug; } });
      });
      return { title: isNew ? 'Nouvelle page' : data.title, el: el, actions: [h('a', { 'class': 'btn', href: '#/pages', text: '← Liste' }), isNew ? null : h('a', { 'class': 'btn', href: '/' + data.slug + '/', target: '_blank', rel: 'noopener', text: 'Voir ↗' }), save] };
    });
  }

  function screenCases() {
    return api('GET', '/cases').then(function (list) {
      list.sort(function (a, b) { return a.order - b.order; });
      var el = h('div');
      if (!list.length) el.appendChild(h('div', { 'class': 'empty', text: 'Aucune étude de cas.' }));
      else {
        var tb = h('tbody');
        list.forEach(function (c, i) {
          var move = function (d) {
            var a = list.slice(); var j = i + d; if (j < 0 || j >= a.length) return; var t = a[i]; a[i] = a[j]; a[j] = t;
            api('POST', '/order/cases', { slugs: a.map(function (x) { return x.slug; }) }).then(function () { toast('Ordre enregistré', 'ok'); route(); }).catch(function (e) { toast(e.message, 'err'); });
          };
          tb.appendChild(h('tr', null,
            h('td', null, h('a', { 'class': 't', href: '#/cases/edit/' + c.slug, text: c.title })),
            h('td', { 'class': 'hide-s', text: c.client || '' }), h('td', null, h('span', { 'class': 'pill', text: c.group || '—' })),
            h('td', null, h('span', { 'class': 'pill ' + (c.status === 'draft' ? 'gray' : 'green'), text: c.status === 'draft' ? 'Brouillon' : 'Publiée' })),
            h('td', { 'class': 'act' },
              h('button', { 'class': 'btn btn-sm', text: '↑', disabled: i === 0, onclick: function () { move(-1); } }), ' ',
              h('button', { 'class': 'btn btn-sm', text: '↓', disabled: i === list.length - 1, onclick: function () { move(1); } }), ' ',
              h('a', { 'class': 'btn btn-sm', href: '/etudes-de-cas/' + c.slug + '/', target: '_blank', rel: 'noopener', text: 'Voir' }), ' ',
              h('a', { 'class': 'btn btn-sm btn-primary', href: '#/cases/edit/' + c.slug, text: 'Modifier' }), ' ',
              h('button', { 'class': 'btn btn-sm btn-danger', text: 'Supprimer', onclick: function () { if (!window.confirm('Supprimer l’étude de cas « ' + c.title + ' » ?')) return; api('DELETE', '/cases/' + c.slug).then(function () { toast('Étude de cas supprimée', 'ok'); route(); }).catch(function (e) { toast(e.message, 'err'); }); } }))));
        });
        el.appendChild(h('table', { 'class': 'tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Titre' }), h('th', { 'class': 'hide-s', text: 'Client' }), h('th', { text: 'Groupe' }), h('th', { text: 'État' }), h('th'))), tb));
      }
      return { title: 'Études de cas', el: el, actions: [h('a', { 'class': 'btn btn-primary', href: '#/cases/new', text: '+ Nouvelle étude de cas' })] };
    });
  }

  function screenCaseEdit(slug) {
    var isNew = !slug;
    var load = isNew ? Promise.resolve({ title: '', slug: '', status: 'publish', order: 500, 'case': { theme: 'blue', group: '' }, sections: [], seo: {} }) : api('GET', '/cases/' + slug);
    return load.then(function (data) {
      ['case', 'seo'].forEach(function (k) { if (!data[k] || Array.isArray(data[k])) data[k] = {}; });
      if (!Array.isArray(data.sections)) data.sections = [];
      var oldSlug = isNew ? null : data.slug, el = h('div'), dirtyFn = function () { setDirty(true); };
      var p0 = panel('Identité', true);
      renderFields(p0.body, [field('title', 't', 'Titre de l’étude de cas'), field('slug', 't', 'Adresse (fin de l’URL)', { h: 'Ex. : mon-client → /etudes-de-cas/mon-client/', p: isNew ? 'laisser vide = automatique' : '' }), field('status', 'select', 'État', { o: { publish: 'Publiée', draft: 'Brouillon (non publiée)' } })], data, dirtyFn);
      el.appendChild(p0.root);
      var p1 = panel('Fiche de l’étude de cas', true); renderFields(p1.body, CFG.schema['case'], data['case'], dirtyFn); el.appendChild(p1.root);
      sectionsPanel(el, data); seoPanel(el, data);
      var save = saveButton(function () {
        if (isNew) return api('POST', '/cases', data).then(function (r) { toast('Étude de cas créée et publiée', 'ok'); setDirty(false); location.hash = '#/cases/edit/' + r.slug; });
        return api('PUT', '/cases/' + oldSlug, data).then(function (r) { oldSlug = r.slug; toast('Étude de cas enregistrée et publiée', 'ok'); if (r.slug !== slug) { setDirty(false); location.hash = '#/cases/edit/' + r.slug; } });
      });
      return { title: isNew ? 'Nouvelle étude de cas' : data.title, el: el, actions: [h('a', { 'class': 'btn', href: '#/cases', text: '← Liste' }), isNew ? null : h('a', { 'class': 'btn', href: '/etudes-de-cas/' + data.slug + '/', target: '_blank', rel: 'noopener', text: 'Voir ↗' }), save] };
    });
  }

  function screenArticles() {
    return api('GET', '/articles').then(function (list) {
      var el = h('div'), holder = h('div');
      var persist = function (msg) { return api('PUT', '/articles', { articles: list }).then(function () { toast(msg || 'Enregistré et publié', 'ok'); }); };
      function edit(a, isNew) {
        var copy = JSON.parse(JSON.stringify(a));
        var bg = h('div', { 'class': 'modal-bg' }), body = h('div', { 'class': 'body' });
        var closeIt = function () { bg.remove(); };
        renderFields(body, [
          field('title', 't', 'Titre de l’article'), field('date', 'date', 'Date de publication'), field('img', 'image', 'Image de couverture'), field('cat', 't', 'Catégorie affichée (facultatif)'),
          field('url', 't', 'Lien vers l’article (adresse complète)', { h: 'Pour un article hébergé ailleurs (ex. navitrends.com). Laissez vide si vous rédigez le texte ci-dessous.' }),
          field('body', 'area', 'Texte de l’article (une ligne vide sépare les paragraphes)', { rows: 12, h: 'Si ce champ est rempli, une page est créée sur le site pour cet article.' }),
          field('slug', 't', 'Adresse de la page (si texte rédigé)', { h: 'Vide = générée à partir du titre.' }),
          field('status', 'select', 'État', { o: { publish: 'Publié', draft: 'Brouillon (masqué)' } })
        ], copy, function () {});
        var errBox = h('p', { 'class': 'err' });
        var save = h('button', { 'class': 'btn btn-primary', text: 'Valider', onclick: function () {
          if (!String(copy.title || '').trim()) { errBox.textContent = 'Le titre est obligatoire.'; return; }
          var prev = list.slice(); if (isNew) list.unshift(copy); else list[list.indexOf(a)] = copy;
          persist().then(function () { closeIt(); draw(); }).catch(function (e) { list = prev; errBox.textContent = e.message; });
        } });
        bg.appendChild(h('div', { 'class': 'modal' }, h('header', null, h('h2', { text: isNew ? 'Nouvel article' : 'Modifier l’article' }), h('button', { 'class': 'btn btn-sm', text: 'Annuler', onclick: closeIt })), body, h('div', { 'class': 'body', style: 'border-top:1px solid var(--line)' }, errBox, save)));
        document.body.appendChild(bg);
      }
      function draw() {
        clear(holder);
        if (!list.length) { holder.appendChild(h('div', { 'class': 'empty', text: 'Aucun article.' })); return; }
        var tb = h('tbody');
        list.forEach(function (a, i) {
          var move = function (d) { var j = i + d; if (j < 0 || j >= list.length) return; var t = list[i]; list[i] = list[j]; list[j] = t; persist('Ordre enregistré').then(draw).catch(function (e) { toast(e.message, 'err'); }); };
          tb.appendChild(h('tr', null,
            h('td', null, a.img ? h('img', { src: imgSrc(a.img), alt: '', style: 'width:64px;height:42px;object-fit:cover;border-radius:6px;display:block' }) : ''),
            h('td', null, h('a', { 'class': 't', href: '#', text: a.title, onclick: function (e) { e.preventDefault(); edit(a, false); } })),
            h('td', { 'class': 'hide-s', text: a.date }),
            h('td', null, h('span', { 'class': 'pill ' + (a.status === 'draft' ? 'gray' : 'green'), text: a.status === 'draft' ? 'Brouillon' : (a.body && a.body.trim() ? 'Page du site' : 'Lien externe') })),
            h('td', { 'class': 'act' },
              h('button', { 'class': 'btn btn-sm', text: '↑', disabled: i === 0, onclick: function () { move(-1); } }), ' ',
              h('button', { 'class': 'btn btn-sm', text: '↓', disabled: i === list.length - 1, onclick: function () { move(1); } }), ' ',
              h('button', { 'class': 'btn btn-sm btn-primary', text: 'Modifier', onclick: function () { edit(a, false); } }), ' ',
              h('button', { 'class': 'btn btn-sm btn-danger', text: 'Supprimer', onclick: function () { if (!window.confirm('Supprimer l’article « ' + a.title + ' » ?')) return; list.splice(i, 1); persist('Article supprimé').then(draw).catch(function (e) { toast(e.message, 'err'); }); } }))));
        });
        holder.appendChild(h('table', { 'class': 'tbl' }, h('thead', null, h('tr', null, h('th'), h('th', { text: 'Titre' }), h('th', { 'class': 'hide-s', text: 'Date' }), h('th', { text: 'Type' }), h('th'))), tb));
      }
      el.appendChild(h('p', { 'class': 'hint', text: 'Les articles s’affichent dans l’ordre de cette liste (le premier est le plus récent) : sur la page Insights et dans les 4 derniers de l’accueil.' }));
      el.appendChild(holder); draw();
      return { title: 'Articles (Insights)', el: el, actions: [h('button', { 'class': 'btn btn-primary', text: '+ Nouvel article', onclick: function () { edit({ title: '', date: new Date().toISOString().slice(0, 10), img: '', url: '', cat: '', slug: '', body: '', status: 'publish' }, true); } })] };
    });
  }

  function screenFaq() {
    return api('GET', '/faq').then(function (cats) {
      var data = { categories: cats };
      var el = h('div');
      el.appendChild(h('p', { 'class': 'hint', text: 'Les questions sont numérotées automatiquement dans l’ordre. Séparez les paragraphes d’une réponse par une ligne vide.' }));
      renderFields(el, [{ k: 'categories', t: 'rows', l: 'Catégories de questions', tk: 'name', add: 'Ajouter une catégorie', f: [
        field('name', 't', 'Titre de la catégorie'),
        { k: 'items', t: 'rows', l: 'Questions', tk: 'q', add: 'Ajouter une question', f: [field('q', 't', 'Question'), field('a', 'area', 'Réponse', { rows: 6 })] }
      ] }], data, function () { setDirty(true); });
      return { title: 'FAQ', el: el, actions: [saveButton(function () { return api('PUT', '/faq', data).then(function () { toast('FAQ enregistrée et publiée', 'ok'); }); })] };
    });
  }

  function screenRequests() {
    return api('GET', '/requests').then(function (list) {
      var kind = 'all', el = h('div'), holder = h('div');
      function mailPill(r) {
        if (r.mail && r.mail.ok) return h('span', { 'class': 'pill green', text: 'E-mail envoyé' });
        if (r.mail && r.mail.error === 'En attente') return h('span', { 'class': 'pill gray', text: 'En cours…' });
        return h('span', { 'class': 'pill red', title: r.mail && r.mail.error, text: 'E-mail non envoyé' });
      }
      function detail(r) {
        var bg = h('div', { 'class': 'modal-bg' }), closeIt = function () { bg.remove(); };
        bg.addEventListener('click', function (e) { if (e.target === bg) closeIt(); });
        var dl = h('dl'); Object.keys(r.data || {}).forEach(function (k) { dl.appendChild(h('dt', { text: k })); dl.appendChild(h('dd', { text: r.data[k] })); });
        dl.appendChild(h('dt', { text: 'Reçu le' })); dl.appendChild(h('dd', { text: fmtDate(r.date) }));
        dl.appendChild(h('dt', { text: 'Page' })); dl.appendChild(h('dd', { text: r.origin || '' }));
        if (r.mail && !r.mail.ok && r.mail.error) { dl.appendChild(h('dt', { text: 'E-mail' })); dl.appendChild(h('dd', { text: 'Non envoyé : ' + r.mail.error })); }
        var email = r.data && r.data['Email'];
        bg.appendChild(h('div', { 'class': 'modal', style: 'max-width:620px' }, h('header', null, h('h2', { text: r.kind + (r.data && r.data['Nom'] ? ' — ' + r.data['Nom'] : '') }), h('button', { 'class': 'btn btn-sm', text: 'Fermer', onclick: closeIt })), h('div', { 'class': 'body req-d' }, dl, email ? h('p', null, h('a', { 'class': 'btn btn-primary', href: 'mailto:' + email + '?subject=' + encodeURIComponent('Re: ' + r.kind + ' Navitrends'), text: 'Répondre par e-mail' })) : null)));
        document.body.appendChild(bg);
        if (!r.read) { r.read = true; api('PATCH', '/requests/' + r.id, { read: true }).then(function () { STATUS.unread = Math.max(0, STATUS.unread - 1); draw(); }); }
      }
      function draw() {
        clear(holder);
        var vis = list.filter(function (r) { return kind === 'all' || r.kind === kind; });
        if (!vis.length) { holder.appendChild(h('div', { 'class': 'empty', text: 'Aucune demande pour le moment.' })); return; }
        var tb = h('tbody');
        vis.forEach(function (r) {
          var prev = (r.data && (r.data['Message'] || r.data['Projet'] || r.data['Email'])) || '';
          tb.appendChild(h('tr', { 'class': r.read ? '' : 'unread' },
            h('td', { 'class': 'hide-s', text: fmtDate(r.date) }), h('td', null, h('span', { 'class': 'pill ' + (r.kind === 'Devis' ? 'gold' : ''), text: r.kind })),
            h('td', null, h('a', { 'class': 't', href: '#', text: (r.data && (r.data['Nom'] || r.data['Email'])) || '—', onclick: function (e) { e.preventDefault(); detail(r); } }), h('div', { 'class': 'nv-help', text: prev.length > 80 ? prev.slice(0, 78) + '…' : prev })),
            h('td', { 'class': 'hide-s' }, mailPill(r)),
            h('td', { 'class': 'act' }, h('button', { 'class': 'btn btn-sm', text: 'Ouvrir', onclick: function () { detail(r); } }), ' ',
              h('button', { 'class': 'btn btn-sm btn-danger', text: 'Supprimer', onclick: function () { if (!window.confirm('Supprimer cette demande ?')) return; api('DELETE', '/requests/' + r.id).then(function () { list.splice(list.indexOf(r), 1); draw(); }).catch(function (e) { toast(e.message, 'err'); }); } }))));
        });
        holder.appendChild(h('table', { 'class': 'tbl' }, h('thead', null, h('tr', null, h('th', { 'class': 'hide-s', text: 'Date' }), h('th', { text: 'Type' }), h('th', { text: 'De' }), h('th', { 'class': 'hide-s', text: 'E-mail' }), h('th'))), tb));
      }
      var tabs = h('div', { 'class': 'tabs2' });
      [['all', 'Toutes'], ['Contact', 'Contact'], ['Devis', 'Devis'], ['Newsletter', 'Newsletter']].forEach(function (t) {
        var b = h('button', { text: t[1], 'class': t[0] === 'all' ? 'on' : '', onclick: function () { kind = t[0]; Array.prototype.forEach.call(tabs.children, function (x) { x.classList.remove('on'); }); b.classList.add('on'); draw(); } }); tabs.appendChild(b);
      });
      el.appendChild(tabs); el.appendChild(holder); draw();
      var csv = h('button', { 'class': 'btn', text: 'Exporter en CSV', onclick: function () {
        var keys = []; list.forEach(function (r) { Object.keys(r.data || {}).forEach(function (k) { if (keys.indexOf(k) < 0) keys.push(k); }); });
        var q = function (s) { return '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"'; };
        var rows = [['Date', 'Type'].concat(keys).map(q).join(';')];
        list.forEach(function (r) { rows.push([r.date, r.kind].concat(keys.map(function (k) { return (r.data || {})[k]; })).map(q).join(';')); });
        var a = h('a', { href: URL.createObjectURL(new Blob(['\ufeff' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8' })), download: 'demandes-navitrends.csv' }); document.body.appendChild(a); a.click(); a.remove();
      } });
      return { title: 'Demandes reçues', el: el, actions: [csv] };
    });
  }

  function screenMedia() {
    return api('GET', '/media').then(function (m) {
      var el = h('div');
      el.appendChild(uploader(function () { route(); }, 'Déposez une image ici ou cliquez pour en téléverser une (PNG, JPG, WebP, GIF — 8 Mo max.)'));
      el.appendChild(h('h2', { text: 'Mes images téléversées' }));
      var g = h('div', { 'class': 'media-grid' });
      m.uploads.forEach(function (f) {
        g.appendChild(h('div', { 'class': 'mi', style: 'cursor:default' }, h('span', { 'class': 'im', style: 'background-image:url(' + f.url + ')' }), h('span', { 'class': 'cap', title: f.name, text: f.name }),
          h('div', { 'class': 'x' }, h('button', { 'class': 'btn btn-sm', text: 'Copier l’adresse', onclick: function () { (navigator.clipboard ? navigator.clipboard.writeText(location.origin + f.url) : Promise.reject()).then(function () { toast('Adresse copiée', 'ok'); }).catch(function () { window.prompt('Adresse de l’image', location.origin + f.url); }); } }),
            h('button', { 'class': 'btn btn-sm btn-danger', text: '✕', title: 'Supprimer', onclick: function () { if (!window.confirm('Supprimer cette image ? Les pages qui l’utilisent afficheront une image manquante.')) return; api('DELETE', '/upload?name=' + encodeURIComponent(f.name)).then(function () { toast('Image supprimée', 'ok'); route(); }).catch(function (e) { toast(e.message, 'err'); }); } }))));
      });
      el.appendChild(m.uploads.length ? g : h('p', { 'class': 'nv-help', text: 'Aucune image téléversée pour le moment.' }));
      el.appendChild(h('h2', { style: 'margin-top:28px', text: 'Images du site' }));
      var g2 = h('div', { 'class': 'media-grid' });
      m.theme.forEach(function (f) { g2.appendChild(h('div', { 'class': 'mi', style: 'cursor:default' }, h('span', { 'class': 'im', style: 'background-image:url(' + f.url + ')' }), h('span', { 'class': 'cap', text: f.name }))); });
      el.appendChild(g2);
      return { title: 'Images', el: el };
    });
  }

  function screenSettings() {
    return api('GET', '/settings').then(function (data) {
      var D = CFG.settingsDefaults, el = h('div'), dirtyFn = function () { setDirty(true); };
      var groups = [
        ['Identité du site', [field('site_name', 't', 'Nom du site'), field('site_url', 't', 'Adresse du site (sans / final)', { h: 'Utilisée pour Google (sitemap, données structurées). Ex. : https://navitrends.com' })]],
        ['Coordonnées — Tunisie', [field('tn_name', 't', 'Nom'), field('tn_address', 'area', 'Adresse'), field('tn_email', 't', 'E-mail'), field('tn_phone', 't', 'Téléphone (affiché)'), field('tn_tel', 't', 'Téléphone (lien d’appel, ex. +21658188873)')]],
        ['Coordonnées — Royaume-Uni', [field('uk_name', 't', 'Nom'), field('uk_address', 'area', 'Adresse'), field('uk_email', 't', 'E-mail'), field('uk_phone', 't', 'Téléphone (affiché)'), field('uk_tel', 't', 'Téléphone (lien d’appel)')]],
        ['Liens', [field('facebook', 't', 'Facebook'), field('linkedin', 't', 'LinkedIn'), field('stages_url', 't', 'Catalogue de stages')]],
        ['Pied de page', [field('footer_p1', 'area', 'Texte de présentation (paragraphe 1)'), field('footer_p2', 'area', 'Texte de présentation (paragraphe 2)'), field('legal_1', 't', 'Mention 1'), field('legal_2', 't', 'Mention 2'), field('wordmark', 't', 'Mot géant qui défile')]],
        ['Référencement (page d’accueil)', [field('seo_home_title', 't', 'Titre SEO de l’accueil'), field('seo_home_desc', 'area', 'Description SEO de l’accueil'), field('seo_cases_title', 't', 'Titre SEO de la page Études de cas', { h: 'Laisser vide = titre automatique.' }), field('seo_cases_desc', 'area', 'Description SEO de la page Études de cas'), field('org_desc', 'area', 'Description de l’organisation'), field('org_logo', 't', 'Adresse du logo (pour Google)'), field('geo_brand_pitch', 'area', 'Résumé court de la société (GEO)', { h: 'Une phrase simple sur Navitrends. Sert au fichier résumé. Laisser vide = description d’organisation.' })]],
        ['Page « Études de cas »', [field('cases_label', 't', 'Étiquette'), field('cases_h1', 't', 'Titre'), field('cases_tag', 'area', 'Phrase d’accroche'), field('cases_intro', 'area', 'Introduction')]],
        ['Page « Articles »', [field('blog_label', 't', 'Étiquette'), field('blog_h1', 't', 'Titre'), field('blog_tag', 'area', 'Phrase d’accroche'), { k: 'blog_cats', t: 'rows', l: 'Catégories du menu Insights', tk: 'name', add: 'Ajouter une catégorie', f: [field('name', 't', 'Nom'), field('url', 't', 'Adresse du lien')] }]]
      ];
      groups.forEach(function (g, i) { var p = panel(g[0], i === 0); renderFields(p.body, g[1], data, dirtyFn); el.appendChild(p.root); });
      var pm = panel('Formulaires et envoi d’e-mails', true);
      renderFields(pm.body, [
        field('form_to', 't', 'Adresse qui reçoit les messages', { h: 'Contact, devis et newsletter. Plusieurs adresses possibles, séparées par une virgule.' }),
        field('smtp_host', 't', 'Serveur d’envoi (SMTP)', { h: 'Ex. : smtp.gmail.com, ssl0.ovh.net, mail.votredomaine.com. Laissez vide pour ne pas envoyer d’e-mails (les demandes restent visibles dans le back-office).' }),
        field('smtp_port', 't', 'Port', { h: 'Habituellement 587 (TLS) ou 465 (SSL).' }),
        field('smtp_secure', 'select', 'Sécurité', { o: { tls: 'TLS / STARTTLS (port 587)', ssl: 'SSL (port 465)', none: 'Aucune' } }),
        field('smtp_user', 't', 'Identifiant SMTP'), field('smtp_pass', 'password', 'Mot de passe SMTP'),
        field('mail_from', 't', 'Adresse d’expéditeur', { h: 'Souvent identique à l’identifiant SMTP.' })
      ], data, dirtyFn);
      var testOut = h('p', { 'class': 'nv-help' });
      pm.body.appendChild(h('div', { 'class': 'nv-add' }, h('button', { 'class': 'btn btn-sm', text: 'Envoyer un e-mail de test', onclick: function () {
        if (dirty) { toast('Enregistrez d’abord les réglages.', 'err'); return; }
        testOut.textContent = 'Envoi en cours…';
        api('POST', '/test-mail', {}).then(function (r) { testOut.textContent = r.ok ? '✓ E-mail de test envoyé à ' + (data.form_to || '') : '✗ ' + r.error; testOut.style.color = r.ok ? 'var(--ok)' : 'var(--err)'; }).catch(function (e) { testOut.textContent = e.message; });
      } }), testOut));
      el.insertBefore(pm.root, el.children[4]);
      return { title: 'Réglages du site', el: el, actions: [saveButton(function () { return api('PUT', '/settings', data).then(function () { toast('Réglages enregistrés et publiés', 'ok'); }); })] };
    });
  }

  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/).filter(Boolean);
    return ((p[0] && p[0][0]) || '?') + ((p[1] && p[1][0]) || '');
  }
  function avTone(str) {
    var n = 0, s = String(str || '');
    for (var i = 0; i < s.length; i++) n = (n + s.charCodeAt(i) * (i + 1)) % 5;
    return 't' + n;
  }
  function userModal(user, onDone) {
    var isNew = !user;
    var bg = h('div', { 'class': 'modal-bg' });
    var close = function () { bg.remove(); };
    bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
    var nameI = h('input', { type: 'text', 'class': 'in', autocomplete: 'off', value: user ? user.name : '', placeholder: 'Prénom Nom' });
    var emailI = h('input', { type: 'email', 'class': 'in', autocomplete: 'off', value: user ? user.email : '', placeholder: 'colleague@navitrends.com' });
    var passI = h('input', { type: 'password', 'class': 'in', autocomplete: 'new-password', placeholder: isNew ? '10 caractères minimum' : 'Laisser vide pour ne pas changer' });
    var err = h('p', { 'class': 'err' });
    var save = h('button', { 'class': 'btn btn-primary', type: 'button', text: isNew ? 'Créer le compte' : 'Enregistrer' });
    save.addEventListener('click', function () {
      err.textContent = ''; save.disabled = true;
      var payload = { name: nameI.value, email: emailI.value, password: passI.value };
      var req = isNew ? api('POST', '/users', payload) : api('PUT', '/users/' + user.id, payload);
      req.then(function () { toast(isNew ? 'Compte créé' : 'Compte modifié', 'ok'); close(); onDone(); })
        .catch(function (e) { err.textContent = e.message; save.disabled = false; });
    });
    var body = h('div', { 'class': 'body user-modal-body' },
      h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: 'Nom' }), nameI),
      h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: 'Adresse e-mail' }), emailI),
      h('div', { 'class': 'nv-f' }, h('label', { 'class': 'nv-l', text: isNew ? 'Mot de passe' : 'Nouveau mot de passe (optionnel)' }), passI),
      err,
      h('div', { 'class': 'user-modal-acts' }, h('button', { 'class': 'btn', type: 'button', text: 'Annuler', onclick: close }), save));
    bg.appendChild(h('div', { 'class': 'modal modal-sm' },
      h('header', null, h('h2', { text: isNew ? 'Nouvel administrateur' : 'Modifier le compte' }), h('button', { 'class': 'btn btn-sm', text: 'Fermer', onclick: close })),
      body));
    document.body.appendChild(bg);
    nameI.focus();
  }
  function screenUsers() {
    return api('GET', '/users').then(function (users) {
      var el = h('div', { 'class': 'users-page' });
      var list = h('div', { 'class': 'user-list' },
        h('div', { 'class': 'user-list-top' },
          h('div', null, h('h2', { text: 'Administrateurs' }), h('p', { text: users.length + ' compte' + (users.length > 1 ? 's' : '') + ' · accès complet au back-office' })),
          h('button', { 'class': 'btn btn-primary', type: 'button', text: '+ Créer un compte', onclick: function () { userModal(null, route); } })),
        h('div', { 'class': 'user-cols hide-s' },
          h('span', { text: 'Personne' }), h('span', { text: 'Rôle' }), h('span', { text: 'Créé le' }), h('span', { text: 'Actions' })));
      users.forEach(function (u, i) {
        var me = u.id === ME.id;
        var delBtn = h('button', { 'class': 'btn btn-sm btn-danger', type: 'button', text: 'Supprimer', onclick: function () {
          var msg = me
            ? 'Supprimer votre propre accès ? Vous serez déconnecté.'
            : 'Supprimer l’accès de ' + u.email + ' ?';
          if (users.length <= 1) { toast('Impossible : c’est le dernier compte administrateur.', 'err'); return; }
          if (!window.confirm(msg)) return;
          api('DELETE', '/users/' + u.id).then(function () {
            toast('Accès supprimé', 'ok');
            if (me) { ME = null; location.hash = '#/'; route(); }
            else route();
          }).catch(function (e) { toast(e.message, 'err'); });
        } });
        if (users.length <= 1) { delBtn.disabled = true; delBtn.title = 'Ajoutez un autre compte avant de supprimer celui-ci.'; }
        var acts = h('div', { 'class': 'user-act' },
          h('button', { 'class': 'btn btn-sm', type: 'button', text: 'Modifier', onclick: function () { userModal(u, route); } }),
          delBtn);
        list.appendChild(h('div', { 'class': 'user-row' + (me ? ' is-me' : '') + (i === users.length - 1 ? ' last' : '') },
          h('div', { 'class': 'user-person' },
            h('span', { 'class': 'user-av ' + avTone(u.email || u.name), text: initials(u.name).toUpperCase() }),
            h('div', { 'class': 'user-meta' },
              h('strong', { text: u.name || 'Sans nom' }),
              h('span', { text: u.email }),
              me ? h('em', { 'class': 'user-you', text: 'Compte connecté' }) : null)),
          h('div', { 'class': 'user-role' }, h('span', { 'class': 'pill', text: 'Administrateur' })),
          h('div', { 'class': 'user-date hide-s', text: fmtDate(u.created) }),
          acts));
      });
      el.appendChild(list);
      return { title: 'Comptes', el: el };
    });
  }

  function screenSeo() {
    if (!window.NVSeo) return { title: 'SEO', el: h('div', { 'class': 'empty', text: 'Module SEO non chargé (seo-ui.js).' }) };
    return window.NVSeo({ h: h, clear: clear, api: api, toast: toast, guard: guard, fmtDate: fmtDate, go: go });
  }
  function screenGeo() {
    if (!window.NVGeo) return { title: 'GEO', el: h('div', { 'class': 'empty', text: 'Module GEO non chargé (geo-ui.js).' }) };
    return window.NVGeo({ h: h, clear: clear, api: api, toast: toast, guard: guard, fmtDate: fmtDate, go: go });
  }
  function screenVisibility() {
    if (!window.NVVisibility) return { title: 'Visibilité', el: h('div', { 'class': 'empty', text: 'Module Visibilité non chargé (visibility-ui.js).' }) };
    return window.NVVisibility({ h: h, clear: clear, api: api, toast: toast, guard: guard, fmtDate: fmtDate, go: go });
  }

  function screenBackup() {
    var el = h('div');
    el.appendChild(h('div', { 'class': 'card' }, h('h2', { text: 'Télécharger une sauvegarde' }), h('p', { 'class': 'hint', text: 'Un seul fichier contenant tout le contenu du site (pages, accueil, études de cas, articles, FAQ, réglages, demandes). Les images téléversées sont dans le dossier « uploads » du serveur. Des copies automatiques sont aussi conservées à chaque enregistrement (dossier data/backups).' }),
      h('a', { 'class': 'btn btn-primary', href: '/api/export', text: 'Télécharger la sauvegarde' })));
    var file = h('input', { type: 'file', accept: 'application/json,.json' });
    el.appendChild(h('div', { 'class': 'card' }, h('h2', { text: 'Restaurer une sauvegarde' }), h('p', { 'class': 'hint', text: 'Attention : le contenu actuel sera remplacé par celui du fichier.' }), file, ' ',
      h('button', { 'class': 'btn btn-danger', text: 'Restaurer', onclick: guard(function () {
        if (!file.files[0]) throw new Error('Choisissez d’abord un fichier de sauvegarde.');
        if (!window.confirm('Remplacer tout le contenu actuel par cette sauvegarde ?')) return;
        return file.files[0].text().then(function (t) { var j; try { j = JSON.parse(t); } catch (e) { throw new Error('Fichier illisible.'); } return api('POST', '/import', j); }).then(function () { toast('Sauvegarde restaurée et site republié', 'ok'); });
      }) })));
    return { title: 'Sauvegarde', el: el };
  }

  /* ---------- routeur ---------- */
  function route() {
    if (!CFG && !ME) { /* amorçage */ }
    api('GET', '/session').then(function (s) {
      if (!s.user) { ME = null; setDirty(false); return screenLogin(s.needsSetup); }
      ME = s.user;
      return (CFG ? Promise.resolve() : api('GET', '/config').then(function (c) { CFG = c; })).then(function () { return api('GET', '/status'); }).then(function (st) {
        STATUS = st;
        var path = (location.hash || '#/').slice(1) || '/';
        var m, scr;
        if (path === '/') scr = screenDashboard();
        else if (path === '/home') scr = screenHome();
        else if (path === '/pages') scr = screenPages();
        else if (path === '/pages/new') scr = screenPageEdit(null);
        else if ((m = /^\/pages\/edit\/([a-z0-9-]+)$/.exec(path))) scr = screenPageEdit(m[1]);
        else if (path === '/cases') scr = screenCases();
        else if (path === '/cases/new') scr = screenCaseEdit(null);
        else if ((m = /^\/cases\/edit\/([a-z0-9-]+)$/.exec(path))) scr = screenCaseEdit(m[1]);
        else if (path === '/articles') scr = screenArticles();
        else if (path === '/faq') scr = screenFaq();
        else if (path === '/requests') scr = screenRequests();
        else if (path === '/media') scr = screenMedia();
        else if (path === '/seo') scr = screenSeo();
        else if (path === '/geo') scr = screenGeo();
        else if (path === '/visibility') scr = screenVisibility();
        else if (path === '/settings') scr = screenSettings();
        else if (path === '/users') scr = screenUsers();
        else if (path === '/backup') scr = screenBackup();
        else { location.hash = '#/'; return; }
        return Promise.resolve(scr).then(function (r) { setDirty(false); layout(path, r.title, r.actions || [], r.el); });
      });
    }).catch(function (e) { if (ME) toast(e.message || 'Erreur', 'err'); else { clear(app); app.appendChild(h('p', { 'class': 'boot', text: 'Impossible de contacter le serveur : ' + e.message })); } });
  }
  var lastHash = location.hash;
  window.addEventListener('hashchange', function () {
    if (!confirmLeave()) { history.replaceState(null, '', lastHash || '#/'); return; }
    lastHash = location.hash; route();
  });
  route();
})();
