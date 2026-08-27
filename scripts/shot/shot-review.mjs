// p1-5 运行截图：CDP 自动化 /agent 工作台人工介入流程
// 前提：merge 关卡阈值临时调高（触发 awaiting）
// 截图1：等待人工介入（待介入卡片 + 操作按钮）→ 点击"批准继续" → 截图2：任务完成
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shotp15_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';

const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。

陈默推门进来，抖落肩头的雨水："这么晚还在改？"
"导演明天要看第三幕。"林小满头也不抬，笔尖沙沙作响。
陈默走近，瞥见满纸红笔："这场戏的台词太满了。"
"我知道。"林小满搁笔，揉了揉眉心，"但删掉哪句都舍不得。"

凌晨三点，两人终于敲定终稿。林小满望向窗外渐收的雨势，轻轻呼出一口气。`;

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

  // 登录
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(3000);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  const login = await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log('[login]', JSON.stringify(login).slice(0, 120));

  // 打开 /agent
  await send('Page.navigate', { url: `${BASE}/agent` });
  await wait(4000);

  // 填表启动
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

  // 轮询等待"待人工介入"（merge 阶段，通常 40-60s）
  const deadline = Date.now() + 180000;
  let awaitingSeen = false;
  while (Date.now() < deadline) {
    await wait(4000);
    const txt = (await evalJS(`document.body.innerText`)) || '';
    if (txt.includes('待人工介入')) { awaitingSeen = true; break; }
    if (txt.includes('转换未成功')) throw new Error('任务失败');
    const last = txt.split('\n').filter(Boolean).slice(-4).join(' | ');
    console.log(`[wait ${((180000 - (deadline - Date.now())) / 1000).toFixed(0)}s] ${last.slice(0, 100)}`);
  }
  if (!awaitingSeen) throw new Error('未出现待人工介入状态');
  console.log('[awaiting] 出现待人工介入卡片');
  await shot('p15-agent-01-awaiting-manual');

  // 点击"批准继续"
  const clicked = await evalJS(`
    (() => {
      const btns = [...document.querySelectorAll('button')];
      const b = btns.find(x => x.textContent.trim() === '批准继续');
      if (!b) return false;
      b.click();
      return true;
    })()
  `);
  console.log('[approve] clicked:', clicked);
  if (!clicked) throw new Error('未找到批准继续按钮');

  // 等待完成
  const d2 = Date.now() + 120000;
  let done = false;
  while (Date.now() < d2) {
    await wait(5000);
    const txt = (await evalJS(`document.body.innerText`)) || '';
    if (txt.includes('转换完成')) { done = true; break; }
    if (txt.includes('转换未成功')) throw new Error('任务失败');
  }
  console.log('[done]', done);
  await shot('p15-agent-02-completed');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
