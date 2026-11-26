/* Back-office Navitrends — Visibilité : GSC, positions, mots-clés, rapport. */
(function () {
  'use strict';

  window.NVVisibility = function (H) {
    var h = H.h, clear = H.clear, api = H.api, toast = H.toast, guard = H.guard, fmtDate = H.fmtDate, go = H.go;
    var root = h('div', { 'class': 'sx vx' });
    var body = h('div', { 'class': 'sx-body' });
    var tabsEl = h('div', { 'class': 'sx-tabs', role: 'tablist' });
    var cache = {};
    var tab = 'dashboard';
    var TABS = [
      ['dashboard', 'Tableau de bord'],
      ['gsc', 'Search Console'],
      ['ranks', 'Positions'],
      ['keywords', 'Mots-clés'],
      ['report', 'Rapport']
    ];

    function bust() { cache = {}; }
    function loader(key, path) {
      if (cache[key]) return cache[key];
      var p = api('GET', path);
      cache[key] = p;
      p.catch(function () { if (cache[key] === p) delete cache[key]; });
      return p;
    }
    function btn(label, cls, fn) {
      return h('button', { type: 'button', 'class': 'btn ' + (cls || ''), text: label, onclick: fn });
    }
    function goTab(name) {
      tab = name;
      Array.prototype.forEach.call(tabsEl.querySelectorAll('button'), function (b) {
        var on = b.getAttribute('data-tab') === name;
        b.className = on ? 'on' : '';
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      return render();
    }
    function card(title, sub, child) {
      var c = h('div', { 'class': 'sx-card' });
      if (title) c.appendChild(h('div', { 'class': 'sx-card-h' }, h('h3', { text: title }), sub ? h('p', { text: sub }) : null));
      if (child) c.appendChild(child);
      return c;
    }
    function row(title, tip, label, action) {
      return h('div', { 'class': 'vx-start' },
        h('div', { 'class': 'vx-start-t' }, h('b', { text: title }), h('p', { text: tip })),
        typeof action === 'string'
          ? h('a', { 'class': 'btn btn-sm', href: action, target: '_blank', rel: 'noopener', text: label })
          : btn(label, 'btn-sm', action));
    }
    function reload() { bust(); return render(); }
    function tbl(headers, rows) {
      var head = h('tr');
      headers.forEach(function (t) { head.appendChild(h('th', { text: t })); });
      var tb = h('tbody');
      rows.forEach(function (cols) {
        var tr = h('tr');
        cols.forEach(function (c) {
          tr.appendChild(typeof c === 'string' || typeof c === 'number' ? h('td', { text: String(c) }) : (c || h('td', { text: '—' })));
        });
        tb.appendChild(tr);
      });
      return h('div', { 'class': 'sx-tbl-wrap' }, h('table', { 'class': 'sx-tbl' }, h('thead', null, head), tb));
    }

    /* ========== DASHBOARD ========== */
    function renderDashboard() {
      return loader('ov', '/visibility/overview').then(function (o) {
        clear(body);
        body.appendChild(h('header', { 'class': 'vx-head' },
          h('h2', { text: 'Visibilité' }),
          h('p', { text: 'Search Console, positions et mots-clés de votre site — pour mesurer et prioriser.' })));

        var kpis = h('div', { 'class': 'sx-kpis sx-kpis-4' });
        kpis.appendChild(h('button', { type: 'button', 'class': 'sx-kpi', onclick: function () { go('/seo'); } },
          h('b', { text: String(o.seo.score) }), h('span', { text: 'Note SEO' }), h('small', { text: o.seo.grade || '' })));
        kpis.appendChild(h('button', { type: 'button', 'class': 'sx-kpi', onclick: function () { goTab('gsc'); } },
          h('b', { text: String(o.gsc.totals.clicks || 0) }), h('span', { text: 'Clics GSC' }), h('small', { text: o.gsc.at ? ('Import · ' + fmtDate(o.gsc.at)) : 'Pas encore importé' })));
        kpis.appendChild(h('button', { type: 'button', 'class': 'sx-kpi', onclick: function () { goTab('ranks'); } },
          h('b', { text: String(o.ranks.count) }), h('span', { text: 'Positions' }), h('small', { text: o.ranks.withPos + ' avec une note' })));
        kpis.appendChild(h('button', { type: 'button', 'class': 'sx-kpi', onclick: function () { goTab('keywords'); } },
          h('b', { text: String(o.keywords.keywords || 0) }), h('span', { text: 'Mots-clés site' }), h('small', { text: (o.keywords.pagesWithout || 0) + ' page(s) sans cible' })));
        body.appendChild(kpis);

        var next = h('div', { 'class': 'vx-starts' });
        next.appendChild(row('Importer Search Console', 'CSV Requêtes / Pages depuis Google.', 'Ouvrir GSC', function () { goTab('gsc'); }));
        next.appendChild(row('Suivre des positions', 'Jusqu’à 30 mots-clés Navitrends.', 'Positions', function () { goTab('ranks'); }));
        next.appendChild(row('Cibles des pages', 'Mots-clés déjà saisis dans le SEO.', 'Mots-clés', function () { goTab('keywords'); }));
        next.appendChild(row('Rapport mensuel', 'Score + GSC + positions pour la direction.', 'Rapport', function () { goTab('report'); }));
        body.appendChild(card('Pour avancer', null, next));
      });
    }

    /* ========== GSC ========== */
    function renderGsc() {
      return loader('gsc', '/visibility/gsc').then(function (g) {
        clear(body);
        var propI = h('input', { type: 'url', 'class': 'sx-in', placeholder: 'https://navitrends.com', value: g.property || '' });
        var kind = h('select', { 'class': 'sx-in', style: 'max-width:220px' },
          h('option', { value: 'queries', text: 'Export Requêtes' }),
          h('option', { value: 'pages', text: 'Export Pages' }));
        var ta = h('textarea', { 'class': 'sx-in', rows: '8', placeholder: 'Collez ici le CSV exporté depuis Search Console (Performances → Exporter → CSV).' });

        var form = h('div', { 'class': 'vx-gsc-form' });
        form.appendChild(h('div', null, h('label', { 'class': 'nv-l', text: 'Propriété (URL du site)' }), propI));
        form.appendChild(h('div', { 'class': 'sx-form-a', style: 'margin-top:10px' },
          btn('Enregistrer l’URL', 'btn-sm', guard(function () {
            return api('PUT', '/visibility/gsc', { property: propI.value }).then(function () {
              toast('Propriété enregistrée', 'ok'); bust(); return renderGsc();
            });
          })),
          h('a', { 'class': 'btn btn-sm', href: 'https://search.google.com/search-console', target: '_blank', rel: 'noopener', text: 'Ouvrir GSC ↗' })));
        form.appendChild(h('div', { style: 'margin-top:16px' }, h('label', { 'class': 'nv-l', text: 'Importer un CSV' }), kind, ta));
        var importRow = h('div', { 'class': 'sx-form-a' });
        importRow.appendChild(btn('Importer', 'btn-primary', guard(function () {
          return api('POST', '/visibility/gsc/import', { kind: kind.value, csv: ta.value, property: propI.value }).then(function (r) {
            toast(r.imported + ' ligne(s) importée(s)', 'ok'); bust(); return renderGsc();
          });
        })));
        form.appendChild(importRow);
        body.appendChild(card('Search Console', 'Importez un export CSV (Requêtes ou Pages). L’API Google OAuth pourra remplacer l’import plus tard.', form));

        var gscKpis = h('div', { 'class': 'sx-kpis sx-kpis-4' });
        gscKpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(g.totals.clicks || 0) }), h('span', { text: 'Clics' }), h('small', { text: g.at ? fmtDate(g.at) : '—' })));
        gscKpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(g.totals.impressions || 0) }), h('span', { text: 'Impressions' }), h('small', { text: 'Depuis le dernier import' })));
        gscKpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(g.totals.queries || 0) }), h('span', { text: 'Requêtes' }), h('small', { text: 'Lignes importées' })));
        gscKpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(g.totals.pages || 0) }), h('span', { text: 'Pages' }), h('small', { text: 'Lignes importées' })));
        body.appendChild(gscKpis);

        if (g.queries && g.queries.length) {
          body.appendChild(card('Top requêtes', null, tbl(['Requête', 'Clics', 'Impr.', 'Pos.'],
            g.queries.slice(0, 25).map(function (x) {
              return [x.key, x.clicks, x.impressions, x.position ? x.position.toFixed(1) : '—'];
            }))));
        }
        if (g.pages && g.pages.length) {
          body.appendChild(card('Top pages', null, tbl(['Page', 'Clics', 'Impr.', 'Pos.'],
            g.pages.slice(0, 25).map(function (x) {
              return [x.key, x.clicks, x.impressions, x.position ? x.position.toFixed(1) : '—'];
            }))));
        }
        if (!g.queries.length && !g.pages.length) {
          body.appendChild(h('div', { 'class': 'sx-empty' }, h('p', { text: 'Aucun import pour l’instant. Dans GSC → Performances → Exporter → CSV.' })));
        }
      });
    }

    /* ========== POSITIONS ========== */
    function renderRanks() {
      return Promise.all([loader('ranks', '/visibility/ranks'), loader('ov', '/visibility/overview')]).then(function (pair) {
        var data = pair[0];
        var ov = pair[1];
        clear(body);
        var qI = h('input', { type: 'text', 'class': 'sx-in', placeholder: 'ex. conseil digital tunisie' });
        var add = h('div', { 'class': 'sx-form-a' }, qI,
          btn('Ajouter', 'btn-primary', guard(function () {
            return api('POST', '/visibility/ranks', { q: qI.value }).then(function () {
              toast('Mot-clé ajouté', 'ok'); bust(); return renderRanks();
            });
          })));
        body.appendChild(card('Positions suivies', 'Jusqu’à 30 mots-clés. Saisie manuelle de la position, ou vérif. auto si SERPAPI_KEY est définie sur le serveur.',
          h('div', null,
            add,
            h('p', { 'class': 'vx-aside', text: ov.serpApi ? 'SERPAPI_KEY détectée : bouton « Vérifier » disponible.' : 'Sans SERPAPI_KEY : notez la position Google à la main (1–100).' }))));

        if (!data.keywords.length) {
          body.appendChild(h('div', { 'class': 'sx-empty' }, h('p', { text: 'Aucun mot-clé suivi. Ajoutez ceux qui comptent pour Navitrends.' })));
          return;
        }
        var list = h('div', { 'class': 'vx-starts' });
        data.keywords.forEach(function (k) {
          var posI = h('input', { type: 'number', 'class': 'sx-in', min: '1', max: '100', placeholder: 'Pos.', style: 'width:72px', value: k.pos != null ? String(k.pos) : '' });
          var acts = h('div', { 'class': 'sx-form-a' });
          acts.appendChild(posI);
          acts.appendChild(btn('OK', 'btn-sm', guard(function () {
            return api('POST', '/visibility/ranks/' + k.id, { pos: posI.value }).then(function () {
              toast('Position enregistrée', 'ok'); bust(); return renderRanks();
            });
          })));
          if (ov.serpApi) {
            acts.appendChild(btn('Vérifier', 'btn-sm', guard(function () {
              return api('POST', '/visibility/ranks/' + k.id, { check: true }).then(function () {
                toast('Position mise à jour via SERP', 'ok'); bust(); return renderRanks();
              });
            })));
          }
          acts.appendChild(btn('Retirer', 'btn-sm btn-danger', guard(function () {
            if (!window.confirm('Retirer « ' + k.q + ' » ?')) return;
            return api('DELETE', '/visibility/ranks/' + k.id).then(function () {
              toast('Retiré', 'ok'); bust(); return renderRanks();
            });
          })));
          list.appendChild(h('div', { 'class': 'vx-rank' },
            h('div', { 'class': 'vx-start-t' },
              h('b', { text: k.q }),
              h('p', { text: (k.pos != null ? 'Position ' + k.pos : 'Pas encore noté')
                + (k.delta != null ? ' · Δ ' + (k.delta > 0 ? '+' : '') + k.delta : '')
                + (k.at ? ' · ' + fmtDate(k.at) : '') })),
            acts));
        });
        body.appendChild(card('Liste (' + data.keywords.length + '/30)', null, list));
      });
    }

    /* ========== MOTS-CLÉS SITE ========== */
    function renderKeywords() {
      return loader('kw', '/visibility/keywords').then(function (k) {
        clear(body);
        body.appendChild(card('Mots-clés du site', 'Cibles déjà renseignées dans SEO (par page). Pas de base mondiale : uniquement votre contenu.',
          h('div', { 'class': 'sx-kpis sx-kpis-4' },
            h('div', { 'class': 'sx-kpi' }, h('b', { text: String(k.totals.keywords) }), h('span', { text: 'Cibles' }), h('small', { text: 'Uniques' })),
            h('div', { 'class': 'sx-kpi' }, h('b', { text: String(k.totals.tracked) }), h('span', { text: 'Suivies' }), h('small', { text: 'Dans Positions' })),
            h('div', { 'class': 'sx-kpi ' + (k.totals.pagesWithout ? 'warn' : 'good') }, h('b', { text: String(k.totals.pagesWithout) }), h('span', { text: 'Pages sans cible' }), h('small', { text: 'À compléter dans SEO' })),
            h('div', { 'class': 'sx-kpi' }, h('b', { text: String(k.keywords.filter(function (x) { return x.coverage >= 2; }).length) }), h('span', { text: 'Bien couvertes' }), h('small', { text: 'Titre + description' })))));

        if (!k.keywords.length) {
          var emptyKw = h('div', { 'class': 'sx-empty' });
          emptyKw.appendChild(h('p', { text: 'Aucune cible. Ouvrez une page dans SEO → Modifier → mots-clés cibles.' }));
          emptyKw.appendChild(h('div', { 'class': 'sx-form-a' }, btn('Ouvrir SEO → Pages', 'btn-primary', function () { go('/seo'); })));
          body.appendChild(emptyKw);
        } else {
          body.appendChild(card('Cibles', null, tbl(['Mot-clé', 'Pages', 'Présence', ''],
            k.keywords.map(function (x) {
              var presence = ((x.inTitle ? 'Titre ' : '') + (x.inDesc ? 'Desc' : '')).trim() || '—';
              var act = x.tracked
                ? h('td', null, h('span', { 'class': 'pill green', text: 'Suivi' }))
                : h('td', null, btn('Suivre', 'btn-sm', guard(function () {
                  return api('POST', '/visibility/ranks', { q: x.q }).then(function () {
                    toast('Ajouté aux Positions', 'ok'); bust(); return renderKeywords();
                  });
                })));
              return [x.q, x.pagesCount, presence, act];
            }))));
        }

        if (k.pagesWithoutTargets && k.pagesWithoutTargets.length) {
          var miss = h('div', { 'class': 'vx-starts' });
          k.pagesWithoutTargets.slice(0, 12).forEach(function (p) {
            miss.appendChild(h('div', { 'class': 'vx-start' },
              h('div', { 'class': 'vx-start-t' }, h('b', { text: p.name }), h('p', { text: p.path })),
              btn('SEO', 'btn-sm', function () { go('/seo'); })));
          });
          body.appendChild(card('Pages sans cible', 'Ajoutez 2–5 mots-clés par page dans le tiroir SEO.', miss));
        }
      });
    }

    /* ========== RAPPORT ========== */
    function renderReport() {
      return loader('rep', '/visibility/report').then(function (r) {
        clear(body);
        var actions = h('div', { 'class': 'sx-form-a' });
        actions.appendChild(btn('Imprimer / PDF', 'btn-primary', function () { window.open('/api/visibility/report.html', '_blank'); }));
        actions.appendChild(btn('Rafraîchir', 'btn-sm', function () { bust(); return renderReport(); }));
        body.appendChild(card('Rapport mensuel', r.month + ' · généré pour la direction / le client.', actions));

        var deltaCls = (r.seo.delta || 0) > 0 ? 'good' : ((r.seo.delta || 0) < 0 ? 'bad' : '');
        var deltaTxt = r.seo.delta == null ? '—' : ((r.seo.delta > 0 ? '+' : '') + r.seo.delta);
        var kpis = h('div', { 'class': 'sx-kpis sx-kpis-4' });
        kpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(r.seo.score) }), h('span', { text: 'Note SEO' }), h('small', { text: r.seo.grade || '' })));
        kpis.appendChild(h('div', { 'class': 'sx-kpi ' + deltaCls }, h('b', { text: deltaTxt }), h('span', { text: 'Évolution' }), h('small', { text: 'Ce mois' })));
        kpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(r.gsc.totals.clicks || 0) }), h('span', { text: 'Clics GSC' }), h('small', { text: r.gsc.at ? fmtDate(r.gsc.at) : 'Pas d’import' })));
        kpis.appendChild(h('div', { 'class': 'sx-kpi' }, h('b', { text: String(r.ranks.count || 0) }), h('span', { text: 'Positions' }), h('small', { text: 'Mots-clés suivis' })));
        body.appendChild(kpis);

        if (r.gsc.topQueries && r.gsc.topQueries.length) {
          body.appendChild(card('Top requêtes', null, tbl(['Requête', 'Clics', 'Impr.'],
            r.gsc.topQueries.map(function (x) { return [x.key, x.clicks, x.impressions]; }))));
        } else {
          body.appendChild(h('div', { 'class': 'note', text: 'Importez un CSV Search Console pour remplir le top requêtes.' }));
        }

        if (r.ranks.items && r.ranks.items.length) {
          body.appendChild(card('Positions', null, tbl(['Mot-clé', 'Pos.', 'Δ'],
            r.ranks.items.map(function (x) {
              return [x.q, x.pos != null ? x.pos : '—', x.delta == null ? '—' : ((x.delta > 0 ? '+' : '') + x.delta)];
            }))));
        }

        body.appendChild(h('p', { 'class': 'vx-aside', text:
          ((r.seo.remaining && r.seo.remaining.total) || 0) + ' points SEO ouverts · '
          + ((r.seo.fixed && r.seo.fixed.month) || 0) + ' corrections ce mois · '
          + ((r.keywords.totals && r.keywords.totals.keywords) || 0) + ' cibles site' }));
      });
    }

    var seq = 0;
    function render() {
      var mine = ++seq;
      clear(body);
      body.appendChild(h('div', { 'class': 'sx-loading' }, h('span', { 'class': 'sx-spin' }), h('p', { text: 'Chargement…' })));
      var map = { gsc: renderGsc, ranks: renderRanks, keywords: renderKeywords, report: renderReport };
      var fn = map[tab] || renderDashboard;
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
    return { title: 'Visibilité', el: root };
  };
})();
