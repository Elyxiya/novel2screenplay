// P-记忆 E2E（阶段1：重启前）
// 1. 注册+登录 2. 创建真实 Agent 任务并验证 agent_tasks 落库 3. SQL 注入"崩溃时挂起 awaiting"的任务
// 输出状态文件 pr-evidence/.p-memory-state.json 供重启后的 verify 脚本使用
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://localhost:3001';
const DB_PATH = path.join(ROOT, 'apps/screenplay/data/novel2screenplay.db');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'pmem_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。陈默推门进来，抖落肩头的雨水。`;

async function main() {
  // 1. 注册 + 登录
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

  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  setCookies(loginRes);
  const login = await loginRes.json();
  if (!login.user?.id) throw new Error(`登录失败: ${JSON.stringify(login)}`);
  console.log(`[1] 登录: ${login.user.username} (id=${login.user.id})`);

  // 2. 创建真实 Agent 任务
  const startRes = await fetch(`${BASE}/api/agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({
      novelText: NOVEL,
      title: '雨夜改稿',
      author: 'P-记忆测试',
      instruction: '对白口语化',
    }),
  });
  const startData = await startRes.json();
  if (!startData.taskId) throw new Error(`启动失败: ${JSON.stringify(startData)}`);
  const taskId = startData.taskId;
  console.log(`[2] 真实 Agent 任务已启动: ${taskId}`);

  // 3. 验证 agent_tasks 落库（等 1.5s 让异步执行开始）
  await wait(1500);
  const db = new Database(DB_PATH, { readonly: true });
  const row = db.prepare('SELECT status, user_id, task_json FROM agent_tasks WHERE id = ?').get(taskId);
  if (!row) throw new Error(`agent_tasks 无记录（真实任务未落库）: ${taskId}`);
  const task = JSON.parse(row.task_json);
  if (!Array.isArray(task.phases) || task.phases.length !== 4) {
    throw new Error(`task_json 结构异常: ${JSON.stringify(task).slice(0, 200)}`);
  }
  console.log(`[3] agent_tasks 落库验证: status=${row.status} user_id=${row.user_id} phases=${task.phases.length}`);
  const phaseLine = task.phases.map((p) => `${p.name}=${p.status}`).join(', ');
  console.log(`    阶段状态: ${phaseLine}`);

  // 4. 注入"崩溃时挂起 awaiting"的任务（模拟人工介入挂起后被重启打断）
  const awaitingTaskId = 'pmem-awaiting-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const pid = (name) => `${awaitingTaskId}-${name}`;
  const awaitingTask = {
    id: awaitingTaskId,
    userId: login.user.id,
    input: '模拟崩溃时挂起的人工介入任务（merge 质量不达标待审批）',
    title: 'P-记忆·挂起任务',
    phaseCount: 4,
    phases: [
      { id: pid('analyze'), name: 'analyze', description: '分析小说，提取角色、地点与时间线', role: 'analyzer', status: 'completed', retryCount: 0 },
      { id: pid('segment'), name: 'segment', description: '将小说拆分为可转换的场景单元', role: 'writer', status: 'completed', retryCount: 0 },
      { id: pid('convert'), name: 'convert', description: '将场景单元转换为剧本对白与动作', role: 'writer', status: 'completed', retryCount: 0 },
      { id: pid('merge'), name: 'merge', description: '合并校验，产出最终剧本', role: 'editor', status: 'awaiting', retryCount: 1, error: '质量未达标（待人工介入）: merge 评测不达标' },
    ],
    awaiting: { phaseId: pid('merge'), phaseName: 'merge', reason: 'merge 评测不达标', decision: 'fail' },
  };
  db.close();
  const dbw = new Database(DB_PATH);
  dbw.prepare(
    'INSERT INTO agent_tasks (id, status, user_id, task_json, created_at, updated_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
  ).run(awaitingTaskId, 'active', login.user.id, JSON.stringify(awaitingTask), now, now);
  dbw.close();
  console.log(`[4] 已注入挂起任务（模拟崩溃遗留 awaiting）: ${awaitingTaskId}`);

  // 5. 输出状态文件
  writeFileSync(
    path.join(OUT, '.p-memory-state.json'),
    JSON.stringify({ taskId, awaitingTaskId, userId: login.user.id, username: USERNAME }, null, 2),
  );
  console.log(`[5] 状态已写入 ${OUT}/.p-memory-state.json`);
  console.log('SETUP OK（下一步：重启 dev server 后运行 verify）');
}

main().catch((e) => { console.error('SETUP FAILED:', e.message); process.exit(1); });
