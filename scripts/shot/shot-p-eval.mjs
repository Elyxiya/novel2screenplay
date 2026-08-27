// P-评估运行截图
// 截图1：/debug?jobId=xxx —— 传统管线 LLM 质量评估卡（四维 + 建议）
// 截图2：/debug —— 质量基准集报告（区分度排序）
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'shotpe_' + Date.now().toString(36).slice(-6);
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
  const waitText = async (needle, ms = 30000) => {
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

  // 登录
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(1500);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log(`[login] ${USERNAME}`);

  // 创建传统管线任务并等待完成 + LLM 评估写入
  const jobId = await evalJS(`fetch('/api/pipeline/start', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({novelText:'短篇\\n少年阿辰自幼在山中与师父习剑。一日师父下山未归，阿辰循踪迹踏入江湖，沿途救下一名被山贼追捕的少女小禾，二人结伴前往传说中的药王谷寻找师父的下落。', title:'P-评估截图', author:'shot', selectedChapters:[]})}).then(r=>r.json()).then(d=>d.jobId)`);
  console.log(`[job] ${jobId}`);
  let ready = false;
  for (let i = 0; i < 60; i++) {
    await wait(5000);
    const fe = await evalJS(`fetch('/api/debug/flow-eval?jobId=${jobId}').then(r=>r.json())`);
    if (fe?.llmAssessment) { ready = true; break; }
  }
  if (!ready) throw new Error('LLM 评估未在时限内写入');
  console.log('[eval] 已写入 pipelineState.qualityAssessment');

  // 截图1：/debug 页 LLM 质量评估卡（填 jobId 并点击评测）
  await send('Page.navigate', { url: `${BASE}/debug?jobId=${jobId}` });
  await wait(1500);
  await evalJS(`(() => {
    const input = document.querySelector('input[placeholder*="jobId"]');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(jobId)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const btn = [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '评测');
    if (!btn) return false;
    btn.click();
    return true;
  })()`);
  if (!(await waitText('LLM 质量评估'))) throw new Error('/debug 未渲染 LLM 评估卡');
  await wait(1200);
  await shot('peval-debug-llm-assessment');

  // 截图2：质量基准集报告（点击运行基准）
  const clicked = await evalJS(`(() => { const btns = [...document.querySelectorAll('button')]; const b = btns.find(x => x.innerText.includes('运行基准')); if (b) { b.click(); return true; } return false; })()`);
  if (!clicked) throw new Error('未找到运行基准按钮');
  if (!(await waitText('区分度', 90000))) throw new Error('基准报告未渲染');
  await wait(1200);
  await shot('peval-debug-benchmark');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
