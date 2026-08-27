// P1-1 验收截图：CDP 打开 /debug?jobId= 展示置信度分布条与评测结果
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'p11shot_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const JOB_ID = readFileSync(`${OUT}/.p11-jobid.txt`, 'utf8').trim();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tab = await (await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
    } else events.push(msg);
  };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  };
  const shot = async (name) => {
    await wait(900);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`[shot] ${OUT}/${name}.png`);
  };

  await send('Page.enable');
  await send('Runtime.enable');

  // 登录
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(3000);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  const login = await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log('[login]', JSON.stringify(login).slice(0, 100));

  // 打开 /debug
  await send('Page.navigate', { url: `${BASE}/debug?jobId=${encodeURIComponent(JOB_ID)}` });
  await new Promise((res) => {
    const t = setInterval(() => {
      if (events.some((e) => e.method === 'Page.loadEventFired')) { clearInterval(t); res(); }
    }, 100);
    setTimeout(() => { clearInterval(t); res(); }, 20000);
  });
  await wait(2500); // 等 React 水合

  // 等待评测结果渲染（URL 自动触发 run）
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline) {
    const txt = await evalJS(`document.body.innerText`);
    if (txt.includes('整体评分') && txt.includes('流水线各阶段')) { ready = true; break; }
    await wait(1500);
  }
  console.log('[eval-render]', ready);

  // 截图 1：评测总览
  const info = await evalJS(`document.body.innerText.slice(0, 300)`);
  console.log('[page]', JSON.stringify(info).replace(/\\n/g, ' | ').slice(0, 250));
  await shot('p11-debug-01-overview');

  // 截图 2：展开 LLM 对话日志
  const opened = await evalJS(`
    (async () => {
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('展开 LLM 对话日志'));
      if (btn) { btn.click(); return 'opened'; }
      return 'no-button';
    })()
  `);
  console.log('[logs]', opened);
  await wait(1500);
  await shot('p11-debug-02-logs');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
