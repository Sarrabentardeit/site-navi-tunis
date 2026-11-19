/* Captures d'écran du back-office avec Edge headless (pilotage CDP). Usage : node cms/tools/shot.js sortie_dossier "#/home" "#/pages" ... */
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const EDGE = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'].find(fs.existsSync);
const BASE = process.env.NV_URL || 'http://localhost:8090';
const out = process.argv[2]; const routes = process.argv.slice(3);
const W = parseInt(process.env.W, 10) || 1400, H = parseInt(process.env.H, 10) || 900;
fs.mkdirSync(out, { recursive: true });
const get = u => new Promise((res, rej) => http.get(u, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const port = 9333;
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-'));
  const p = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + port, '--user-data-dir=' + prof, '--hide-scrollbars', '--window-size=' + W + ',' + H, 'about:blank'], { stdio: 'ignore' });
  let tabs; for (let i = 0; i < 40; i++) { try { tabs = await get('http://127.0.0.1:' + port + '/json'); break; } catch (e) { await sleep(250); } }
  const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = new Map();
  ws.addEventListener('message', m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } });
  const send = (method, params) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => (await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
  await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + '/backoffice/' }); await sleep(1500);
  const email = process.env.NV_EMAIL || 'admin@navitrends.test';
  const password = process.env.NV_PASS || 'MotDePasse-Solide-2026';
  await ev(`fetch('/api/login',{method:'POST',headers:{'X-NV':'1','Content-Type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  for (const r of routes) {
    const name = r.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'dashboard';
    if (r.startsWith('#')) { await send('Page.navigate', { url: BASE + '/backoffice/' + r }); await sleep(1500); await ev('location.reload()'); await sleep(1500); }
    else { await send('Page.navigate', { url: BASE + r }); await sleep(1500); }
    if (process.env.OPEN) await ev(`document.querySelectorAll('details').forEach((d,i)=>{ if(i<${parseInt(process.env.OPEN, 10)}) d.open=true })`);
    const full = process.env.FULL ? await ev('Math.max(document.documentElement.scrollHeight, innerHeight)') : H;
    if (process.env.FULL) await send('Emulation.setDeviceMetricsOverride', { width: W, height: Math.min(full, 5000), deviceScaleFactor: 1, mobile: false });
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(s.result.data, 'base64')); console.log('capture :', name);
    if (process.env.FULL) await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  }
  ws.close(); p.kill();
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error(e); process.exit(1); });
