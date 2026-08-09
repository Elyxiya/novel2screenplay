// p1-3 E2E：API 鉴权补漏验证
// 1. 未登录调用 6 个端点 → 全部 401
// 2. 登录后调用 → 鉴权放行（非 401）
const BASE = 'http://localhost:3001';
const USERNAME = 'p13_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';

let cookie = '';

async function req(path, { method = 'GET', body, withCookie = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (withCookie && cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  // ---- 1. 未登录：全部应 401 ----
  const unauth = [
    ['POST', '/api/agent/start', { novelText: 'x' }],
    ['GET', '/api/agent/start?taskId=abc'],
    ['GET', '/api/agent/stream/abc'],
    ['GET', '/api/debug/agent-logs'],
    ['DELETE', '/api/debug/agent-logs'],
    ['GET', '/api/debug/flow-eval?jobId=abc'],
  ];
  let ok = true;
  for (const [method, path, body] of unauth) {
    const r = await req(path, { method, body });
    const pass = r.status === 401;
    if (!pass) ok = false;
    console.log(`[未登录] ${method} ${path} → ${r.status} ${pass ? '✓ 401 拦截' : '✗ 未拦截!'}`);
  }

  // ---- 2. 注册 + 登录 ----
  await req('/api/auth/register', { method: 'POST', body: { username: USERNAME, password: PASSWORD } });
  const loginRes = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) throw new Error('登录失败，未返回 cookie');
  cookie = setCookie.split(';')[0];
  console.log(`[登录] ${USERNAME} cookie=${cookie.slice(0, 20)}...`);

  // ---- 3. 登录后：鉴权应放行 ----
  const authChecks = [
    ['GET', '/api/debug/agent-logs'],
    ['DELETE', '/api/debug/agent-logs'],
    ['GET', '/api/debug/flow-eval?jobId=definitely_not_exists'],
  ];
  for (const [method, path] of authChecks) {
    const r = await req(path, { method, withCookie: true });
    const pass = r.status !== 401;
    if (!pass) ok = false;
    console.log(`[登录后] ${method} ${path} → ${r.status} ${pass ? '✓ 放行' : '✗ 误拦截!'}`);
  }

  // 登录后启动 Agent 任务（鉴权放行 + 真实可用）
  const start = await req('/api/agent/start', {
    method: 'POST',
    body: { novelText: '第一章 风起，少年执剑出门。', title: '鉴权测试', author: 't' },
    withCookie: true,
  });
  if (start.status !== 200 || !start.data?.taskId) { ok = false; console.log(`[登录后] POST /api/agent/start → ${start.status} ✗`); }
  else console.log(`[登录后] POST /api/agent/start → 200 ✓ taskId=${start.data.taskId}`);

  const q = await req(`/api/agent/start?taskId=${start.data?.taskId ?? 'none'}`, { withCookie: true });
  const passQ = q.status === 200;
  if (!passQ) ok = false;
  console.log(`[登录后] GET /api/agent/start → ${q.status} ${passQ ? '✓ 放行' : '✗'}`);

  // 登录后 SSE 订阅：非 401 即可（连接建立后读取首行即关）
  try {
    const sseRes = await fetch(BASE + '/api/agent/stream/' + (start.data?.taskId ?? 'abc'), {
      headers: { Cookie: cookie },
    });
    const passSse = sseRes.status === 200;
    if (!passSse) ok = false;
    console.log(`[登录后] GET /api/agent/stream → ${sseRes.status} ${passSse ? '✓ 放行' : '✗'}`);
    sseRes.body?.cancel();
  } catch { ok = false; console.log('[登录后] GET /api/agent/stream → 异常 ✗'); }

  console.log(ok ? '\nALL OK' : '\nE2E FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
