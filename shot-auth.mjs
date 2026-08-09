// p1-3 运行截图：/debug 页面 RequireAuth 守卫
// 截图1：未登录访问 /debug → 重定向到登录页
// 截图2：登录后 /debug 正常渲染
import { writeFileSync, mkdirSync } from 'node:fs';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const OUT = 'pr-evidence';
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shotp13_' + Date.now().toString(36).slice(-6);
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

  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');

  // 清空浏览器 cookie → 模拟未登录
  await send('Network.clearBrowserCookies');
  console.log('[cookie] 已清空，模拟未登录');

  // 未登录访问 /debug → RequireAuth 应重定向到登录页
  await send('Page.navigate', { url: `${BASE}/debug` });
  await wait(4000);
  const url1 = await evalJS('location.href');
  const txt1 = await evalJS('document.body.innerText');
  console.log('[未登录 /debug] url=', url1);
  const redirected = url1.includes('/auth/login');
  if (!redirected) throw new Error(`未登录访问 /debug 未重定向，当前 ${url1}`);
  if (!/登录|登入|login/i.test(txt1.slice(0, 200))) throw new Error('未跳转到登录页内容');
  console.log('[未登录 /debug] ✓ 重定向到登录页');
  await shot('p13-debug-01-unauthed-redirect');

  // 登录
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  const login = await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log('[login]', JSON.stringify(login).slice(0, 100));

  // 登录后访问 /debug → 正常渲染
  await send('Page.navigate', { url: `${BASE}/debug` });
  const deadline = Date.now() + 20000;
  let rendered = false;
  while (Date.now() < deadline) {
    await wait(2000);
    const txt = (await evalJS('document.body.innerText')) || '';
    if (txt.includes('流程调试与评测') && txt.includes('输入转换任务 ID')) { rendered = true; break; }
  }
  if (!rendered) throw new Error('登录后 /debug 未渲染出评测界面');
  console.log('[登录后 /debug] ✓ 正常渲染');
  await shot('p13-debug-02-authed');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
