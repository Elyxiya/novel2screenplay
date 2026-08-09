// p1-2 E2E：双执行系统收敛验证
// 验证目标（D6：保留 PipelineEngine + jobStore 主链路，内存队列标记预留）：
// 1. 内存队列暴露面已移除：/api/jobs POST/GET、/api/jobs/[id] GET（405）、/api/jobs/[id]/events → 404
// 2. SQLite 主链路正常：/api/jobs/history GET 需登录、POST /api/pipeline/start 创建持久化任务
// 3. DELETE /api/jobs/[id]（历史页实际使用）：归属校验 + 不存在 404
const BASE = 'http://localhost:3001';
const PASSWORD = 'pass-123456';
const U = 'p12_' + Date.now().toString(36).slice(-6);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail = '') {
  const pass = !!cond;
  if (!pass) failures++;
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ` → ${detail}` : ''}`);
}

async function login() {
  await fetch(BASE + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U, password: PASSWORD }),
  });
  const res = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: U, password: PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败: ${U}`);
  return setCookie.split(';')[0];
}

async function req(path, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function main() {
  // ---- 0. 未登录：history 401 ----
  const u = await req('/api/jobs/history');
  check('未登录 GET /api/jobs/history → 401', u.status === 401, String(u.status));

  const cookie = await login();
  console.log(`[登录] ${U}`);

  // ---- 1. 内存队列暴露面已移除（p1-2 收敛） ----
  const p1 = await req('/api/jobs', { method: 'POST', body: { novelText: 'x' }, cookie });
  check('POST /api/jobs（队列创建）→ 404', p1.status === 404, String(p1.status));
  const g1 = await req('/api/jobs', { cookie });
  check('GET /api/jobs（队列列表）→ 404', g1.status === 404, String(g1.status));
  const g2 = await req('/api/jobs/some-job', { cookie });
  check('GET /api/jobs/[id]（队列详情）→ 405（仅 DELETE 保留）', g2.status === 405, String(g2.status));
  const g3 = await req('/api/jobs/some-job/events', { cookie });
  check('GET /api/jobs/[id]/events（队列 SSE）→ 404', g3.status === 404, String(g3.status));

  // ---- 2. SQLite 主链路正常 ----
  const h1 = await req('/api/jobs/history', { cookie });
  check('GET /api/jobs/history → 200 + jobs[]', h1.status === 200 && Array.isArray(h1.data?.jobs), `status=${h1.status}`);

  const p = await req('/api/pipeline/start', {
    method: 'POST',
    body: { novelText: '短篇\n少年远行，入江湖。', title: '收敛测试', author: 't', selectedChapters: [] },
    cookie,
  });
  check('POST /api/pipeline/start（主链路）→ 200 + jobId', p.status === 200 && !!p.data?.jobId, `status=${p.status}`);
  const jobId = p.data?.jobId;
  if (jobId) {
    await wait(1500);
    const h2 = await req('/api/jobs/history', { cookie });
    check('history 包含新任务', (h2.data?.jobs ?? []).some((j) => j.id === jobId), `jobs=${(h2.data?.jobs ?? []).length}`);

    // ---- 3. DELETE（历史页使用）：归属 + 清理 ----
    const d1 = await req(`/api/jobs/${jobId}`, { method: 'DELETE', cookie });
    check('DELETE /api/jobs/[id]（本人）→ 200', d1.status === 200, String(d1.status));
    const d2 = await req(`/api/jobs/${jobId}`, { method: 'DELETE', cookie });
    check('DELETE 已删除任务 → 404', d2.status === 404, String(d2.status));
    const d3 = await req('/api/jobs/does-not-exist', { method: 'DELETE', cookie });
    check('DELETE 不存在任务 → 404', d3.status === 404, String(d3.status));
  }

  console.log(failures === 0 ? '\nALL OK' : `\nE2E FAILED (${failures} 项失败)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
