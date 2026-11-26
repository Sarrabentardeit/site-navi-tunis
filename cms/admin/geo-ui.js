/* Back-office Navitrends — écran GEO. Chargé avant admin.js. */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  window.NVGeo = function (H) {
    var h = H.h, clear = H.clear, api = H.api, toast = H.toast, guard = H.guard, fmtDate = H.fmtDate, go = H.go;
    var root = h('div', { 'class': 'sx gx' });
    var body = h('div', { 'class': 'sx-body' });
    var tabsEl = h('div', { 'class': 'sx-tabs', role: 'tablist' });
    var cache = null;
    var tab = 'overview';
    var TABS = [
      ['overview', 'Vue d’ensemble'],
      ['content', 'Pages claires'],
      ['schema', 'Infos société'],
      ['bots', 'Accès robots'],
      ['llms', 'Fichier résumé']
    ];

    function bust() { cache = null; }
    function getOv() {
      if (cache) return cache;
      cache = api('GET', '/geo/overview');
      cache.catch(function () { cache = null; });
      return cache;
    }
    function reload() { bust(); return render(); }
    function btn(label, cls, fn) { return h('button', { type: 'button', 'class': 'btn ' + (cls || ''), text: label, onclick: fn }); }
    function empty(msg, icon) { return h('div', { 'class': 'sx-empty' }, h('div', { 'class': 'sx-empty-i', text: icon || '✓' }), h('p', { text: msg })); }
    function colorOf(s) { return s >= 90 ? '#18a874' : s >= 75 ? '#3b6fd9' : s >= 55 ? '#e0a512' : '#d64545'; }
    function clsOf(s) { return s >= 90 ? 'g' : s >= 75 ? 'b' : s >= 55 ? 'y' : 'r'; }
    function bar(score) { return h('span', { 'class': 'sx-bar' }, h('i', { 'class': clsOf(score), style: 'width:' + Math.max(3, score) + '%' })); }
    function scoreBadge(s) { return h('span', { 'class': 'sx-sb ' + clsOf(s), text: String(s) }); }
    function goTab(name) {
      tab = name;
      Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (b) {
        var on = b.getAttribute('data-tab') === name;
        b.className = on ? 'on' : '';
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      return render();
    }
    function scoreRing(score, size) {
      var r = 66, c = 2 * Math.PI * r, col = colorOf(score);
      var arc = document.createElementNS(NS, 'circle');
      arc.setAttribute('cx', '80'); arc.setAttribute('cy', '80'); arc.setAttribute('r', String(r));
      arc.setAttribute('fill', 'none'); arc.setAttribute('stroke', col); arc.setAttribute('stroke-width', '13');
      arc.setAttribute('stroke-linecap', 'round'); arc.setAttribute('transform', 'rotate(-90 80 80)');
      arc.setAttribute('stroke-dasharray', '0 ' + c); arc.setAttribute('class', 'sx-ring-arc');
      var s = document.createElementNS(NS, 'svg');
      s.setAttribute('viewBox', '0 0 160 160'); s.setAttribute('width', String(size)); s.setAttribute('height', String(size));
      var bg = document.createElementNS(NS, 'circle');
      bg.setAttribute('cx', '80'); bg.setAttribute('cy', '80'); bg.setAttribute('r', String(r));
      bg.setAttribute('fill', 'none'); bg.setAttribute('stroke', 'rgba(255,255,255,.14)'); bg.setAttribute('stroke-width', '13');
      var t = document.createElementNS(NS, 'text'); t.setAttribute('x', '80'); t.setAttribute('y', '84'); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'sx-ring-n'); t.textContent = String(score);
      var t2 = document.createElementNS(NS, 'text'); t2.setAttribute('x', '80'); t2.setAttribute('y', '106'); t2.setAttribute('text-anchor', 'middle'); t2.setAttribute('class', 'sx-ring-s'); t2.textContent = 'sur 100';
      s.appendChild(bg); s.appendChild(arc); s.appendChild(t); s.appendChild(t2);
      requestAnimationFrame(function () { requestAnimationFrame(function () { arc.setAttribute('stroke-dasharray', (c * score / 100) + ' ' + c); }); });
      return s;
    }

    function renderOverview() {
      return getOv().then(function (o) {
        clear(body);
        var open = o.actions.length;
        var hero = h('section', { 'class': 'sx-hero' },
          h('div', { 'class': 'sx-hero-ring' }, scoreRing(o.score, 148)),
          h('div', { 'class': 'sx-hero-main' },
            h('p', { 'class': 'sx-kicker', text: 'Présentation' }),
            h('h2', { text: o.grade }),
            h('p', { 'class': 'sx-hero-sub', text: o.totals.pages + ' pages · ' + o.totals.answerReady + ' claires' + (open ? ' · ' + open + ' à faire' : '') }),
            h('div', { 'class': 'sx-hero-meta' }, h('span', { text: 'Dernière lecture · ' + fmtDate(o.at) })),
            h('div', { 'class': 'sx-hero-acts' },
              btn('Relire le site', 'btn-gold', guard(function () { bust(); return reload().then(function () { toast('Lecture terminée', 'ok'); }); })),
              btn('SEO', 'sx-ghost', function () { go('/seo'); }))),
          h('div', { 'class': 'sx-hero-spark' },
            h('p', { 'class': 'sx-kicker', text: 'Société' }),
            h('p', { 'class': 'gx-note', text: (o.entity.name || 'Navitrends') + (o.entity.desc ? ' · fiche OK' : ' · fiche à compléter') })));
        body.appendChild(hero);

        var kpi = function (n, label, sub, to, tone) {
          return h('button', { type: 'button', 'class': 'sx-kpi ' + (tone || ''), onclick: to }, h('b', { text: String(n) }), h('span', { text: label }), h('small', { text: sub }));
        };
        body.appendChild(h('div', { 'class': 'sx-kpis sx-kpis-4' },
          kpi(o.totals.citeStrong, 'Très solides', 'Bien structurées', function () { goTab('content'); }, 'good'),
          kpi(o.totals.answerReady, 'Pages claires', 'Sur ' + o.totals.pages, function () { goTab('content'); }),
          kpi(open, 'À faire', open ? 'Points ouverts' : 'Rien d’urgent', function () {
            goTab(o.actions[0] ? (o.actions[0].tab === 'entity' ? 'schema' : o.actions[0].tab) : 'overview');
          }, open ? 'warn' : 'good'),
          kpi(o.llms.published ? 'Oui' : 'Non', 'Résumé', o.llms.published ? 'En ligne' : 'À créer', function () { goTab('llms'); }, o.llms.published ? 'good' : 'warn')));

        var plan = h('div', { 'class': 'sx-card sx-plan' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'À faire en premier' })));
        if (!o.actions.length) plan.appendChild(empty('Rien à signaler.', '★'));
        o.actions.forEach(function (a, i) {
          var dest = a.tab === 'entity' ? 'schema' : a.tab;
          plan.appendChild(h('div', { 'class': 'sx-act', title: a.tip || '' },
            h('span', { 'class': 'sx-act-n', text: String(i + 1) }),
            h('div', { 'class': 'sx-act-main' },
              h('div', { 'class': 'sx-act-t' }, h('b', { text: a.title }), h('span', { 'class': 'sx-gain', text: '+' + a.gain + ' pts' }))),
            h('div', { 'class': 'sx-act-b' }, btn('Voir', 'btn-sm', function () { goTab(dest); }, a.tip || ''))));
        });

        var cats = h('div', { 'class': 'sx-cats' });
        Object.keys(o.categories).forEach(function (k) {
          var c = o.categories[k];
          cats.appendChild(h('button', { type: 'button', 'class': 'sx-cat', onclick: function () {
            goTab(k === 'entity' || k === 'schema' ? 'schema' : k === 'crawl' ? 'bots' : k === 'llms' ? 'llms' : 'content');
          } }, h('span', { 'class': 'sx-cat-l', text: c.label }), bar(c.score), h('b', { 'class': clsOf(c.score), text: String(c.score) })));
        });
        plan.appendChild(h('div', { 'class': 'sx-plan-cats' },
          h('p', { 'class': 'sx-plan-cats-l', text: 'Par domaine' }),
          cats));
        body.appendChild(plan);
      });
    }

    function renderContent() {
      return getOv().then(function (o) {
        clear(body);
        var list = h('div', { 'class': 'sx-plist' });
        list.appendChild(h('div', { 'class': 'sx-prow head' },
          h('span', { text: 'Note' }), h('span', { text: 'Page' }), h('span', { 'class': 'c', text: 'Mots' }),
          h('span', { 'class': 'c', text: 'H2' }), h('span', { 'class': 'c hide-s', text: 'Infos' }),
          h('span', { 'class': 'c', text: 'État' }), h('span')));
        o.pages.forEach(function (p) {
          list.appendChild(h('div', { 'class': 'sx-prow' },
            scoreBadge(p.cite),
            h('span', { 'class': 'sx-pname' }, h('b', { text: p.name }), h('code', { text: p.path })),
            h('span', { 'class': 'c', text: String(p.words) }),
            h('span', { 'class': 'c', text: String(p.h2) }),
            h('span', { 'class': 'c hide-s', text: (p.types || []).slice(0, 3).join(', ') || '—' }),
            h('span', { 'class': 'c' }, p.answerReady ? h('span', { 'class': 'sx-ok', text: 'Claire' }) : h('span', { 'class': 'pill gold', text: 'À enrichir' })),
            h('a', { 'class': 'sx-chev', href: p.path, target: '_blank', rel: 'noopener', text: '›', title: 'Ouvrir' })));
        });
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Pages claires' })),
          list));
      });
    }

    function renderSchema() {
      return getOv().then(function (o) {
        clear(body);
        var types = Object.keys(o.schema.types).sort(function (a, b) { return o.schema.types[b] - o.schema.types[a]; });
        var labels = {
          Organization: 'Société', WebSite: 'Site web', BreadcrumbList: 'Fil d’Ariane',
          FAQPage: 'FAQ', Article: 'Article', Service: 'Service', WebPage: 'Page web'
        };
        var grid = h('div', { 'class': 'sx-techgrid' });
        [['Organization', !!o.schema.types.Organization], ['WebSite', !!o.schema.types.WebSite], ['BreadcrumbList', !!o.schema.types.BreadcrumbList], ['FAQPage', o.schema.withFaq > 0], ['Article', o.schema.withArticle > 0]].forEach(function (row) {
          grid.appendChild(h('div', { 'class': 'sx-tcard ' + (row[1] ? 'ok' : 'warn') },
            h('i', { text: row[1] ? '✓' : '!' }),
            h('div', null, h('b', { text: labels[row[0]] || row[0] }), h('p', { text: row[1] ? 'Trouvé sur le site' : 'Pas encore détecté' }))));
        });
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Infos société' })), grid));

        var tb = h('tbody');
        types.forEach(function (t) {
          tb.appendChild(h('tr', null, h('td', null, h('b', { text: labels[t] || t })), h('td', { text: String(o.schema.types[t]) + ' page(s)' })));
        });
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Détail' })),
          types.length
            ? h('table', { 'class': 'tbl sx-tbl' }, h('thead', null, h('tr', null, h('th', { text: 'Type' }), h('th', { text: 'Présence' }))), tb)
            : empty('Rien détecté. Republiez le site.', '!')));

        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Présentation' })),
          h('p', { text: o.entity.pitch || 'Ajoutez une description dans les Réglages.' }),
          h('div', { 'class': 'sx-form-a' },
            btn('Réglages', 'btn-primary', function () { go('/settings'); }),
            h('a', { 'class': 'btn', href: 'https://search.google.com/test/rich-results', target: '_blank', rel: 'noopener', text: 'Tester Google ↗' }))));
      });
    }

    function renderBots() {
      return getOv().then(function (o) {
        clear(body);
        var allow = h('label', { 'class': 'gx-switch' });
        var cb = h('input', { type: 'checkbox' }); cb.checked = o.allowAi !== false;
        allow.appendChild(cb);
        allow.appendChild(h('span', { text: 'Laisser les robots des outils de réponse lire le site (recommandé)' }));
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Accès robots' }), h('p', { text: 'Décochez pour bloquer à la prochaine publication' })),
          allow,
          h('div', { 'class': 'sx-form-a', style: 'margin-top:12px' }, btn('Enregistrer et republier', 'btn-primary', guard(function () {
            return api('PUT', '/geo/llms', { allowAi: cb.checked }).then(function () {
              toast('Réglage enregistré, site republié', 'ok');
              return reload();
            });
          })))));

        var tb = h('tbody');
        o.bots.forEach(function (b) {
          tb.appendChild(h('tr', null,
            h('td', null, h('b', { text: b.label }), h('div', { 'class': 'mute', text: b.id })),
            h('td', null, h('span', { 'class': 'pill ' + (b.status === 'block' ? 'red' : b.status === 'allow' ? 'green' : 'gray'), text: b.status === 'block' ? 'Bloqué' : b.status === 'allow' ? 'Autorisé' : 'Inconnu' })),
            h('td', { text: b.detail }),
            h('td', { 'class': 'mute', text: b.note })));
        });
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'robots.txt' })),
          h('table', { 'class': 'tbl sx-tbl' },
            h('thead', null, h('tr', null, h('th', { text: 'Robot' }), h('th', { text: 'Accès' }), h('th', { text: 'Détail' }), h('th', { text: 'Rôle' }))), tb)));
      });
    }

    function renderLlms() {
      return getOv().then(function (o) {
        clear(body);
        var ta = h('textarea', { 'class': 'sx-in gx-llms', rows: '18' });
        ta.value = o.llms.draft || '';
        body.appendChild(h('div', { 'class': 'sx-card' },
          h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'Fichier résumé' }), h('p', { text: '/llms.txt' })),
          ta,
          h('div', { 'class': 'sx-form-a' },
            btn('Proposer un texte automatique', '', guard(function () {
              return api('POST', '/geo/llms/reset', {}).then(function (r) { ta.value = r.text; toast('Texte proposé — vous pouvez le modifier', 'ok'); });
            })),
            btn('Enregistrer et publier', 'btn-primary', guard(function () {
              return api('PUT', '/geo/llms', { text: ta.value, allowAi: o.allowAi !== false }).then(function () {
                toast('Résumé publié', 'ok');
                return reload();
              });
            })),
            o.llms.published ? h('a', { 'class': 'btn', href: '/llms.txt', target: '_blank', rel: 'noopener', text: 'Voir la version en ligne ↗' }) : null)));
        if (o.llms.live) {
          body.appendChild(h('div', { 'class': 'sx-card' },
            h('div', { 'class': 'sx-card-h' }, h('h3', { text: 'En ligne' })),
            h('pre', { 'class': 'gx-pre', text: o.llms.live.slice(0, 4000) })));
        }
      });
    }

    var seq = 0;
    function render() {
      var mine = ++seq;
      clear(body);
      body.appendChild(h('div', { 'class': 'sx-loading' }, h('span', { 'class': 'sx-spin' }), h('p', { text: 'Lecture du site…' })));
      var fn = tab === 'content' ? renderContent : tab === 'schema' ? renderSchema : tab === 'bots' ? renderBots : tab === 'llms' ? renderLlms : renderOverview;
      return fn().catch(function (e) {
        if (mine !== seq) return;
        clear(body);
        body.appendChild(h('div', { 'class': 'note bad', text: 'Impossible d’ouvrir cet écran : ' + (e.message || e) }));
      });
    }

    TABS.forEach(function (t) {
      tabsEl.appendChild(h('button', {
        type: 'button', role: 'tab', 'data-tab': t[0],
        'aria-selected': t[0] === tab ? 'true' : 'false',
        'class': t[0] === tab ? 'on' : '',
        text: t[1],
        onclick: function () { goTab(t[0]); }
      }));
    });
    root.appendChild(h('div', { 'class': 'sx-top' }, tabsEl));
    root.appendChild(body);
    render();
    return { title: 'GEO', el: root };
  };
})();
