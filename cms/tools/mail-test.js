/* Test de l'envoi d'e-mails : lance un faux serveur SMTP local, configure le back-office, soumet un formulaire. */
const net = require('net');
const http = require('http');
const BASE = new URL(process.argv[2] || 'http://localhost:8090');
let cookie = '';
const received = [];

/* faux serveur SMTP (AUTH LOGIN, sans TLS) */
const smtp = net.createServer(sock => {
  let mode = 'cmd', data = '', user = '', step = 0, from = '', rcpt = [];
  sock.write('220 sink ESMTP\r\n');
  let buf = '';
  sock.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\r\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 2);
      if (mode === 'data') { if (line === '.') { mode = 'cmd'; received.push({ from, rcpt, user, raw: data }); sock.write('250 queued\r\n'); } else data += (line.startsWith('..') ? line.slice(1) : line) + '\n'; continue; }
      if (mode === 'auth-user') { user = Buffer.from(line, 'base64').toString(); mode = 'auth-pass'; sock.write('334 UGFzc3dvcmQ6\r\n'); continue; }
      if (mode === 'auth-pass') { const pw = Buffer.from(line, 'base64').toString(); mode = 'cmd'; sock.write(pw === 'secret-smtp' ? '235 ok\r\n' : '535 bad\r\n'); continue; }
      const c = line.toUpperCase();
      if (c.startsWith('EHLO')) sock.write('250-sink\r\n250-AUTH LOGIN\r\n250 8BITMIME\r\n');
      else if (c.startsWith('AUTH LOGIN')) { mode = 'auth-user'; sock.write('334 VXNlcm5hbWU6\r\n'); }
      else if (c.startsWith('MAIL FROM')) { from = line.slice(10); sock.write('250 ok\r\n'); }
      else if (c.startsWith('RCPT TO')) { rcpt.push(line.slice(8)); sock.write('250 ok\r\n'); }
      else if (c === 'DATA') { mode = 'data'; data = ''; sock.write('354 go\r\n'); }
      else if (c === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
      else sock.write('250 ok\r\n');
    }
  });
});

function req(method, path, body, headers) {
  return new Promise((res, rej) => {
    const data = body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'X-NV': '1' }, headers || {}); if (cookie) h.Cookie = cookie; if (data && !h['Content-Type']) h['Content-Type'] = 'application/json';
    const r = http.request({ host: BASE.hostname, port: BASE.port, path, method, headers: h }, x => { const ch = []; x.on('data', c => ch.push(c)); x.on('end', () => { const sc = x.headers['set-cookie']; if (sc) cookie = sc[0].split(';')[0]; let j = null; try { j = JSON.parse(Buffer.concat(ch).toString()); } catch (e) { /* */ } res({ status: x.statusCode, headers: x.headers, json: j }); }); });
    r.on('error', rej); if (data) r.write(data); r.end();
  });
}
const wait = ms => new Promise(r => setTimeout(r, ms));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ✓ ' : '  ✗ ') + m); if (!c) fails++; };

smtp.listen(2525, '127.0.0.1', async () => {
  try {
    let r = await req('POST', '/api/login', { email: 'admin@navitrends.test', password: 'MotDePasse-Solide-2026' }); ok(r.status === 200, 'connexion');
    r = await req('GET', '/api/settings'); const s = r.json;
    Object.assign(s, { smtp_host: '127.0.0.1', smtp_port: '2525', smtp_secure: 'none', smtp_user: 'envoi@navitrends.test', smtp_pass: 'secret-smtp', mail_from: 'envoi@navitrends.test', form_to: 'recoit@navitrends.test, copie@navitrends.test' });
    r = await req('PUT', '/api/settings', s); ok(r.status === 200, 'réglages SMTP enregistrés');
    r = await req('GET', '/api/settings'); ok(r.json.smtp_pass === '__keep__', 'mot de passe SMTP jamais renvoyé au navigateur');
    r = await req('POST', '/api/test-mail', {}); ok(r.json.ok === true, 'e-mail de test envoyé' + (r.json.error ? ' : ' + r.json.error : ''));
    r = await req('POST', '/forms/devis', new URLSearchParams({ nom: 'Léa Dupont', email: 'lea@example.com', societe: 'ACME', projet: 'Nous voulons un ERP.\nMerci é à ç', services: 'Intégration de systèmes', nv_back: '/devis/', nv_page: 'devis' }).toString(), { 'Content-Type': 'application/x-www-form-urlencoded', 'X-NV': '' });
    ok(r.status === 303, 'formulaire devis soumis');
    await wait(1500);
    const m = received[received.length - 1];
    ok(received.length === 2, received.length + ' e-mails reçus par le serveur SMTP');
    ok(m && m.user === 'envoi@navitrends.test', 'authentification SMTP');
    ok(m && m.rcpt.length === 2 && /recoit@/.test(m.rcpt[0]) && /copie@/.test(m.rcpt[1]), 'deux destinataires');
    const raw = m ? m.raw : '';
    const hdr = raw.split('\n\n')[0]; const bodyB64 = raw.split('\n\n').slice(1).join('').replace(/\s+/g, '');
    const text = Buffer.from(bodyB64, 'base64').toString('utf8');
    ok(/Subject: =\?UTF-8\?B\?/.test(hdr) || /Subject: .*Devis/.test(hdr), 'objet : ' + Buffer.from((/=\?UTF-8\?B\?([^?]+)/.exec(hdr) || [0, ''])[1], 'base64').toString());
    ok(/Reply-To: Léa|Reply-To: =\?|Reply-To: L/.test(hdr) || /lea@example.com/.test(hdr), 'Reply-To vers le client');
    ok(/Nom : Léa Dupont/.test(text) && /Merci é à ç/.test(text) && /Société : ACME/.test(text), 'contenu UTF-8 correct (accents conservés)');
    r = await req('GET', '/api/requests'); await wait(300); r = await req('GET', '/api/requests');
    ok(r.json[0].mail.ok === true, 'demande marquée « e-mail envoyé » dans le back-office');
    s.smtp_host = '127.0.0.1'; s.smtp_pass = 'mauvais'; await req('PUT', '/api/settings', s);
    r = await req('POST', '/api/test-mail', {}); ok(r.json.ok === false && /authentification|535/.test(r.json.error), 'mauvais mot de passe SMTP : erreur claire (' + r.json.error + ')');
  } catch (e) { console.error(e); fails++; }
  smtp.close(); console.log(fails ? '\n' + fails + ' ÉCHEC(S)' : '\nTout est OK'); process.exit(fails ? 1 : 0);
});
