/* Back-office Navitrends — écran SEO (JavaScript natif, sans dépendance).
   Chargé avant admin.js ; admin.js appelle window.NVSeo({ h, clear, api, toast, guard, fmtDate, go }). */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  window.NVSeo = function (H) {
    var h = H.h, clear = H.clear, api = H.api, toast = H.toast, guard = H.guard, fmtDate = H.fmtDate;
    var root = h('div', { 'class': 'sx' });
    var body = h('div', { 'class': 'sx-body' });
    var tabsEl = h('div', { 'class': 'sx-tabs', role: 'tablist' });
    var cache = {};
    var tab = 'overview';
    var ui = { auditCode: '', auditSev: 'all', auditCat: 'all', auditQ: '', pagesQ: '', pagesF: 'all', f404: 'todo', q404: '', qRed: '', editing: null, prefill: null, showImport: false, warnings: [], showLog: false };
    var TABS = [['overview', 'Vue d’ensemble'], ['pages', 'Pages'], ['audit', 'À corriger'], ['404', 'Pages introuvables'], ['redirects', 'Redirections'], ['report', 'Bilan'], ['tech', 'Technique']];

    /* ---------- outils ---------- */
    function svg(tag, attrs) {
      var e = document.createElementNS(NS, tag);
      Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      for (var i = 2; i < arguments.length; i++) if (arguments[i]) e.appendChild(arguments[i]);
      return e;
    }
    function bust() { cache = {}; }
    function loader(key, path, pick) {
      if (cache[key]) return cache[key];
      var p = api('GET', path).then(function (r) { return pick ? pick(r) : r; });
      cache[key] = p;
      p.catch(function () { if (cache[key] === p) delete cache[key]; });
      return p;
    }
    var getOv = function () { return loader('ov', '/seo/overview'); };
    var getRep = function () { return loader('rep', '/seo/audit', function (r) { return r.report; }); };
    var get404 = function () { return loader('n404', '/seo/404', function (r) { return r.items; }); };
    var getRed = function () { return loader('red', '/seo/redirects', function (r) { return r.items; }); };
    var getReport = function () { return loader('report', '/seo/report'); };
    var getRedLog = function () { return loader('redlog', '/seo/redirects/log', function (r) { return r.items; }); };
    function downloadExport(type) {
      return fetch('/api/seo/export?type=' + encodeURIComponent(type), { credentials: 'same-origin', headers: { 'X-NV': '1' } }).then(function (r) {
        if (!r.ok) throw new Error('Export impossible (' + r.status + ')');
        var disp = r.headers.get('Content-Disposition') || '';
        var m = /filename="([^"]+)"/.exec(disp);
        return r.blob().then(function (blob) {
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (m && m[1]) || ('seo-' + type + '.csv');
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
          toast('Export CSV téléchargé', 'ok');
        });
      });
    }
    var colorOf = function (s) { return s >= 90 ? '#18a874' : s >= 75 ? '#3b6fd9' : s >= 55 ? '#e0a512' : '#d64545'; };
    var clsOf = function (s) { return s >= 90 ? 'g' : s >= 75 ? 'b' : s >= 55 ? 'y' : 'r'; };
    var SEV = { high: ['red', 'Urgent'], med: ['gold', 'À améliorer'], low: ['gray', 'Secondaire'] };
    var sevPill = function (s) { return h('span', { 'class': 'pill ' + SEV[s][0], text: SEV[s][1] }); };
    var plural = function (n, a, b) { return n + ' ' + (n > 1 ? b : a); };
    function lenState(n, min, max) { return n === 0 ? 'bad' : n > max ? 'bad' : n < min ? 'warn' : 'ok'; }
    function lenPill(n, min, max) { return h('span', { 'class': 'sx-len ' + lenState(n, min, max), text: String(n) }); }
    function scoreBadge(s) { return h('span', { 'class': 'sx-sb ' + clsOf(s), text: String(s) }); }
    function pageByKey(rep, k) { for (var i = 0; i < rep.pages.length; i++) if (rep.pages[i].key === k) return rep.pages[i]; return null; }
    function reloadAll() { bust(); return refreshBadges().then(function () { return render(); }); }
    function btn(label, cls, fn, title) { return h('button', { type: 'button', 'class': 'btn ' + (cls || ''), text: label, title: title || null, onclick: fn }); }
    function searchBox(value, ph, onInput) {
      var i = h('input', { type: 'search', 'class': 'sx-search', placeholder: ph, value: value || '' });
      i.addEventListener('input', function () { onInput(i.value); });
      return i;
    }
    function chips(list, current, onPick) {
      var wrap = h('div', { 'class': 'sx-chips' });
      list.forEach(function (c) {
        wrap.appendChild(h('button', { type: 'button', 'class': current === c[0] ? 'on' : '', text: c[1], onclick: function () { onPick(c[0]); } }));
      });
      return wrap;
    }
    function empty(msg, icon) { return h('div', { 'class': 'sx-empty' }, h('div', { 'class': 'sx-empty-i', text: icon || '✓' }), h('p', { text: msg })); }
    function modal(title, content, foot, wide) {
      var bg = h('div', { 'class': 'modal-bg' });
      var close = function () { bg.remove(); };
      bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
      var m = h('div', { 'class': 'modal' + (wide ? '' : ' modal-sm') + ' sx-modal' }, h('header', null, h('h2', { text: title }), h('button', { 'class': 'btn btn-sm', text: 'Fermer', onclick: close })),
        h('div', { 'class': 'body' }, content), foot ? h('footer', { 'class': 'sx-mfoot' }, foot) : null);
      bg.appendChild(m); document.body.appendChild(bg);
      return { close: close, el: m };
    }

    /* ---------- visuels ---------- */
    function scoreRing(score, size) {
      var r = 66, c = 2 * Math.PI * r, col = colorOf(score);
      var arc = svg('circle', { cx: 80, cy: 80, r: r, fill: 'none', stroke: col, 'stroke-width': 13, 'stroke-linecap': 'round', transform: 'rotate(-90 80 80)', 'stroke-dasharray': '0 ' + c, 'class': 'sx-ring-arc' });
      var s = svg('svg', { viewBox: '0 0 160 160', width: size, height: size, role: 'img', 'aria-label': 'Score SEO ' + score + ' sur 100' },
        svg('circle', { cx: 80, cy: 80, r: r, fill: 'none', 'stroke-width': 13, 'class': 'sx-ring-track' }), arc);
      var t = svg('text', { x: 80, y: 84, 'text-anchor': 'middle', 'class': 'sx-ring-n' }); t.textContent = String(score);
      var t2 = svg('text', { x: 80, y: 106, 'text-anchor': 'middle', 'class': 'sx-ring-s' }); t2.textContent = 'sur 100';
      s.appendChild(t); s.appendChild(t2);
      requestAnimationFrame(function () { requestAnimationFrame(function () { arc.setAttribute('stroke-dasharray', (c * score / 100) + ' ' + c); }); });
      return s;
    }
    function bar(score) {
      return h('span', { 'class': 'sx-bar' }, h('i', { 'class': clsOf(score), style: 'width:' + Math.max(3, score) + '%' }));
    }

    /* ---------- actions communes ---------- */
    function applyFixes(ids, label) {
      return api('POST', '/seo/fix', { ids: ids }).then(function (r) {
        toast(plural(r.applied, 'correction enregistrée', 'corrections enregistrées') + ' · note ' + r.before + ' → ' + r.score, 'ok');
        return reloadAll();
      });
    }
    function fixModal(issues, rep, title) {
      var checks = [];
      var list = h('div', { 'class': 'sx-fixlist' });
      issues.forEach(function (i) {
        var pg = pageByKey(rep, i.pageKey) || {};
        var before = i.fix.field === 'title' ? pg.title : pg.desc;
        var cb = h('input', { type: 'checkbox' }); cb.checked = true; checks.push([cb, i.id]);
        list.appendChild(h('label', { 'class': 'sx-fixrow' }, cb,
          h('div', null,
            h('div', { 'class': 'sx-fixhead' }, h('b', { text: i.page }), h('span', { 'class': 'pill gray', text: i.fix.field === 'title' ? 'Titre' : 'Description' }), h('code', { text: i.path })),
            h('div', { 'class': 'sx-old', text: before || '(vide)' }),
            h('div', { 'class': 'sx-new', text: i.fix.value + '  (' + i.fix.value.length + ' car.)' }))));
      });
      var applyBtn = h('button', { type: 'button', 'class': 'btn btn-primary', text: 'Appliquer', onclick: guard(function () {
        var ids = checks.filter(function (c) { return c[0].checked; }).map(function (c) { return c[1]; });
        if (!ids.length) throw new Error('Cochez au moins une correction.');
        applyBtn.disabled = true;
        return applyFixes(ids).then(function () { m.close(); }).catch(function (e) { applyBtn.disabled = false; throw e; });
      }) });
      var m = modal(title || 'Corrections automatiques', h('div', null,
        h('p', { 'class': 'hint', text: 'En vert : la proposition. Décochez ce que vous préférez laisser tel quel. En validant, le site est mis à jour tout de suite.' }), list),
        [btn('Annuler', '', function () { m.close(); }), applyBtn], true);
    }
    function createRedirect(from, to) {
      return api('POST', '/seo/redirects', { from: from, to: to, code: 301, note: 'Créée depuis le SEO' }).then(function (r) {
        toast('Redirection créée : ' + r.item.from + ' → ' + r.item.to, 'ok');
        if (r.warnings && r.warnings.length) toast(r.warnings[0], 'err');
        return reloadAll();
      });
    }
    function goTab(name) {
      tab = name;
      Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (b) { b.className = b.getAttribute('data-tab') === name ? 'on' : ''; b.setAttribute('aria-selected', b.getAttribute('data-tab') === name ? 'true' : 'false'); });
      return render();
    }

    /* ====================================================================
       VUE D'ENSEMBLE
       ==================================================================== */
    function renderOverview() {
      return getOv().then(function (o) {
        clear(body);
        var deltaTxt = o.delta == null ? null : o.delta > 0 ? '▲ +' + o.delta + ' pts' : o.delta < 0 ? '▼ ' + o.delta + ' pts' : '= stable';
        var open = (o.counts.high || 0) + (o.counts.med || 0) + (o.counts.low || 0);
        var hero = h('section', { 'class': 'sx-hero sx-hero-2' },
          h('div', { 'class': 'sx-hero-ring' }, scoreRing(o.score, 148)),
          h('div', { 'class': 'sx-hero-main' },
            h('p', { 'class': 'sx-kicker', text: 'Référencement' }),
            h('h2', { text: o.grade }),
            h('p', { 'class': 'sx-hero-sub', text: plural(o.totals.pages, 'page lue', 'pages lues') + (open ? ' · ' + plural(open, 'point ouvert', 'points ouverts') : ' · rien à signaler') }),
            h('div', { 'class': 'sx-hero-meta' },
              deltaTxt ? h('span', { 'class': 'sx-delta ' + (o.delta > 0 ? 'up' : o.delta < 0 ? 'down' : ''), text: deltaTxt }) : null,
              h('span', { text: 'Dernière lecture · ' + fmtDate(o.at) })),
            h('div', { 'class': 'sx-hero-acts' },
              btn('Relire le site', 'btn-gold', guard(function () {
                return api('POST', '/seo/audit', {}).then(function () { toast('Lecture terminée', 'ok'); return reloadAll(); });
              })),
              o.totals.fixable ? btn('Corriger (' + o.totals.fixable + ')', 'sx-ghost', guard(function () {
                return getRep().then(function (rep) { fixModal(rep.issues.filter(function (i) { return i.fix; }), rep, 'Propositions de correction (' + o.totals.fixable + ')'); });
              })) : null)));
        body.appendChild(hero);

        var kpi = function (n, label, sub, to, tone) {
          return h('button', { type: 'button', 'class': 'sx-kpi ' + (tone || ''), onclick: to }, h('b', { text: String(n) }), h('span', { text: label }), h('small', { text: sub }));
        };
        var idx = o.indexable != null ? o.indexable : o.totals.indexable;
        var nox = o.noindex || o.totals.noindex || 0;
        body.appendChild(h('div', { 'class': 'sx-kpis sx-kpis-4' },
          kpi(o.counts.high, 'Urgents', o.counts.high ? 'À traiter en premier' : 'Rien d’urgent', function () { ui.auditSev = 'high'; ui.auditCode = ''; goTab('audit'); }, o.counts.high ? 'bad' : 'good'),
          kpi(o.errors404, 'Introuvables', o.bots404 ? o.bots404 + ' robots mis de côté' : 'Adresses sans page', function () { goTab('404'); }, o.errors404 ? 'warn' : 'good'),
          kpi(idx + '/' + o.totals.pages, 'Visibles Google', nox ? nox + ' cachée(s)' : 'Toutes visibles', function () { ui.pagesF = nox ? 'noindex' : 'all'; goTab('pages'); }, nox ? 'warn' : 'good'),
          kpi(o.redirectsEnabled, 'Redirections', o.redirects + ' au total', function () { goTab('redirects'); })));

        var plan = h('div', { 'class': 'sx-card sx-plan' }, h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'À faire en premier' })));
        if (!o.actions.length) plan.appendChild(empty('Rien à signaler.', '★'));
        o.actions.forEach(function (a, idxN) {
          var tip = a.tip + (a.samples.length ? ' · ex. ' + a.samples.slice(0, 2).join(', ') : '');
          var goSee = function () { ui.auditCode = a.code; ui.auditSev = 'all'; ui.auditCat = 'all'; ui.auditQ = ''; goTab('audit'); };
          var actBtn = a.fixable
            ? btn('Corriger (' + a.fixable + ')', 'btn-sm btn-primary', guard(function () {
              return getRep().then(function (rep) { fixModal(rep.issues.filter(function (i) { return i.code === a.code && i.fix; }), rep, a.title); });
            }), tip)
            : btn('Voir', 'btn-sm', goSee, tip);
          plan.appendChild(h('div', { 'class': 'sx-act', title: tip },
            h('span', { 'class': 'sx-act-n', text: String(idxN + 1) }),
            h('div', { 'class': 'sx-act-main' },
              h('div', { 'class': 'sx-act-t' }, h('b', { text: a.title }), h('span', { 'class': 'sx-gain', text: '+' + a.gain + ' pts' }),
                h('small', { 'class': 'sx-act-c', text: plural(a.count, 'cas', 'cas') }))),
            h('div', { 'class': 'sx-act-b' }, actBtn)));
        });

        var cats = h('div', { 'class': 'sx-cats' });
        Object.keys(o.categories).forEach(function (k) {
          var c = o.categories[k];
          cats.appendChild(h('button', { type: 'button', 'class': 'sx-cat', onclick: function () { ui.auditCat = k; ui.auditCode = ''; ui.auditSev = 'all'; goTab('audit'); } },
            h('span', { 'class': 'sx-cat-l', text: c.label }), bar(c.score), h('b', { 'class': clsOf(c.score), text: String(c.score) })));
        });
        plan.appendChild(h('div', { 'class': 'sx-plan-cats' },
          h('p', { 'class': 'sx-plan-cats-l', text: 'Par domaine' }),
          cats));

        body.appendChild(plan);
      });
    }

    /* ====================================================================
       PAGES + éditeur (tiroir)
       ==================================================================== */
    function renderPages() {
      return getRep().then(function (rep) {
        clear(body);
        var listBox = h('div', { 'class': 'sx-plist' });
        function draw() {
          clear(listBox);
          var q = ui.pagesQ.toLowerCase();
          var items = rep.pages.filter(function (p) {
            if (ui.pagesF === 'fix' && p.score >= 90) return false;
            if (ui.pagesF === 'ok' && p.score < 90) return false;
            if (ui.pagesF === 'index' && !p.indexable) return false;
            if (ui.pagesF === 'noindex' && p.indexable) return false;
            return !q || (p.name + ' ' + p.path + ' ' + p.title).toLowerCase().indexOf(q) >= 0;
          }).sort(function (a, b) { return a.score - b.score || a.name.localeCompare(b.name); });
          if (!items.length) { listBox.appendChild(empty('Aucune page ne correspond.', '∅')); return; }
          listBox.appendChild(h('div', { 'class': 'sx-prow head' }, h('span', { text: 'Score' }), h('span', { text: 'Page' }), h('span', { 'class': 'c', text: 'Titre' }), h('span', { 'class': 'c', text: 'Descr.' }), h('span', { 'class': 'c hide-s', text: 'Mots' }), h('span', { 'class': 'c', text: 'Alertes' }), h('span')));
          items.forEach(function (p) {
            var row = h('div', { 'class': 'sx-prow', tabindex: '0', role: 'button', title: 'Ouvrir la page' },
              scoreBadge(p.score),
              h('span', { 'class': 'sx-pname' }, h('b', { text: p.name }), h('code', { text: p.path }), p.indexable ? null : h('span', { 'class': 'pill gold', text: 'noindex' })),
              h('span', { 'class': 'c' }, lenPill(p.title.length, 30, 60)),
              h('span', { 'class': 'c' }, lenPill(p.desc.length, 70, 160)),
              h('span', { 'class': 'c hide-s', text: String(p.words) }),
              h('span', { 'class': 'c' }, p.issues.total ? h('span', { 'class': 'pill ' + (p.issues.high ? 'red' : p.issues.med ? 'gold' : 'gray'), text: String(p.issues.total) }) : h('span', { 'class': 'sx-ok', text: '✓' })),
              h('span', { 'class': 'sx-chev', text: '›' }));
            row.addEventListener('click', function () { openDrawer(p, rep); });
            row.addEventListener('keydown', function (e) { if (e.key === 'Enter') openDrawer(p, rep); });
            listBox.appendChild(row);
          });
        }
        var nIdx = rep.pages.filter(function (p) { return p.indexable; }).length;
        var nNo = rep.pages.length - nIdx;
        var bar1 = h('div', { 'class': 'sx-toolbar' },
          searchBox(ui.pagesQ, 'Rechercher une page…', function (v) { ui.pagesQ = v; draw(); }),
          chips([['all', 'Toutes (' + rep.pages.length + ')'], ['fix', 'À retravailler (' + rep.pages.filter(function (p) { return p.score < 90; }).length + ')'], ['ok', 'Au top (' + rep.pages.filter(function (p) { return p.score >= 90; }).length + ')'], ['index', 'Visibles (' + nIdx + ')'], ['noindex', 'Cachées (' + nNo + ')']], ui.pagesF, function (v) { ui.pagesF = v; renderPages(); }));
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Pages' })),
          bar1, listBox));
        draw();
      });
    }

    function openDrawer(pg, rep) {
      var titleI = h('input', { type: 'text', 'class': 'sx-in', value: pg.title, maxlength: '300' });
      var descI = h('textarea', { 'class': 'sx-in', rows: '4', maxlength: '500' }); descI.value = pg.desc;
      var ro = !pg.editable;
      if (ro) { titleI.setAttribute('readonly', ''); descI.setAttribute('readonly', ''); }
      var origT = pg.title, origD = pg.desc;
      var host = (rep.siteUrl || location.origin).replace(/^https?:\/\//, '').replace(/\/$/, '');
      var mobile = false;
      /* aperçu Google */
      var sUrl = h('div', { 'class': 'sx-s-url' }), sTitle = h('div', { 'class': 'sx-s-title' }), sDesc = h('div', { 'class': 'sx-s-desc' });
      var serp = h('div', { 'class': 'sx-serp' }, h('div', { 'class': 'sx-s-site' }, h('span', { 'class': 'sx-s-fav', text: 'N' }), h('div', null, h('div', { 'class': 'sx-s-name', text: 'Navitrends' }), sUrl)), sTitle, sDesc);
      var segs = pg.path.split('/').filter(Boolean);
      sUrl.textContent = host + (segs.length ? ' › ' + segs.join(' › ') : '');
      /* compteurs */
      var tCount = h('span', { 'class': 'sx-cnt' }), dCount = h('span', { 'class': 'sx-cnt' });
      var tBar = h('span', { 'class': 'sx-meter' }, h('i')), dBar = h('span', { 'class': 'sx-meter' }, h('i'));
      var tNote = h('p', { 'class': 'sx-note' }), dNote = h('p', { 'class': 'sx-note' });
      function meter(el, n, min, max) { var st = lenState(n, min, max); el.className = 'sx-meter ' + st; el.firstChild.style.width = Math.min(100, Math.round(n / max * 100)) + '%'; }
      function refresh() {
        var t = titleI.value.trim(), d = descI.value.trim();
        sTitle.textContent = t || '(titre vide)'; sDesc.textContent = d || '(description vide — Google en choisira une automatiquement)';
        tCount.textContent = t.length + ' / 60'; dCount.textContent = d.length + ' / 160';
        tCount.className = 'sx-cnt ' + lenState(t.length, 30, 60); dCount.className = 'sx-cnt ' + lenState(d.length, 70, 160);
        meter(tBar, t.length, 30, 60); meter(dBar, d.length, 70, 160);
        tNote.textContent = !t.length ? 'Il faut un titre.' : t.length > 60 ? 'Un peu long : Google risque de couper la fin.' : t.length < 30 ? 'Un peu court : précisez le sujet.' : 'Bonne longueur.';
        dNote.textContent = !d.length ? 'Sans description, Google choisira un extrait tout seul.' : d.length > 160 ? 'Un peu longue : la fin peut être coupée.' : d.length < 70 ? 'Un peu courte : donnez envie de cliquer.' : 'Bonne longueur.';
      }
      titleI.addEventListener('input', refresh); descI.addEventListener('input', refresh);
      var mtog = h('div', { 'class': 'sx-seg' },
        h('button', { type: 'button', 'class': 'on', text: 'Ordinateur', onclick: function (e) { mobile = false; serp.classList.remove('mob'); sw(e); } }),
        h('button', { type: 'button', text: 'Mobile', onclick: function (e) { mobile = true; serp.classList.add('mob'); sw(e); } }));
      function sw(e) { Array.prototype.forEach.call(mtog.children, function (b) { b.className = ''; }); e.currentTarget.className = 'on'; }
      /* suggestions */
      function suggestBox(label, sug, input, current) {
        if (ro || !sug || sug === current) return null;
        return h('div', { 'class': 'sx-sug' }, h('div', null, h('b', { text: 'Proposition · ' + label }), h('p', { text: sug })),
          btn('Prendre celle-ci', 'btn-sm', function () { input.value = sug; refresh(); }));
      }
      /* problèmes de la page */
      var mine = rep.issues.filter(function (i) { return i.pageKey === pg.key; });
      var issuesEl = h('div', { 'class': 'sx-dr-sec' }, h('h4', { text: 'Points repérés' }));
      if (!mine.length) issuesEl.appendChild(h('p', { 'class': 'sx-okline', text: '✓ Rien à signaler sur cette page.' }));
      mine.forEach(function (i) {
        issuesEl.appendChild(h('div', { 'class': 'sx-di' }, sevPill(i.severity), h('div', null, h('b', { text: i.title }), h('p', { text: i.message }), h('small', { text: i.tip }))));
      });
      /* mots-clés cibles */
      var targetsI = h('input', { type: 'text', 'class': 'sx-in', placeholder: 'ex. erp odoo, automatisation, intégration erp', value: (pg.targets || []).join(', ') });
      var tgtEl = h('div', { 'class': 'sx-dr-sec' },
        h('h4', { text: 'Expressions à viser' }),
        h('p', { 'class': 'nv-help', text: 'Jusqu’à 8 expressions, séparées par une virgule. Elles guident les propositions de titre et de description.' }),
        targetsI,
        h('div', { 'class': 'sx-form-a', style: 'margin-top:8px' }, btn('Enregistrer', 'btn-sm', guard(function () {
          return api('PUT', '/seo/targets', { type: pg.type, slug: pg.slug, keywords: targetsI.value }).then(function (r) {
            toast('Expressions enregistrées (' + r.keywords.length + ')', 'ok');
            pg.targets = r.keywords;
            return reloadAll();
          });
        }))));
      /* suggestions de contenu */
      var tipsEl = h('div', { 'class': 'sx-dr-sec' }, h('h4', { text: 'Pistes pour le contenu' }));
      var tips = pg.tips || [];
      if (!tips.length) tipsEl.appendChild(h('p', { 'class': 'sx-okline', text: '✓ Pas de piste urgente ici.' }));
      tips.forEach(function (t) {
        tipsEl.appendChild(h('div', { 'class': 'sx-tip ' + (t.kind || '') }, h('span', { 'class': 'pill gray', text: t.kind === 'keyword' ? 'Expression' : t.kind === 'media' ? 'Image' : t.kind === 'structure' ? 'Structure' : 'Texte' }), h('p', { text: t.text })));
      });
      /* mots-clés détectés */
      var kwEl = h('div', { 'class': 'sx-dr-sec' }, h('h4', { text: 'Mots qui reviennent dans le texte' }));
      if (!pg.keywords.length) kwEl.appendChild(h('p', { 'class': 'nv-help', text: 'Pas assez de texte pour en dégager.' }));
      else {
        var kt = h('table', { 'class': 'tbl sx-kw' }, h('thead', null, h('tr', null, h('th', { text: 'Mot' }), h('th', { text: 'Fois' }), h('th', { text: 'Titre' }), h('th', { text: 'Descr.' }), h('th', { text: 'H1' }))));
        var tb = h('tbody');
        pg.keywords.forEach(function (k) { tb.appendChild(h('tr', null, h('td', null, h('b', { text: k.w })), h('td', { text: String(k.n) }), h('td', { 'class': k.t ? 'y' : 'n', text: k.t ? '✓' : '–' }), h('td', { 'class': k.d ? 'y' : 'n', text: k.d ? '✓' : '–' }), h('td', { 'class': k.h ? 'y' : 'n', text: k.h ? '✓' : '–' }))); });
        kt.appendChild(tb); kwEl.appendChild(kt);
        kwEl.appendChild(h('p', { 'class': 'nv-help', text: 'L’idée : le sujet principal apparaît dans le titre, la description et le H1. Cliquez un mot pour l’ajouter aux expressions à viser.' }));
        kwEl.querySelectorAll('tbody b').forEach(function (b) {
          b.style.cursor = 'pointer';
          b.title = 'Ajouter aux expressions à viser';
          b.addEventListener('click', function () {
            var cur = targetsI.value.trim();
            var w = b.textContent;
            if (cur.toLowerCase().split(/[,;\n]/).map(function (x) { return x.trim(); }).indexOf(w) >= 0) return;
            targetsI.value = cur ? cur + ', ' + w : w;
          });
        });
      }
      var stats = h('div', { 'class': 'sx-dstats' });
      [[pg.words, 'mots'], [pg.h1, 'H1'], [pg.h2, 'H2'], [pg.imgs - pg.imgsNoAlt + '/' + pg.imgs, 'images avec alt'], [pg.links.internal, 'liens internes'], [pg.inbound, 'liens entrants'], [pg.indexable ? 'oui' : 'non', 'indexable']].forEach(function (s) { stats.appendChild(h('div', null, h('b', { text: String(s[0]) }), h('span', { text: s[1] }))); });

      var bg = h('div', { 'class': 'sx-dr-bg' });
      var saveBtn = h('button', { type: 'button', 'class': 'btn btn-primary', text: 'Enregistrer et publier', onclick: guard(function () {
        var payload = { type: pg.type, slug: pg.slug };
        var t = titleI.value.trim(), d = descI.value.trim();
        if (t !== origT) payload.title = t;
        if (d !== origD) payload.desc = d;
        var kwChanged = targetsI.value.trim() !== (pg.targets || []).join(', ');
        if (payload.title === undefined && payload.desc === undefined && !kwChanged) { toast('Aucune modification à enregistrer.'); return; }
        saveBtn.disabled = true;
        var chain = Promise.resolve();
        if (kwChanged) chain = chain.then(function () { return api('PUT', '/seo/targets', { type: pg.type, slug: pg.slug, keywords: targetsI.value }); });
        if (payload.title !== undefined || payload.desc !== undefined) {
          chain = chain.then(function () { return api('PUT', '/seo/meta', payload); });
        }
        return chain.then(function () { toast('Enregistré' + (payload.title !== undefined || payload.desc !== undefined ? ' et site republié' : ''), 'ok'); close(true); return reloadAll(); }).catch(function (e) { saveBtn.disabled = false; throw e; });
      }) });
      function close(force) {
        if (force !== true && !ro && (titleI.value.trim() !== origT || descI.value.trim() !== origD) && !window.confirm('Abandonner les modifications non enregistrées ?')) return;
        document.removeEventListener('keydown', onKey); bg.remove();
      }
      function onKey(e) { if (e.key === 'Escape') close(); }
      document.addEventListener('keydown', onKey);
      bg.addEventListener('click', function (e) { if (e.target === bg) close(); });
      var panel = h('aside', { 'class': 'sx-drawer', role: 'dialog', 'aria-label': 'Optimiser ' + pg.name },
        h('header', null, h('div', null, h('p', { 'class': 'sx-kicker dark', text: pg.type === 'home' ? 'Accueil' : pg.type === 'case' ? 'Étude de cas' : pg.type === 'article' ? 'Article' : 'Page' }), h('h3', { text: pg.name }),
          h('a', { href: pg.path, target: '_blank', rel: 'noopener', text: pg.path + ' ↗' })), h('div', { 'class': 'sx-dr-score' }, scoreBadge(pg.score), h('button', { type: 'button', 'class': 'btn btn-sm', text: 'Fermer', onclick: function () { close(); } }))),
        h('div', { 'class': 'sx-dr-body' },
          h('div', { 'class': 'sx-dr-sec' }, h('div', { 'class': 'sx-dr-row' }, h('h4', { text: 'Aperçu Google' }), mtog), serp),
          ro ? h('div', { 'class': 'note warn', text: 'Sur cette page, le titre et la description viennent du contenu. Modifiez le texte de la page pour les changer.' }) : null,
          h('div', { 'class': 'sx-dr-sec' },
            h('div', { 'class': 'sx-fl' }, h('label', { text: 'Titre' }), tCount), titleI, tBar, tNote,
            suggestBox('titre', pg.suggest.title, titleI, pg.title),
            h('div', { 'class': 'sx-fl', style: 'margin-top:14px' }, h('label', { text: 'Description' }), dCount), descI, dBar, dNote,
            suggestBox('description', pg.suggest.desc, descI, pg.desc),
            ro ? null : h('p', { 'class': 'nv-help', text: 'Astuce : videz un champ puis enregistrez pour retrouver le texte généré automatiquement.' })),
          issuesEl, tgtEl, tipsEl, kwEl, h('div', { 'class': 'sx-dr-sec' }, h('h4', { text: 'En bref' }), stats)),
        h('footer', null, saveBtn, h('a', { 'class': 'btn', href: pg.editUrl, text: 'Ouvrir la page dans l’éditeur →', onclick: function () { document.removeEventListener('keydown', onKey); bg.remove(); } })));
      bg.appendChild(panel); document.body.appendChild(bg);
      refresh();
      titleI.focus();
    }

    /* ====================================================================
       AUDIT
       ==================================================================== */
    var SITE_ACT = {
      site_url: ['Ouvrir les réglages', '#/settings'], site_https: ['Ouvrir les réglages', '#/settings'],
      redir_loop: ['Voir les redirections', 'tab:redirects'], redir_chain: ['Voir les redirections', 'tab:redirects'], redir_broken: ['Voir les redirections', 'tab:redirects'],
      unhandled_404: ['Voir les pages introuvables', 'tab:404']
    };
    function actLink(label, target) {
      return target.indexOf('tab:') === 0 ? btn(label, 'btn-sm', function () { goTab(target.slice(4)); }) : h('a', { 'class': 'btn btn-sm', href: target, text: label });
    }
    function renderAudit() {
      return getRep().then(function (rep) {
        clear(body);
        var box = h('div', { 'class': 'sx-grps' });
        function draw() {
          clear(box);
          var q = ui.auditQ.toLowerCase();
          var items = rep.issues.filter(function (i) {
            if (ui.auditSev !== 'all' && i.severity !== ui.auditSev) return false;
            if (ui.auditCat !== 'all' && i.cat !== ui.auditCat) return false;
            if (ui.auditCode && i.code !== ui.auditCode) return false;
            return !q || (i.message + ' ' + i.path + ' ' + i.page + ' ' + i.title).toLowerCase().indexOf(q) >= 0;
          });
          if (!items.length) { box.appendChild(empty(rep.issues.length ? 'Rien pour ce filtre.' : 'Rien à corriger.', '✓')); return; }
          var groups = {}, order = [];
          items.forEach(function (i) { if (!groups[i.code]) { groups[i.code] = []; order.push(i.code); } groups[i.code].push(i); });
          var rank = { high: 0, med: 1, low: 2 };
          order.sort(function (a, b) { return rank[groups[a][0].severity] - rank[groups[b][0].severity] || groups[b].length - groups[a].length; });
          order.forEach(function (code, idx) {
            var g = groups[code], f = g[0];
            var fixable = g.filter(function (i) { return i.fix; });
            var det = h('details', { 'class': 'sx-grp ' + f.severity });
            if (ui.auditCode === code || (!ui.auditCode && idx === 0 && order.length < 6) || order.length === 1) det.open = true;
            det.appendChild(h('summary', null,
              h('span', { 'class': 'sx-grp-dot' }),
              h('span', { 'class': 'sx-grp-t' }, h('b', { text: f.title }), h('small', { text: f.tip })),
              h('span', { 'class': 'sx-grp-n', text: String(g.length) }),
              fixable.length ? h('button', { type: 'button', 'class': 'btn btn-sm btn-primary', text: 'Corriger (' + fixable.length + ')', onclick: function (e) { e.preventDefault(); e.stopPropagation(); fixModal(fixable, rep, f.title); } }) : null));
            var list = h('div', { 'class': 'sx-grp-b' });
            g.forEach(function (i) {
              var pg = pageByKey(rep, i.pageKey);
              var acts = h('div', { 'class': 'sx-ir-a' });
              if (i.fix) acts.appendChild(btn('Appliquer', 'btn-sm btn-primary', guard(function () { return applyFixes([i.id]); })));
              if (i.redirect) acts.appendChild(btn('Rediriger vers ' + i.redirect.to, 'btn-sm' + (i.fix ? '' : ' btn-primary'), guard(function () { return createRedirect(i.redirect.from, i.redirect.to); }), 'Confiance ' + i.redirect.confidence + ' %'));
              else if (i.code === 'broken_link') acts.appendChild(btn('Créer une redirection', 'btn-sm', function () { ui.prefill = { from: i.target, to: '' }; goTab('redirects'); }));
              if (pg) acts.appendChild(btn('Optimiser', 'btn-sm', function () { openDrawer(pg, rep); }));
              if (!pg && SITE_ACT[i.code]) acts.appendChild(actLink(SITE_ACT[i.code][0], SITE_ACT[i.code][1]));
              if (pg && !pg.editable) acts.appendChild(h('a', { 'class': 'btn btn-sm', href: pg.editUrl, text: 'Ouvrir' }));
              list.appendChild(h('div', { 'class': 'sx-ir' },
                h('div', { 'class': 'sx-ir-m' }, h('div', { 'class': 'sx-ir-p' }, h('b', { text: i.page }), h('code', { text: i.path })), h('p', { text: i.message }),
                  i.fix ? h('div', { 'class': 'sx-ir-fix' }, h('span', { text: 'Proposition : ' }), h('em', { text: i.fix.value })) : null,
                  i.redirect ? h('div', { 'class': 'sx-ir-fix' }, h('span', { text: 'Page proche : ' }), h('em', { text: i.redirect.label + ' (' + i.redirect.to + ') · ' + i.redirect.confidence + ' %' })) : null),
                acts));
            });
            det.appendChild(list); box.appendChild(det);
          });
        }
        var cats = [['all', 'Toutes les catégories']].concat(Object.keys(rep.categories).map(function (k) { return [k, rep.categories[k].label]; }));
        var catSel = h('select', { 'class': 'sx-sel', 'aria-label': 'Domaine' });
        cats.forEach(function (c) { var o = h('option', { text: c[1] }); o.value = c[0]; catSel.appendChild(o); });
        catSel.value = ui.auditCat;
        catSel.addEventListener('change', function () { ui.auditCat = catSel.value; ui.auditCode = ''; draw(); });
        var sevChips = chips([['all', 'Tous (' + rep.issues.length + ')'], ['high', 'Urgents (' + rep.counts.high + ')'], ['med', 'À améliorer (' + rep.counts.med + ')'], ['low', 'Secondaires (' + rep.counts.low + ')']], ui.auditSev, function (v) { ui.auditSev = v; ui.auditCode = ''; renderAudit(); });
        var filterNote = ui.auditCode ? h('div', { 'class': 'sx-fnote' }, h('span', { text: 'Filtre : ' + (rep.issues.filter(function (i) { return i.code === ui.auditCode; })[0] || { title: ui.auditCode }).title }), btn('Tout afficher', 'btn-sm', function () { ui.auditCode = ''; renderAudit(); })) : null;
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'À corriger' }), h('p', { text: 'Dernière lecture · ' + fmtDate(rep.at) })),
          h('div', { 'class': 'sx-toolbar' }, searchBox(ui.auditQ, 'Chercher une page ou un point…', function (v) { ui.auditQ = v; draw(); }), catSel, btn('Relire', 'btn-sm', guard(function () { return api('POST', '/seo/audit', {}).then(function () { toast('Lecture terminée', 'ok'); return reloadAll(); }); }))),
          sevChips, filterNote, box));
        draw();
      });
    }

    /* ====================================================================
       404
       ==================================================================== */
    function render404() {
      return get404().then(function (items) {
        clear(body);
        var todo = items.filter(function (x) { return !x.bot && !x.handled; });
        var bots = items.filter(function (x) { return x.bot; });
        var done = items.filter(function (x) { return x.handled && !x.bot; });
        var box = h('div');
        function draw() {
          clear(box);
          var q = ui.q404.toLowerCase();
          var src = ui.f404 === 'bots' ? bots : ui.f404 === 'done' ? done : todo;
          var list = src.filter(function (x) { return !q || x.path.toLowerCase().indexOf(q) >= 0; });
          if (!list.length) { box.appendChild(empty(ui.f404 === 'todo' ? 'Rien à traiter.' : 'Rien ici.', '✓')); return; }
          var tb = h('tbody');
          list.forEach(function (x) {
            var sug = x.suggestion;
            var acts = h('td', { 'class': 'act' });
            if (sug) acts.appendChild(btn('Rediriger → ' + sug.to, 'btn-sm btn-primary', guard(function () { return createRedirect(x.path, sug.to); })));
            if (!x.handled && !x.bot) acts.appendChild(btn('Autre cible…', 'btn-sm', function () { ui.prefill = { from: x.path, to: '' }; goTab('redirects'); }));
            acts.appendChild(btn('Ignorer', 'btn-sm', guard(function () { return api('DELETE', '/seo/404?path=' + encodeURIComponent(x.path)).then(function () { return reloadAll(); }); })));
            tb.appendChild(h('tr', null,
              h('td', null, h('code', { text: x.path }), x.suggestion ? h('div', { 'class': 'sx-sugline', text: 'Page proche : ' + x.suggestion.label + ' · ' + x.suggestion.confidence + ' %' }) : null),
              h('td', null, h('span', { 'class': 'pill ' + (x.priority === 'high' ? 'red' : x.priority === 'med' ? 'gold' : 'gray'), text: plural(x.count, 'visite', 'visites') })),
              h('td', { 'class': 'hide-s mute', text: fmtDate(x.last) }),
              acts));
          });
          box.appendChild(h('div', { 'class': 'sx-tbl-wrap' }, h('table', { 'class': 'sx-tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Adresse demandée' }), h('th', { text: 'Visites' }), h('th', { 'class': 'hide-s', text: 'Dernière fois' }), h('th', { text: '' }))), tb)));
        }
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Pages introuvables' })),
          h('div', { 'class': 'sx-toolbar' },
            searchBox(ui.q404, 'Chercher une adresse…', function (v) { ui.q404 = v; draw(); }),
            chips([['todo', 'À traiter (' + todo.length + ')'], ['bots', 'Robots (' + bots.length + ')']].concat(done.length ? [['done', 'Déjà redirigées (' + done.length + ')']] : []), ui.f404, function (v) { ui.f404 = v; render404(); }),
            items.length ? btn('Tout effacer', 'btn-sm btn-danger', guard(function () {
              if (!window.confirm('Effacer la liste des pages introuvables ?')) return;
              return api('DELETE', '/seo/404').then(function () { toast('Liste effacée', 'ok'); return reloadAll(); });
            })) : null),
          box));
        draw();
      });
    }

    /* ====================================================================
       REDIRECTIONS
       ==================================================================== */
    function renderRedirects() {
      return getRed().then(function (items) {
        clear(body);
        var ed = ui.editing ? items.filter(function (r) { return r.id === ui.editing; })[0] : null;
        var pf = ui.prefill; ui.prefill = null;
        var fromI = h('input', { id: 'sx-from', type: 'text', 'class': 'sx-in', placeholder: '/ancienne-page' });
        var toI = h('input', { id: 'sx-to', type: 'text', 'class': 'sx-in', placeholder: '/nouvelle-page  ou  https://…' });
        var codeI = h('select', { 'class': 'sx-in' }, h('option', { value: '301', text: '301 — permanente (recommandée)' }), h('option', { value: '302', text: '302 — temporaire' }));
        var noteI = h('input', { type: 'text', 'class': 'sx-in', placeholder: 'Note interne (optionnel)' });
        if (ed) { fromI.value = ed.from; toI.value = ed.to; codeI.value = String(ed.code || 301); noteI.value = ed.note || ''; }
        else if (pf) { fromI.value = pf.from || ''; toI.value = pf.to || ''; }
        var submit = btn(ed ? 'Enregistrer les modifications' : 'Ajouter la redirection', 'btn-primary', guard(function () {
          var payload = { from: fromI.value, to: toI.value, code: +codeI.value, note: noteI.value };
          if (ed) { payload.enabled = ed.enabled; payload.hits = ed.hits; }
          return api(ed ? 'PUT' : 'POST', '/seo/redirects' + (ed ? '/' + ed.id : ''), payload).then(function (r) {
            ui.editing = null; ui.warnings = r.warnings || [];
            toast(ed ? 'Redirection mise à jour' : 'Redirection enregistrée', 'ok');
            return reloadAll();
          });
        }));
        var form = h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: ed ? 'Modifier la redirection' : 'Nouvelle redirection' })),
          h('div', { 'class': 'sx-form' },
            h('div', null, h('label', { 'class': 'nv-l', text: 'Ancienne adresse' }), fromI),
            h('div', null, h('label', { 'class': 'nv-l', text: 'Nouvelle adresse' }), toI),
            h('div', null, h('label', { 'class': 'nv-l', text: 'Type' }), codeI),
            h('div', null, h('label', { 'class': 'nv-l', text: 'Note' }), noteI)),
          h('div', { 'class': 'sx-form-a' }, submit, ed ? btn('Annuler', '', function () { ui.editing = null; render(); }) : btn(ui.showImport ? 'Masquer l’import' : 'Importer plusieurs…', '', function () { ui.showImport = !ui.showImport; render(); })));
        var pane = h('div', { 'class': 'sx-pane' });
        pane.appendChild(form);
        body.appendChild(pane);
        if (ui.warnings.length) {
          var wn = h('div', { 'class': 'note warn sx-warn' }, h('b', { text: 'Enregistrée, avec une réserve :' }), h('ul', null, ui.warnings.map(function (w) { return h('li', { text: w }); })), btn('Compris', 'btn-sm', function () { ui.warnings = []; wn.remove(); }));
          pane.appendChild(wn);
        }
        if (ui.showImport && !ed) {
          var ta = h('textarea', { 'class': 'sx-in', rows: '7', placeholder: '/ancienne-page-1 -> /nouvelle-page\n/ancien-blog/mon-article -> /insights/\n/old, /nouvelle' });
          var icode = h('select', { 'class': 'sx-in', style: 'max-width:260px' }, h('option', { value: '301', text: '301 — permanente' }), h('option', { value: '302', text: '302 — temporaire' }));
          var res = h('div');
          pane.appendChild(h('div', { 'class': 'sx-card' },
            h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Import' }), h('p', { text: 'Une ligne : ancienne -> nouvelle' })),
            ta, h('div', { 'class': 'sx-form-a' }, icode, btn('Importer', 'btn-primary', guard(function () {
              return api('POST', '/seo/redirects/import', { text: ta.value, code: +icode.value }).then(function (r) {
                clear(res);
                res.appendChild(h('div', { 'class': 'note ' + (r.errors.length ? 'warn' : 'good'), text: r.added + ' ajoutée(s), ' + r.skipped + ' ignorée(s) (déjà existantes), ' + r.errors.length + ' erreur(s).' }));
                if (r.errors.length) res.appendChild(h('ul', { 'class': 'sx-errs' }, r.errors.slice(0, 12).map(function (e) { return h('li', null, h('b', { text: 'Ligne ' + e.line + ' : ' }), e.msg); })));
                if (r.added) { bust(); refreshBadges(); setTimeout(function () { getRed().then(function () { ui.showImport = false; render(); }); }, 1600); }
              });
            }))), res));
        }
        var box = h('div');
        function draw() {
          clear(box);
          var q = ui.qRed.toLowerCase();
          var list = items.filter(function (r) { return !q || (r.from + ' ' + r.to + ' ' + (r.note || '')).toLowerCase().indexOf(q) >= 0; });
          if (!list.length) { box.appendChild(empty(items.length ? 'Aucune règle ne correspond.' : 'Pas encore de redirection.', '↪')); return; }
          var tb = h('tbody');
          list.forEach(function (r) {
            var off = r.enabled === false;
            tb.appendChild(h('tr', { 'class': off ? 'off' : '' },
              h('td', null, h('code', { text: r.from }), h('div', { 'class': 'sx-arrow', text: '→ ' + r.to }), r.note ? h('div', { 'class': 'sx-noteline', text: r.note }) : null),
              h('td', null, h('span', { 'class': 'pill', text: String(r.code || 301) })),
              h('td', null, off ? h('span', { 'class': 'pill gray', text: 'Désactivée' }) : h('span', { 'class': 'pill green', text: 'Active' })),
              h('td', { text: String(r.hits || 0) }),
              h('td', { 'class': 'hide-s mute', text: r.lastHit ? fmtDate(r.lastHit) : '—' }),
              h('td', { 'class': 'act' },
                btn('Tester', 'btn-sm', guard(function () {
                  return api('GET', '/seo/redirects/test?path=' + encodeURIComponent(r.from)).then(function (t) {
                    toast((t.steps.length ? t.steps.map(function (s) { return s.from; }).concat([t.final]).join(' → ') + ' · ' : '') + t.message, t.ok ? 'ok' : 'err');
                  });
                })),
                btn('Modifier', 'btn-sm', function () { ui.editing = r.id; render(); window.scrollTo(0, 0); }),
                btn(off ? 'Activer' : 'Désactiver', 'btn-sm', guard(function () {
                  return api('PUT', '/seo/redirects/' + r.id, { from: r.from, to: r.to, code: r.code, note: r.note, enabled: off, hits: r.hits }).then(function () { return reloadAll(); });
                })),
                btn('Supprimer', 'btn-sm btn-danger', guard(function () {
                  if (!window.confirm('Supprimer la redirection ' + r.from + ' ?')) return;
                  return api('DELETE', '/seo/redirects/' + r.id).then(function () { toast('Redirection supprimée', 'ok'); return reloadAll(); });
                })))));
          });
          box.appendChild(h('div', { 'class': 'sx-tbl-wrap' }, h('table', { 'class': 'sx-tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Règle' }), h('th', { text: 'Type' }), h('th', { text: 'État' }), h('th', { text: 'Visites' }), h('th', { 'class': 'hide-s', text: 'Dernier passage' }), h('th', { text: '' }))), tb)));
        }
        pane.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Liste (' + items.length + ')' }), btn(ui.showLog ? 'Masquer l’historique' : 'Historique', 'btn-sm', function () { ui.showLog = !ui.showLog; renderRedirects(); })),
          items.length > 5 ? h('div', { 'class': 'sx-toolbar' }, searchBox(ui.qRed, 'Chercher…', function (v) { ui.qRed = v; draw(); })) : null, box));
        draw();
        if (ui.showLog) {
          getRedLog().then(function (log) {
            var logBox = h('div', { 'class': 'sx-card' }, h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Historique' })));
            if (!log.length) logBox.appendChild(empty('Pas d’historique.', '⏱'));
            else {
              var tb2 = h('tbody');
              var LAB = { create: 'Créée', update: 'Modifiée', delete: 'Supprimée', disable: 'Désactivée', enable: 'Réactivée', import: 'Importée' };
              log.slice(0, 80).forEach(function (e) {
                tb2.appendChild(h('tr', null,
                  h('td', { 'class': 'mute', text: fmtDate(e.at) }),
                  h('td', null, h('span', { 'class': 'pill gray', text: LAB[e.action] || e.action })),
                  h('td', null, h('code', { text: e.from || '—' }), h('div', { 'class': 'sx-arrow', text: '→ ' + (e.to || '—') })),
                  h('td', { text: String(e.code || '') })));
              });
              logBox.appendChild(h('div', { 'class': 'sx-tbl-wrap' }, h('table', { 'class': 'sx-tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Quand' }), h('th', { text: 'Action' }), h('th', { text: 'Règle' }), h('th', { text: 'Code' }))), tb2)));
            }
            pane.appendChild(logBox);
          });
        }
        if (pf && pf.from && !pf.to) setTimeout(function () { toI.focus(); }, 60);
      });
    }

    /* ====================================================================
       RAPPORT
       ==================================================================== */
    var CODE_T = {
      title_missing: 'Titre SEO manquant', title_long: 'Titre trop long', title_short: 'Titre trop court',
      desc_missing: 'Description manquante', desc_long: 'Description trop longue', desc_short: 'Description trop courte',
      dup_title: 'Titre dupliqué', dup_desc: 'Description dupliquée'
    };
    function fieldLabel(f) {
      return f === 'title' ? 'Titre' : f === 'desc' ? 'Description' : (f || 'Champ');
    }
    function codeLabel(code, field) {
      if (code && CODE_T[code]) return CODE_T[code];
      if (field === 'title') return 'Correction de titre';
      if (field === 'desc') return 'Correction de description';
      return 'Correction';
    }
    function groupFixes(items) {
      var order = [];
      var map = {};
      (items || []).forEach(function (f) {
        var key = f.path || f.page || '?';
        if (!map[key]) {
          map[key] = { key: key, page: f.page || key, path: f.path || '', items: [], at: f.at };
          order.push(map[key]);
        }
        map[key].items.push(f);
        if (String(f.at || '') > String(map[key].at || '')) map[key].at = f.at;
      });
      return order;
    }
    function openFixGroup(g) {
      var m;
      var blocks = h('div', { 'class': 'sx-fixdetail' },
        h('div', { 'class': 'sx-di' }, h('span', { text: 'Page' }), h('div', null,
          h('b', { text: g.page || '—' }),
          g.path ? h('div', null, h('code', { text: g.path })) : null,
          g.path ? h('div', { style: 'margin-top:8px' }, h('a', { href: g.path, target: '_blank', rel: 'noopener', text: 'Voir la page ↗' })) : null)));
      g.items.forEach(function (f, i) {
        blocks.appendChild(h('div', { 'class': 'sx-fixblock' },
          h('div', { 'class': 'sx-fixblock-h' },
            h('b', { text: codeLabel(f.code, f.field) }),
            h('span', { 'class': 'mute', text: fieldLabel(f.field) + ' · ' + fmtDate(f.at) })),
          h('div', { 'class': 'sx-old', text: f.before || '(vide)' }),
          h('div', { 'class': 'sx-new', text: f.after || '—' })));
      });
      m = modal(g.items.length > 1 ? (g.page + ' — ' + g.items.length + ' corrections') : 'Détail de la correction', blocks,
        [g.path ? h('a', { 'class': 'btn', href: g.path, target: '_blank', rel: 'noopener', text: 'Ouvrir la page' }) : null,
          btn('Fermer', 'btn-primary', function () { m.close(); })], true);
    }
    function renderReport() {
      return getReport().then(function (r) {
        clear(body);
        var delta = r.evolution.delta;
        var deltaTxt = delta == null ? '—' : (delta > 0 ? '+' : '') + delta + ' pts';
        var pane = h('div', { 'class': 'sx-pane sx-bilan' });

        var more = h('details', { 'class': 'sx-export-more' },
          h('summary', { text: 'Autres exports' }),
          h('div', { 'class': 'sx-export-more-b' },
            btn('Points', 'btn-sm', guard(function () { return downloadExport('issues'); })),
            btn('Pages', 'btn-sm', guard(function () { return downloadExport('pages'); })),
            btn('404', 'btn-sm', guard(function () { return downloadExport('404'); })),
            btn('Redirections', 'btn-sm', guard(function () { return downloadExport('redirects'); })),
            btn('Corrections', 'btn-sm', guard(function () { return downloadExport('fixes'); }))));

        var head = h('div', { 'class': 'sx-card' });
        head.appendChild(h('div', { 'class': 'sx-card-h sx-bilan-top' },
          h('div', null,
            h('h3', { text: 'Bilan du mois' }),
            h('p', { text: r.month + ' · ' + fmtDate(r.at) })),
          h('div', { 'class': 'sx-form-a sx-bilan-exports' },
            btn('PDF', 'btn-primary btn-sm', function () { window.open('/api/seo/report.html', '_blank'); }),
            btn('Bilan CSV', 'btn-sm', guard(function () { return downloadExport('report'); })),
            more)));
        head.appendChild(h('div', { 'class': 'sx-kpis sx-kpis-4' },
          h('div', { 'class': 'sx-kpi' }, h('b', { text: String(r.score) }), h('span', { text: 'Note' }), h('small', { text: r.grade })),
          h('div', { 'class': 'sx-kpi ' + (delta > 0 ? 'good' : delta < 0 ? 'bad' : '') }, h('b', { text: deltaTxt }), h('span', { text: 'Évolution' }), h('small', { text: r.evolution.start != null ? ('Départ ' + r.evolution.start) : 'Premier point' })),
          h('div', { 'class': 'sx-kpi good' }, h('b', { text: String(r.fixed.month) }), h('span', { text: 'Corrigé' }), h('small', { text: r.fixed.total + ' au total' })),
          h('div', { 'class': 'sx-kpi ' + (r.remaining.high ? 'bad' : 'good') }, h('b', { text: String(r.remaining.total) }), h('span', { text: 'Ouvert' }), h('small', { text: r.remaining.high ? (r.remaining.high + ' urgent(s)') : 'Aucun urgent' }))));
        head.appendChild(h('p', { 'class': 'sx-bilan-meta', text: r.indexable.yes + ' pages visibles · ' + r.errors404 + ' introuvable(s) · ' + r.redirectsEnabled + ' redirection(s)' }));
        pane.appendChild(head);

        var top = (r.remaining.byCode || []).slice(0, 3);
        var rest = h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' },
            h('h3', { text: 'Ce qui reste' }),
            r.remaining.total
              ? btn('Ouvrir À corriger', 'btn-sm', function () { ui.auditCode = ''; ui.auditSev = 'all'; goTab('audit'); })
              : null));
        if (!r.remaining.byCode.length) rest.appendChild(empty('Rien à corriger.', '★'));
        else {
          rest.appendChild(h('p', { 'class': 'sx-bilan-sum', text:
            (r.remaining.high ? r.remaining.high + ' urgent' + (r.remaining.high > 1 ? 's' : '') : '0 urgent') +
            ' · ' + (r.remaining.med || 0) + ' à améliorer · ' + (r.remaining.low || 0) + ' secondaire' + ((r.remaining.low || 0) > 1 ? 's' : '')
          }));
          top.forEach(function (x, i) {
            rest.appendChild(h('div', { 'class': 'sx-act' },
              h('span', { 'class': 'sx-act-n', text: String(i + 1) }),
              h('div', { 'class': 'sx-act-main' },
                h('div', { 'class': 'sx-act-t' },
                  h('b', { text: x.title }),
                  sevPill(x.severity),
                  h('small', { 'class': 'sx-act-c', text: plural(x.count, 'cas', 'cas') }))),
              h('div', { 'class': 'sx-act-b' }, btn('Voir', 'btn-sm', function () {
                ui.auditCode = x.code; ui.auditSev = 'all'; goTab('audit');
              }))));
          });
          if (r.remaining.byCode.length > 3) {
            rest.appendChild(h('p', { 'class': 'sx-more', text: '+' + (r.remaining.byCode.length - 3) + ' autres types — voir « À corriger »' }));
          }
        }
        pane.appendChild(rest);

        var groups = groupFixes(r.fixed.recent).slice(0, 10);
        var fixes = h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' },
            h('h3', { text: 'Dernières corrections' }),
            h('p', { text: r.fixed.month ? r.fixed.month + ' ce mois' : 'Aucune ce mois' })));
        if (!groups.length) fixes.appendChild(empty('Pas encore de correction.', '✓'));
        else {
          var list = h('div', { 'class': 'sx-fixlog' });
          groups.forEach(function (g) {
            var fields = g.items.map(function (f) { return fieldLabel(f.field); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
            var row = h('button', { type: 'button', 'class': 'sx-fixlog-row' },
              h('div', { 'class': 'sx-fixlog-m' },
                h('b', { text: g.page || g.path || '—' }),
                h('span', { text: plural(g.items.length, 'correction', 'corrections') + ' · ' + fields + ' · ' + fmtDate(g.at) })),
              h('span', { 'class': 'sx-chev', text: '›' }));
            row.addEventListener('click', function () { openFixGroup(g); });
            list.appendChild(row);
          });
          fixes.appendChild(list);
          var totalGroups = groupFixes(r.fixed.recent).length;
          if (totalGroups > 10) {
            fixes.appendChild(h('p', { 'class': 'sx-more', text: '+' + (totalGroups - 10) + ' pages — export Corrections CSV' }));
          }
        }
        pane.appendChild(fixes);

        body.appendChild(pane);
      });
    }

    /* ====================================================================
       TECHNIQUE
       ==================================================================== */
    function renderTech() {
      return Promise.all([getOv(), getRep()]).then(function (res) {
        var o = res[0];
        clear(body);
        var grid = h('div', { 'class': 'sx-techgrid' });
        o.tech.forEach(function (t) {
          grid.appendChild(h('div', { 'class': 'sx-tcard ' + t.status }, h('i', { text: t.status === 'ok' ? '✓' : t.status === 'warn' ? '!' : '✕' }), h('div', null, h('b', { text: t.label }), h('p', { text: t.detail }))));
        });
        var site = (o.siteUrl || location.origin).replace(/\/$/, '');
        var enc = encodeURIComponent(site + '/');
        var link = function (t, d, href) { return h('a', { 'class': 'sx-res', href: href, target: '_blank', rel: 'noopener' }, h('b', { text: t + ' ↗' }), h('span', { text: d })); };
        var links = h('div', { 'class': 'sx-reslist' },
          link('Plan du site', 'Liste des pages envoyées à Google', '/sitemap.xml'),
          link('robots.txt', 'Ce que les robots ont le droit de lire', '/robots.txt'),
          link('Google Search Console', 'Clics, impressions, erreurs', 'https://search.google.com/search-console'),
          link('PageSpeed Insights', 'Vitesse de la page d’accueil', 'https://pagespeed.web.dev/analysis?url=' + enc),
          link('Test des résultats enrichis', 'Vérifier les infos structurées', 'https://search.google.com/test/rich-results?url=' + enc));
        var republish = btn('Republier maintenant', 'btn-primary', guard(function () {
          return api('POST', '/publish', {}).then(function (r) { toast('Site republié (' + r.pages + ' pages)', 'ok'); return reloadAll(); });
        }));
        body.appendChild(h('div', { 'class': 'sx-pane' },
          h('div', { 'class': 'sx-card' }, h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Bases techniques' })), grid),
          h('div', { 'class': 'sx-card' }, h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Liens utiles' })), links),
          h('div', { 'class': 'sx-card' }, h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Republier' }), h('p', { text: 'Pages, plan du site, robots.txt' })), republish)));
      });
    }

    /* ---------- rendu ---------- */
    function refreshBadges() {
      return getOv().then(function (o) {
        var set = function (name, n, warn) {
          var b = tabsEl.querySelector('[data-tab="' + name + '"]'); if (!b) return;
          var s = b.querySelector('.sx-badge'); if (s) s.remove();
          if (n) b.appendChild(h('span', { 'class': 'sx-badge' + (warn ? ' warn' : ''), text: String(n) }));
        };
        set('audit', o.totals.issues, o.counts.high > 0);
        set('404', o.errors404, true);
      }).catch(function () { /* badges facultatifs */ });
    }
    var seq = 0;
    function render() {
      var mine = ++seq;
      var y = window.pageYOffset;
      clear(body);
      body.appendChild(h('div', { 'class': 'sx-loading' }, h('span', { 'class': 'sx-spin' }), h('p', { text: 'Lecture du site…' })));
      var fn = tab === 'pages' ? renderPages : tab === 'audit' ? renderAudit : tab === '404' ? render404 : tab === 'redirects' ? renderRedirects : tab === 'report' ? renderReport : tab === 'tech' ? renderTech : renderOverview;
      return fn().then(function () { if (mine === seq) window.scrollTo(0, y); }).catch(function (e) {
        if (mine !== seq) return;
        clear(body); body.appendChild(h('div', { 'class': 'note bad', text: 'Impossible d’ouvrir cet écran : ' + (e.message || e) }));
      });
    }

    TABS.forEach(function (t) {
      tabsEl.appendChild(h('button', { type: 'button', role: 'tab', 'data-tab': t[0], 'aria-selected': t[0] === tab ? 'true' : 'false', 'class': t[0] === tab ? 'on' : '', text: t[1], onclick: function () { goTab(t[0]); } }));
    });
    root.appendChild(h('div', { 'class': 'sx-top' }, tabsEl));
    root.appendChild(body);
    render();
    refreshBadges();
    return { title: 'SEO', el: root };
  };
})();
