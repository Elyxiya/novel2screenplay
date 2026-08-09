// p1-4 E2E：多用户数据隔离验证
// 用户 A / 用户 B 各自登录，验证：
// 1. 未登录访问 /api/jobs/[id]/events → 401（补鉴权）
// 2. A 创建的 agent 任务：B 不可见（GET/stream/agent-logs 全部 404），A 可见
// 3. A 的调试会话：B 列表不可见，A 可见
// 4. A 的 pipeline job：B 不可评测（flow-eval 404），A 可评测
// 5. A 的内存队列 job：B 不可订阅（events 404），A 可订阅
const BASE = 'http://localhost:3001';
const PASSWORD = 'pass-123456';
const A = 'p14a_' + Date.now().toString(36).slice(-6);
const B = 'p14b_' + Date.now().toString(36).slice(-6);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail = '') {
  const pass = !!cond;
  if (!pass) failures++;
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` → ${detail}` : ''}`);
}

async function login(username) {
  await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败: ${username}`);
  return setCookie.split(';')[0];
}

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  // ---- 0. 未登录：jobs/[id]/events 应 401（此前完全无鉴权） ----
  const u = await req('/api/jobs/some-job/events');
  check('未登录 GET /api/jobs/[id]/events → 401', u.status === 401, String(u.status));

  // ---- 登录 A / B ----
  const cookieA = await login(A);
  const cookieB = await login(B);
  console.log(`[登录] A=${A} B=${B}`);

  // ---- 1. A 创建 agent 任务 ----
  const tA = await req('/api/agent/start', {
    method: 'POST',
    body: { novelText: '第一章 风起，少年执剑出门。', title: '隔离测试', author: 't' },
    cookie: cookieA,
  });
  check('A POST /api/agent/start → 200 + taskId', tA.status === 200 && !!tA.data?.taskId, `status=${tA.status}`);
  const taskA = tA.data?.taskId;

  // 等待第一个 phase 启动，调试会话建立
  await wait(4000);

  // ---- 2. B 视角：A 的 agent 任务不可见 ----
  const bGet = await req(`/api/agent/start?taskId=${taskA}`, { cookie: cookieB });
  check('B 查询 A 的 agent 任务 → 404', bGet.status === 404, String(bGet.status));
  const bStream = await req(`/api/agent/stream/${taskA}`, { cookie: cookieB });
  check('B 订阅 A 的 agent SSE → 404', bStream.status === 404, String(bStream.status));
  const bLogs = await req(`/api/debug/agent-logs?taskId=${taskA}`, { cookie: cookieB });
  check('B 读取 A 的调试会话 → 404', bLogs.status === 404, String(bLogs.status));
  const bList = await req('/api/debug/agent-logs', { cookie: cookieB });
  check(
    'B 的会话列表不含 A 的任务',
    !(bList.data?.sessions ?? []).some((s) => s.taskId === taskA),
    `B sessions=${(bList.data?.sessions ?? []).length}`,
  );

  // ---- 3. A 视角：自己可见 ----
  const aGet = await req(`/api/agent/start?taskId=${taskA}`, { cookie: cookieA });
  check('A 查询自己的 agent 任务 → 200', aGet.status === 200, String(aGet.status));
  const aLogs = await req(`/api/debug/agent-logs?taskId=${taskA}`, { cookie: cookieA });
  check('A 读取自己的调试会话 → 200', aLogs.status === 200, String(aLogs.status));
  const aList = await req('/api/debug/agent-logs', { cookie: cookieA });
  check(
    'A 的会话列表包含自己的任务',
    (aList.data?.sessions ?? []).some((s) => s.taskId === taskA),
    `A sessions=${(aList.data?.sessions ?? []).length}`,
  );
  try {
    const aSse = await fetch(BASE + `/api/agent/stream/${taskA}`, { headers: { Cookie: cookieA } });
    check('A 订阅自己的 agent SSE → 200', aSse.status === 200, String(aSse.status));
    aSse.body?.cancel();
  } catch (e) {
    check('A 订阅自己的 agent SSE → 200', false, e.message);
  }

  // ---- 4. A 创建 pipeline job，flow-eval 归属 ----
  const pA = await req('/api/pipeline/start', {
    method: 'POST',
    body: { novelText: '短篇\n少年远行，入江湖。', title: '隔离', author: 't', selectedChapters: [] },
    cookie: cookieA,
  });
  check('A POST /api/pipeline/start → 200 + jobId', pA.status === 200 && !!pA.data?.jobId, `status=${pA.status}`);
  const jobA = pA.data?.jobId;
  if (jobA) {
    const bEval = await req(`/api/debug/flow-eval?jobId=${jobA}`, { cookie: cookieB });
    check('B 评测 A 的 job → 404', bEval.status === 404, String(bEval.status));
    const aEval = await req(`/api/debug/flow-eval?jobId=${jobA}`, { cookie: cookieA });
    check('A 评测自己的 job → 200', aEval.status === 200, String(aEval.status));
  }

  // ---- 5. A 创建内存队列 job，events 归属 ----
  const jA = await req('/api/jobs', {
    method: 'POST',
    body: { novelText: 'x' },
    cookie: cookieA,
  });
  check('A POST /api/jobs → 201 + job.id', jA.status === 201 && !!jA.data?.job?.id, `status=${jA.status}`);
  const qA = jA.data?.job?.id;
  if (qA) {
    const bEv = await req(`/api/jobs/${qA}/events`, { cookie: cookieB });
    check('B 订阅 A 的队列 job events → 404', bEv.status === 404, String(bEv.status));
    try {
      const aEv = await fetch(BASE + `/api/jobs/${qA}/events`, { headers: { Cookie: cookieA } });
      check('A 订阅自己的队列 job events → 200', aEv.status === 200, String(aEv.status));
      aEv.body?.cancel();
    } catch (e) {
      check('A 订阅自己的队列 job events → 200', false, e.message);
    }
  }

  console.log(failures === 0 ? '\nALL OK' : `\nE2E FAILED (${failures} 项失败)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
