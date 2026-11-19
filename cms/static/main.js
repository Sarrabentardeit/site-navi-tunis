(function () {
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(pointer:fine)').matches;
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ---------- Barre de progression + header ---------- */
  var bar = $('#scroll-progress');
  var header = $('#header');
  var nav = $('#main-nav');
  var lastY = 0, ticking = false;
  var pars = $$('[data-speed]');

  function paralax() {
    if (reduce) return;
    pars.forEach(function (el) {
      var host = el.parentElement, r = host.getBoundingClientRect();
      if (r.bottom < -150 || r.top > window.innerHeight + 150) return;
      var mid = r.top + r.height / 2 - window.innerHeight / 2;
      el.style.translate = '0 ' + (mid * -parseFloat(el.dataset.speed)).toFixed(1) + 'px';
    });
  }
  function onScroll() {
    ticking = false;
    var y = window.scrollY || 0;
    var max = doc.scrollHeight - window.innerHeight;
    if (bar && max > 0) bar.style.transform = 'scaleX(' + Math.min(y / max, 1) + ')';
    if (header) {
      header.classList.toggle('scrolled', y > 8);
      var open = nav && nav.classList.contains('open');
      if (!reduce && !open && y > 160 && y > lastY + 6) header.classList.add('hide');
      else if (y < lastY - 6 || y <= 160) header.classList.remove('hide');
    }
    lastY = y;
    paralax();
  }
  onScroll();
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  /* ---------- Menu mobile ---------- */
  var burger = $('#burger');
  if (burger && nav) {
    burger.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      burger.setAttribute('aria-expanded', open);
      burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
      burger.style.position = open ? 'fixed' : '';
      burger.style.right = open ? '16px' : '';
      burger.style.zIndex = open ? '130' : '';
      document.body.style.overflow = open ? 'hidden' : '';
    });
  }
  $$('.sub-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var open = btn.parentElement.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    });
  });

  /* ---------- Titres : apparition mot par mot ---------- */
  function splitNode(node, cls, st) {
    Array.prototype.slice.call(node.childNodes).forEach(function (ch) {
      if (ch.nodeType === 3) {
        var frag = document.createDocumentFragment();
        ch.textContent.split(/([ \t\r\n]+)/).forEach(function (p) {
          if (!p) return;
          if (/^[ \t\r\n]+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
          var s = document.createElement('span');
          s.className = 'w' + (cls ? ' ' + cls : '');
          s.setAttribute('aria-hidden', 'true');
          s.style.setProperty('--wi', st.i++);
          s.textContent = p;
          frag.appendChild(s);
        });
        ch.parentNode.replaceChild(frag, ch);
      } else if (ch.nodeType === 1) {
        var c = cls;
        ['grad', 'live'].forEach(function (k) {
          if (ch.classList.contains(k)) { c = (c ? c + ' ' : '') + k; ch.classList.remove(k); }
        });
        splitNode(ch, c, st);
      }
    });
  }
  var splits = [];
  if (!reduce) {
    $$('.sec-head h2, .about-copy h2, .presence h2, .lucky h2, .cta-box h2').forEach(function (h) {
      h.setAttribute('aria-label', h.textContent.replace(/\s+/g, ' ').trim());
      h.setAttribute('data-split', '');
      splitNode(h, '', { i: 0 });
      splits.push(h);
    });
  }

  /* ---------- Apparition au scroll ---------- */
  var items = $$('.reveal').concat(splits);
  if (reduce || !('IntersectionObserver' in window)) {
    items.forEach(function (el) { el.classList.add('in', 'settled'); });
  } else {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.classList.add('in');
        io.unobserve(el);
        setTimeout(function () { el.classList.add('settled'); }, 1500);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { io.observe(el); });
  }

  /* ---------- Compteurs ---------- */
  var counters = $$('.count');
  if (!reduce && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        co.unobserve(e.target);
        var el = e.target, to = +el.dataset.to, start = null, dur = 1600;
        el.textContent = '0';
        (function step(ts) {
          if (!start) start = ts;
          var p = Math.min((ts - start) / dur, 1);
          el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
          if (p < 1) requestAnimationFrame(step);
        })(performance.now());
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { co.observe(el); });
  }

  /* ---------- Mot du titre qui s'ecrit ---------- */
  var typed = $('#typed');
  if (typed && !reduce) {
    var words = ['performance']; try { var dw = JSON.parse(typed.getAttribute('data-words') || '[]'); if (dw.length) words = dw; } catch (e) {}
    var wi = 0, ci = words[0].length, deleting = true;
    var tick = function () {
      var w = words[wi];
      if (!deleting) {
        typed.textContent = w.slice(0, ++ci);
        if (ci === w.length) { deleting = true; return setTimeout(tick, 2300); }
        return setTimeout(tick, 85);
      }
      typed.textContent = w.slice(0, --ci) || '\u200b';
      if (ci === 0) { deleting = false; wi = (wi + 1) % words.length; return setTimeout(tick, 280); }
      setTimeout(tick, 42);
    };
    setTimeout(tick, 2800);
  }

  /* ---------- Bandeaux defilants ---------- */
  var tracks = $$('[data-marquee]');
  function buildMarquees() {
    tracks.forEach(function (track) {
      if (!track.dataset.base) track.dataset.base = track.innerHTML;
      var base = track.dataset.base;
      track.innerHTML = base;
      var w = track.scrollWidth || 1;
      var k = Math.max(1, Math.ceil(window.innerWidth / w));
      var half = '';
      for (var i = 0; i < k; i++) half += base;
      track.innerHTML = half + half;
      $$('.mq', track).forEach(function (m, idx, all) {
        if (idx >= all.length / 2) m.setAttribute('aria-hidden', 'true');
      });
      var halfW = track.scrollWidth / 2;
      track.style.setProperty('--dur', Math.max(20, halfW / 55).toFixed(1) + 's');
    });
  }
  buildMarquees();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(buildMarquees);
  var rt;
  window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(buildMarquees, 250); });

  /* ---------- Hero : reflet qui suit la souris + pastilles en parallaxe ---------- */
  var hero = $('.hero');
  if (hero && fine && !reduce) {
    var chips = $$('.ff', hero);
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      var nx = (e.clientX - r.left) / r.width - 0.5;
      var ny = (e.clientY - r.top) / r.height - 0.5;
      hero.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      hero.style.setProperty('--my', (e.clientY - r.top) + 'px');
      chips.forEach(function (c) {
        var d = parseFloat(c.dataset.depth || 20);
        c.style.transform = 'translate(' + (nx * d).toFixed(1) + 'px,' + (ny * d).toFixed(1) + 'px)';
      });
    });
    hero.addEventListener('pointerleave', function () {
      chips.forEach(function (c) { c.style.transform = ''; });
    });
  }

  /* ---------- Cartes en relief ---------- */
  if (fine && !reduce) {
    $$('.svc').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
        card.style.setProperty('--rx', ((py - 0.5) * -7).toFixed(2) + 'deg');
        card.style.setProperty('--ry', ((px - 0.5) * 9).toFixed(2) + 'deg');
        card.style.setProperty('--gx', (px * 100).toFixed(1) + '%');
        card.style.setProperty('--gy', (py * 100).toFixed(1) + '%');
      });
      card.addEventListener('pointerleave', function () {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Carrousel des services ---------- */
  var svcTrack = $('#svc-track'), svcPrev = $('#svc-prev'), svcNext = $('#svc-next');
  if (svcTrack && svcPrev && svcNext) {
    var svcStep = function () { var c = svcTrack.querySelector('.svc'); return c ? c.getBoundingClientRect().width + 20 : 300; };
    var svcUpdate = function () {
      svcPrev.disabled = svcTrack.scrollLeft < 4;
      svcNext.disabled = svcTrack.scrollLeft + svcTrack.clientWidth >= svcTrack.scrollWidth - 4;
    };
    var svcAnim = 0;
    var svcScrollTo = function (left) {
      if (reduce) { svcTrack.scrollLeft = left; return; }
      cancelAnimationFrame(svcAnim);
      var from = svcTrack.scrollLeft, to = left, t0 = performance.now(), dur = 280;
      var ease = function (t) { return 1 - Math.pow(1 - t, 3); };
      var tick = function (now) {
        var p = Math.min(1, (now - t0) / dur);
        svcTrack.scrollLeft = from + (to - from) * ease(p);
        if (p < 1) svcAnim = requestAnimationFrame(tick);
      };
      svcAnim = requestAnimationFrame(tick);
    };
    var svcGo = function (dir) { svcScrollTo(svcTrack.scrollLeft + dir * svcStep()); };
    svcPrev.addEventListener('click', function () { svcGo(-1); });
    svcNext.addEventListener('click', function () { svcGo(1); });
    svcTrack.addEventListener('scroll', svcUpdate, { passive: true });
    window.addEventListener('resize', svcUpdate);
    svcUpdate();

    /* defilement automatique : une carte toutes les 2 s */
    if (!reduce) {
      var svcHold = false, svcVisible = false, svcResume = 0;
      var svcPause = function (ms) { svcHold = true; clearTimeout(svcResume); if (ms) svcResume = setTimeout(function () { svcHold = false; }, ms); };
      var svcWrap = svcTrack.parentNode;
      svcWrap.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') svcPause(0); });
      svcWrap.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { clearTimeout(svcResume); svcHold = false; } });
      svcWrap.addEventListener('focusin', function () { svcPause(0); });
      svcWrap.addEventListener('focusout', function () { clearTimeout(svcResume); svcHold = false; });
      svcWrap.addEventListener('touchstart', function () { svcPause(5000); }, { passive: true });
      svcWrap.addEventListener('wheel', function () { svcPause(5000); }, { passive: true });
      svcPrev.addEventListener('click', function () { svcPause(5000); });
      svcNext.addEventListener('click', function () { svcPause(5000); });
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) { svcVisible = en[0].isIntersecting; }, { threshold: 0.35 }).observe(svcWrap);
      } else { svcVisible = true; }
      setInterval(function () {
        if (svcHold || !svcVisible || document.hidden) return;
        var max = svcTrack.scrollWidth - svcTrack.clientWidth;
        if (svcTrack.scrollLeft >= max - 4) svcScrollTo(0);
        else svcGo(1);
      }, 2000);
    }
  }

  /* ---------- Onglets avec lecture automatique ---------- */
  var tabsWrap = $('.tabs');
  var tabs = $$('.tab');
  function selectTab(i) {
    tabs.forEach(function (t, j) {
      t.setAttribute('aria-selected', i === j);
      var p = document.getElementById('panel-' + j);
      if (p) p.classList.toggle('on', i === j);
    });
  }
  tabs.forEach(function (tab, i) {
    tab.addEventListener('click', function () { selectTab(i); });
    tab.addEventListener('keydown', function (ev) {
      var d = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      var n = (i + d + tabs.length) % tabs.length;
      tabs[n].focus(); selectTab(n);
    });
  });
  if (tabsWrap && !reduce) {
    tabsWrap.classList.add('auto');
    tabsWrap.addEventListener('animationend', function (e) {
      if (e.animationName !== 'tabfill') return;
      var cur = tabs.findIndex(function (t) { return t.getAttribute('aria-selected') === 'true'; });
      selectTab((cur + 1) % tabs.length);
    });
    var when = $('.when');
    ['pointerenter', 'focusin'].forEach(function (ev) { when.addEventListener(ev, function () { tabsWrap.classList.add('paused'); }); });
    ['pointerleave', 'focusout'].forEach(function (ev) { when.addEventListener(ev, function () { tabsWrap.classList.remove('paused'); }); });
  }

  /* ---------- Carte a gratter ---------- */
  var sc = $('#scratch'), cv = $('#scratch-canvas'), skip = $('#scratch-skip');
  if (sc && cv && cv.getContext) {
    var ctx = cv.getContext('2d');
    var W = 0, H = 0, touched = false, drawing = false, last = null, moves = 0;
    var reveal = function () { sc.classList.add('done'); if (skip) skip.hidden = true; };
    var paint = function () {
      var r = sc.getBoundingClientRect();
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = r.width; H = r.height;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      var g = ctx.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, '#1B3A93'); g.addColorStop(0.45, '#4a6cf0'); g.addColorStop(0.75, '#b49bff'); g.addColorStop(1, '#F0B323');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,.10)'; ctx.lineWidth = 2;
      for (var x = -H; x < W; x += 26) { ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke(); }
      for (var k = 0; k < 90; k++) {
        ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.5).toFixed(2) + ')';
        ctx.beginPath(); ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2.4 + 0.4, 0, 6.283); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = '800 ' + Math.max(26, Math.min(64, W / 11)) + 'px Manrope, system-ui, sans-serif';
      ctx.shadowColor = 'rgba(11,19,48,.35)'; ctx.shadowBlur = 18;
      ctx.fillText('Grattez ici', W / 2, H / 2 - 10);
      ctx.shadowBlur = 0;
      ctx.font = '700 ' + Math.max(13, Math.min(18, W / 40)) + 'px Manrope, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText('avec le doigt ou la souris', W / 2, H / 2 + Math.max(26, Math.min(64, W / 11)) * 0.6);
    };
    var cleared = function () {
      var cols = 28, rows = 12, n = 0, dpr = cv.width / W;
      for (var i = 0; i < cols; i++) for (var j = 0; j < rows; j++) {
        var d = ctx.getImageData(Math.floor((i + 0.5) / cols * cv.width), Math.floor((j + 0.5) / rows * cv.height), 1, 1).data;
        if (d[3] < 24) n++;
      }
      return n / (cols * rows);
    };
    var pos = function (e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener('pointerdown', function (e) {
      drawing = true; touched = true; last = pos(e); cv.style.cursor = 'grabbing';
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* pointeur simule */ }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = pos(e);
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = '#000';
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(40, Math.min(70, W / 14));
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
      if (++moves % 8 === 0 && cleared() > 0.5) reveal();
    });
    var stop = function () { drawing = false; cv.style.cursor = ''; if (touched && cleared() > 0.5) reveal(); };
    cv.addEventListener('pointerup', stop);
    cv.addEventListener('pointercancel', stop);
    if (skip) skip.addEventListener('click', reveal);
    paint();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (!touched) paint(); });
    window.addEventListener('resize', function () { if (!touched && !sc.classList.contains('done')) paint(); });
  }

  /* ---------- Pied de page : le halo clair suit la souris sur le mot géant ---------- */
  var wm = $('.wordmark');
  if (wm && fine && !reduce) {
    wm.addEventListener('pointermove', function (e) {
      var r = wm.getBoundingClientRect();
      wm.style.setProperty('--mx', (e.clientX - r.left) + 'px');
    });
  }})();


/* ---------- Retour des formulaires (redirection après envoi) ---------- */
(function () {
  var q = new URLSearchParams(location.search);
  if (q.get('nv_sent')) document.querySelectorAll('form.pg-form').forEach(function (f) { f.classList.add('sent'); });
  if (q.get('nv_err')) document.querySelectorAll('.form-err').forEach(function (e) { e.hidden = false; });
  var nl = q.get('nv_news');
  if (nl) {
    var f = document.querySelector('form.newsletter');
    var ok = document.getElementById('nl-ok'), er = document.getElementById('nl-err');
    if (nl === 'ok' && f && ok) { f.hidden = true; ok.style.display = 'block'; }
    if (nl === 'err' && er) er.hidden = false;
  }
})();