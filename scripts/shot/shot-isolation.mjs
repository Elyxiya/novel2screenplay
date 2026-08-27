// p1-4 运行截图：登录后 Agent 工作台与调试页正常渲染
// 截图1：/agent（Agent 会话工作台）
// 截图2：/debug（流程评测界面）
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shotp14_' + Date.now().toString(36).slice(-6);
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

  // 截图1：/agent 工作台
  await send('Page.navigate', { url: `${BASE}/agent` });
  if (!(await waitText('Agent 对话工作台'))) throw new Error('/agent 未渲染出 Agent 对话工作台');
  console.log('[/agent] ✓ 正常渲染');
  await shot('p14-agent-authed');

  // 截图2：/debug 评测界面
  await send('Page.navigate', { url: `${BASE}/debug` });
  if (!(await waitText('流程调试与评测'))) throw new Error('/debug 未渲染出评测界面');
  console.log('[/debug] ✓ 正常渲染');
  await shot('p14-debug-authed');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
