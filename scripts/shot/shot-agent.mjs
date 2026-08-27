// P0-4 运行截图：CDP 自动化 /agent 工作台（空态 → 运行中 → 完成态）
// 复用 9222 端口上的 Chrome CDP 实例
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shot_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';

const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。

陈默推门进来，抖落肩头的雨水："这么晚还在改？"
"导演明天要看第三幕。"林小满头也不抬，笔尖沙沙作响。
陈默走近，瞥见满纸红笔："这场戏的台词太满了。"
"我知道。"林小满搁笔，揉了揉眉心，"但删掉哪句都舍不得。"

凌晨三点，两人终于敲定终稿。林小满望向窗外渐收的雨势，轻轻呼出一口气。`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 创建新 tab
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
    } else {
      events.push(msg);
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

  // 2. 先导航到站内（同源）再注册登录，避免 about:blank 跨源 fetch 被拒
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(3000);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json()).then(d=>({ok:true, d}))`);
  const login = await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log('[login]', JSON.stringify(login).slice(0, 120));

  // 3. 打开 /agent
  await send('Page.navigate', { url: `${BASE}/agent` });
  await new Promise((res) => {
    const t = setInterval(() => {
      const ev = events.find((e) => e.method === 'Page.loadEventFired');
      if (ev) { clearInterval(t); res(); }
    }, 100);
    setTimeout(() => { clearInterval(t); res(); }, 20000);
  });
  await wait(2500); // 等 React 水合

  // 4. 空态截图
  await shot('p04-agent-01-workbench');

  // 5. 填表单（React 受控组件需要 native setter + input 事件）
  const fill = await evalJS(`
    (async () => {
      const setVal = (el, v) => {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const opts = document.querySelectorAll('input[placeholder="可选"]');
      setVal(opts[0], '雨夜改稿');
      setVal(opts[1], '测试作者');
      const ta = document.querySelector('textarea[placeholder="在此粘贴小说正文…"]');
      setVal(ta, ${JSON.stringify(NOVEL)});
      const inst = document.querySelector('textarea[placeholder="例如：对白改得更口语化、强化动作描写…"]');
      setVal(inst, '对白更口语化，强化雨夜氛围');
      await new Promise(r => setTimeout(r, 200));
      const btn = [...document.querySelectorAll('button')].find(b => b.textContent.includes('让 Agent 开始转换'));
      btn.click();
      return true;
    })()
  `);
  console.log('[start] clicked:', fill);

  // 6. 运行中截图（约 12s：analyze 完成、segment 进行中）
  await wait(12000);
  await shot('p04-agent-02-running');

  // 7. 轮询等待完成
  const deadline = Date.now() + 150000;
  let done = false;
  while (Date.now() < deadline) {
    await wait(5000);
    const txt = await evalJS(`document.body.innerText`);
    if (txt.includes('转换完成') || txt.includes('转换未成功')) { done = true; break; }
    const phasesTxt = (await evalJS(`document.body.innerText`)) || '';
    const last = phasesTxt.split('\n').filter(Boolean).slice(-6).join(' | ');
    console.log(`[wait ${((150000 - (deadline - Date.now())) / 1000).toFixed(0)}s] ${last.slice(0, 120)}`);
  }
  console.log('[done]', done);
  await shot('p04-agent-03-completed');

  // 8. 清理
  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
