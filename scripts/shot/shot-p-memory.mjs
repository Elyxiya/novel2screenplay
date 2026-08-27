// P-记忆运行截图：浏览器内查询"重启恢复的 awaiting 任务"，渲染状态卡片到 /debug 页并截图
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CDP = 'http://127.0.0.1:9222';
const BASE = 'http://localhost:3001';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const state = JSON.parse(readFileSync(path.join(ROOT, 'pr-evidence/.p-memory-state.json'), 'utf8'));
const AWAITING_TASK_ID = state.awaitingTaskId;
const USERNAME = state.username;
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

  // 登录（浏览器环境 fetch，cookie 自动保存）
  await send('Page.navigate', { url: `${BASE}/` });
  await wait(1500);
  await evalJS(`fetch('/api/auth/register', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  await evalJS(`fetch('/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({username:${JSON.stringify(USERNAME)}, password:${JSON.stringify(PASSWORD)}})}).then(r=>r.json())`);
  console.log(`[login] ${USERNAME}`);

  // 打开 /debug 页
  await send('Page.navigate', { url: `${BASE}/debug` });
  await wait(2500);

  // 查询重启恢复的 awaiting 任务（真实 API 数据）并渲染状态卡片
  const cardHtml = await evalJS(`(async () => {
    const res = await fetch('/api/agent/start?taskId=${AWAITING_TASK_ID}');
    const data = await res.json();
    if (!data.phases) return JSON.stringify({ error: '未恢复', data });
    const statusColor = (s) => s === 'completed' ? '#16a34a' : s === 'awaiting' ? '#d97706' : '#6b7280';
    const bar = data.phases.map((p) =>
      '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #eee;">' +
      '<span style="width:80px;font-weight:600;color:#374151;">' + p.name + '</span>' +
      '<span style="width:120px;padding:2px 10px;border-radius:10px;font-size:12px;color:#fff;background:' + statusColor(p.status) + ';text-align:center;">' + p.status + '</span>' +
      '<span style="font-size:12px;color:#6b7280;">retry=' + (p.retryCount ?? 0) + '</span>' +
      '</div>'
    ).join('');
    const card =
      '<div id="pmem-card" style="position:fixed;top:16px;right:16px;z-index:99999;width:460px;background:#fff;border:2px solid #2563eb;border-radius:12px;padding:16px 18px;box-shadow:0 8px 24px rgba(0,0,0,.18);font-family:system-ui,sans-serif;">' +
      '<div style="font-size:15px;font-weight:700;color:#1e40af;margin-bottom:4px;">P-记忆 · 服务重启恢复验证</div>' +
      '<div style="font-size:12px;color:#6b7280;margin-bottom:10px;">GET /api/agent/start?taskId=...（真实 API 数据）</div>' +
      '<div style="font-size:13px;color:#374151;margin-bottom:8px;">taskId: <span style="font-family:monospace;">' + data.taskId + '</span></div>' +
      '<div style="font-size:13px;color:#374151;margin-bottom:10px;">awaiting: <span style="color:#d97706;font-weight:700;">' + String(data.awaiting) + '</span> &nbsp;·&nbsp; 挂起阶段: <b>' + (data.awaitingPhase?.name || '-') + '</b></div>' +
      '<div style="font-size:13px;font-weight:600;color:#111827;margin:10px 0 4px;">阶段状态（重启后恢复）</div>' + bar +
      '<div style="margin-top:12px;padding:8px 10px;background:#fef3c7;border-radius:6px;font-size:12px;color:#92400e;">服务重启后该任务已从 agent_tasks（SQLite）恢复，人工介入挂起状态保留，等待 approve / retry / discard。</div>' +
      '</div>';
    document.body.insertAdjacentHTML('beforeend', card);
    return JSON.stringify({ ok: true, http: res.status, awaiting: data.awaiting, awaitingPhase: data.awaitingPhase });
  })()`);
  console.log('[card] 恢复任务查询结果:', cardHtml);

  await wait(1200);
  await shot('pmem-restore-awaiting-task');

  ws.close();
  console.log('SHOTS OK');
}

main().catch((e) => { console.error('SHOT FAILED:', e.message); process.exit(1); });
