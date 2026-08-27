// P-记忆 E2E（阶段2：重启后）
// 验证：agent_tasks 持久化的未完成任务在服务重启后被恢复
// 1. 查询注入的 awaiting 任务 → 恢复且保持挂起 2. 人工介入 discard 可用 → 终态 failed 落库
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://localhost:3001';
const DB_PATH = path.join(ROOT, 'apps/screenplay/data/novel2screenplay.db');
const state = JSON.parse(readFileSync(path.join(ROOT, 'pr-evidence/.p-memory-state.json'), 'utf8'));

async function main() {
  // 重新登录（服务重启后 session 仍有效，但重新登录更稳）
  const jar = new Map();
  const setCookies = (res) => {
    const sc = res.headers.getSetCookie?.() ?? [];
    for (const c of sc) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: state.username, password: 'pass-123456' }),
  });
  setCookies(loginRes);
  const login = await loginRes.json();
  if (!login.user?.id) throw new Error(`登录失败: ${JSON.stringify(login)}`);
  console.log(`[1] 重启后登录: ${login.user.username} (id=${login.user.id})`);

  // 2. 查询恢复的 awaiting 任务（核心断言：重启不丢失人工介入挂起任务）
  const getRes = await fetch(`${BASE}/api/agent/start?taskId=${state.awaitingTaskId}`, {
    headers: { Cookie: cookieHeader() },
  });
  const getData = await getRes.json();
  console.log(`[2] GET /api/agent/start?taskId=${state.awaitingTaskId}`);
  console.log(`    HTTP ${getRes.status} | awaiting=${getData.awaiting} | taskId=${getData.taskId}`);
  if (getRes.status !== 200 || getData.taskId !== state.awaitingTaskId) {
    throw new Error(`恢复失败: 期望 200 + 任务可见, 实际 ${getRes.status} ${JSON.stringify(getData)}`);
  }
  if (getData.awaiting !== true) {
    throw new Error(`恢复失败: 挂起任务应保持 awaiting=true, 实际 ${JSON.stringify(getData.awaiting)}`);
  }
  const mergePhase = getData.phases?.find((p) => p.name === 'merge');
  console.log(`    merge 阶段: ${mergePhase?.status} | retryCount=${mergePhase?.retryCount}`);
  if (mergePhase?.status !== 'awaiting') {
    throw new Error(`恢复失败: merge 阶段应保持 awaiting`);
  }
  console.log('    ✓ 挂起任务已从持久化恢复，且保持人工介入挂起状态');

  // 3. 人工介入 discard（恢复后的任务可正常处理）
  const reviewRes = await fetch(`${BASE}/api/agent/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ taskId: state.awaitingTaskId, phaseId: mergePhase.id, action: 'discard' }),
  });
  const reviewData = await reviewRes.json();
  console.log(`[3] 人工介入 discard: HTTP ${reviewRes.status} | ok=${reviewData.ok}`);
  if (!reviewData.ok) throw new Error(`discard 失败: ${JSON.stringify(reviewData)}`);

  // 4. 终态落库验证（discard → failed）
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT status FROM agent_tasks WHERE id = ?').get(state.awaitingTaskId);
  db.close();
  console.log(`[4] agent_tasks 终态: status=${row?.status}`);
  if (row?.status !== 'failed') throw new Error(`期望 failed, 实际 ${row?.status}`);
  console.log('    ✓ 人工介入后的终态已持久化');

  console.log('\nVERIFY OK —— P-记忆重启恢复验证通过');
}

main().catch((e) => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
