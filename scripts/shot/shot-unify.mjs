// p1-2 运行截图：双执行系统收敛后上传页/历史页正常渲染（QuickStats 数据源已切到 SQLite history）
// 截图1：/upload（QuickStats 卡片，数据来自 /api/jobs/history）
// 截图2：/history（SQLite 历史列表）
// 附带验证：/api/jobs 内存队列接口已收敛（404）
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shotp12_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const tab = await (await fetch(`${CDP}/json/new?url=about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result); }
    }
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
    await wait(800);
    const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
    console.log(`[shot] ${OUT}/${name}.png`);
  };
  const waitText = async (needle, ms = 20000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const txt = (await evalJS('document.body.innerText')) || '';
      if (txt.includes(needle)) return true;
      await wait(2000);
    }
    return false;
  };

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // 登录（先导航到站内页，同源 fetch 存 cookie）
  await send('Page.navigate', { url: `${BASE}/login` });
  await wait(1500);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log(`[login] ${USERNAME}`);

  // 收敛验证：内存队列接口已移除
  const qPost = await evalJS(`fetch('/api/jobs', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'}).then(r=>r.status)`);
  const qGet = await evalJS(`fetch('/api/jobs').then(r=>r.status)`);
  const qEv = await evalJS(`fetch('/api/jobs/x/events').then(r=>r.status)`);
  console.log(`[收敛] /api/jobs POST=${qPost} GET=${qGet} events=${qEv}（期望 404/404/404）`);

  // 创建一条主链路任务，保证 QuickStats / 历史页有数据
  await evalJS(`fetch('/api/pipeline/start', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({novelText:'短篇\\n少年远行，入江湖。', title:'收敛验证', author:'t', selectedChapters:[]})}).then(r=>r.json()).then(d=>d.jobId)`);
  await wait(1500);

  // 截图1：/upload 页（QuickStats 数据源为 /api/jobs/history）
  await send('Page.navigate', { url: `${BASE}/upload` });
  if (!(await waitText('上传小说'))) throw new Error('/upload 未渲染出上传界面');
  await wait(1500);
  const qs = await evalJS(`document.body.innerText.includes('总任务') && document.body.innerText.includes('已完成')`);
  console.log(`[QuickStats] 渲染=${qs}`);
  await shot('p12-upload-quickstats');

  // 截图2：/history 页（SQLite 历史）
  await send('Page.navigate', { url: `${BASE}/history` });
  if (!(await waitText('转换历史'))) throw new Error('/history 未渲染出历史列表');
  await wait(1200);
  console.log('[history] ✓ 正常渲染');
  await shot('p12-history-sqlite');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
