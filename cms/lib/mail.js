/* Envoi d'e-mails par SMTP (sans dépendance) : SSL (465), STARTTLS (587) ou non chiffré. */
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const encHeader = s => /^[\x20-\x7e]*$/.test(s) ? s : '=?UTF-8?B?' + b64(s) + '?=';
const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const addr = s => { const m = /<([^>]+)>/.exec(s); return clean(m ? m[1] : s); };

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const port = parseInt(cfg.smtp_port, 10) || (cfg.smtp_secure === 'ssl' ? 465 : 587);
    const opts = { host: cfg.smtp_host, port };
    const sock = cfg.smtp_secure === 'ssl' ? tls.connect({ ...opts, servername: cfg.smtp_host }) : net.connect(opts);
    const t = setTimeout(() => { sock.destroy(); reject(new Error('Délai dépassé (connexion SMTP).')); }, 20000);
    sock.once('error', e => { clearTimeout(t); reject(e); });
    sock.once(cfg.smtp_secure === 'ssl' ? 'secureConnect' : 'connect', () => { clearTimeout(t); resolve(sock); });
  });
}

/* lecteur de réponses SMTP (gère les réponses multi-lignes) */
function reader(sock) {
  let buf = ''; const waiters = [];
  const flush = () => {
    while (waiters.length) {
      const m = buf.match(/^(?:\d{3}-.*\r?\n)*\d{3} .*\r?\n/);
      if (!m) return;
      buf = buf.slice(m[0].length);
      waiters.shift().resolve({ code: parseInt(m[0].slice(0, 3), 10), text: m[0] });
    }
  };
  const onData = d => { buf += d.toString('utf8'); flush(); };
  sock.on('data', onData);
  sock.on('error', e => waiters.splice(0).forEach(w => w.reject(e)));
  sock.on('close', () => waiters.splice(0).forEach(w => w.reject(new Error('Connexion SMTP fermée.'))));
  return {
    next: () => new Promise((resolve, reject) => { waiters.push({ resolve, reject }); flush(); }),
    stop: () => sock.off('data', onData)
  };
}

async function send(cfg, { to, subject, text, replyTo }) {
  if (!cfg.smtp_host) throw new Error('Le serveur d’envoi (SMTP) n’est pas configuré dans les Réglages.');
  const rcpts = (Array.isArray(to) ? to : String(to).split(',')).map(addr).filter(Boolean);
  if (!rcpts.length) throw new Error('Aucune adresse de destination.');
  const from = clean(cfg.mail_from) || clean(cfg.smtp_user) || ('noreply@' + cfg.smtp_host);
  let sock = await connect(cfg);
  let rd = reader(sock);
  const expect = async (codes, label) => {
    const r = await rd.next();
    if (!codes.includes(r.code)) throw new Error('SMTP ' + label + ' : ' + r.text.trim().slice(0, 200));
    return r;
  };
  const cmd = async (line, codes, label) => { sock.write(line + '\r\n'); return expect(codes, label || line.split(' ')[0]); };
  try {
    await expect([220], 'accueil');
    const host = 'navitrends.local';
    let ehlo = await cmd('EHLO ' + host, [250]);
    if (cfg.smtp_secure === 'tls') {
      await cmd('STARTTLS', [220]);
      rd.stop();
      sock = tls.connect({ socket: sock, servername: cfg.smtp_host });
      await new Promise((res, rej) => { sock.once('secureConnect', res); sock.once('error', rej); });
      rd = reader(sock);
      ehlo = await cmd('EHLO ' + host, [250]);
    }
    if (cfg.smtp_user) {
      await cmd('AUTH LOGIN', [334]);
      await cmd(b64(cfg.smtp_user), [334]);
      await cmd(b64(cfg.smtp_pass || ''), [235], 'authentification');
    }
    await cmd('MAIL FROM:<' + addr(from) + '>', [250]);
    for (const r of rcpts) await cmd('RCPT TO:<' + r + '>', [250, 251]);
    await cmd('DATA', [354]);
    const body = Buffer.from(String(text || ''), 'utf8').toString('base64').replace(/(.{76})/g, '$1\r\n');
    const head = [
      'From: ' + encHeader(clean(cfg.site_name || 'Navitrends')) + ' <' + addr(from) + '>',
      'To: ' + rcpts.join(', '),
      replyTo ? 'Reply-To: ' + clean(replyTo) : null,
      'Subject: ' + encHeader(clean(subject)),
      'Date: ' + new Date().toUTCString(),
      'Message-ID: <' + crypto.randomBytes(12).toString('hex') + '@' + (addr(from).split('@')[1] || 'navitrends.local') + '>',
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'
    ].filter(Boolean).join('\r\n');
    sock.write(head + '\r\n\r\n' + body + '\r\n.\r\n');
    await expect([250], 'envoi');
    await cmd('QUIT', [221]).catch(() => {});
  } finally { try { sock.destroy(); } catch (e) { /* ignoré */ } }
  return true;
}

module.exports = { send };
