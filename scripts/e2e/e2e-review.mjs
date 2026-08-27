// E2E 验证 p1-5：质量关卡人工介入全链路
// 前提：merge 关卡阈值临时调高（触发 awaiting）
// 1. 注册 2. 启动任务 3. 轮询到 awaiting=true 4. POST /api/agent/review approve
// 5. 轮询到 completed
const USERNAME = 'p15_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。

陈默推门进来，抖落肩头的雨水："这么晚还在改？"
"导演明天要看第三幕。"林小满头也不抬，笔尖沙沙作响。
陈默走近，瞥见满纸红笔："这场戏的台词太满了。"
"我知道。"林小满搁笔，揉了揉眉心，"但删掉哪句都舍不得。"

凌晨三点，两人终于敲定终稿。林小满望向窗外渐收的雨势，轻轻呼出一口气。`;

async function main() {
  const BASE = 'http://localhost:3001';
  const headers = (cookie) => ({ 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) });

  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (!reg.ok) throw new Error('register failed');
  console.log('[1] 注册成功:', USERNAME);

  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const setCookie = login.headers.get('set-cookie');
  if (!setCookie) throw new Error('login failed');
  const cookie = setCookie.split(';')[0];

  // 0. 未登录调用 review → 401（鉴权补漏验证）
  const unauth = await fetch(`${BASE}/api/agent/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: 'x', phaseId: 'y', action: 'approve' }),
  });
  if (unauth.status !== 401) throw new Error(`未登录 review 应 401，实际 ${unauth.status}`);
  console.log('[0] 未登录 review → 401 ✓');

  const start = await fetch(`${BASE}/api/agent/start`, {
    method: 'POST',
    headers: headers(cookie),
    body: JSON.stringify({ novelText: NOVEL, title: '雨夜改稿', author: '测试作者' }),
  });
  const startData = await start.json();
  if (!start.ok) throw new Error(`start failed: ${JSON.stringify(startData)}`);
  const taskId = startData.taskId;
  console.log('[2] Agent 任务已启动:', taskId);

  // 3. 轮询直到 awaiting（最多 300s）
  const t0 = Date.now();
  let awaitingPhase = null;
  let phaseLog = '';
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/api/agent/start?taskId=${taskId}`, { headers: headers(cookie) });
    const d = await res.json();
    if (!res.ok) throw new Error(`poll failed: ${d.error}`);
    const statuses = (d.phases ?? []).map((p) => `${p.name}=${p.status}`).join(', ');
    if (statuses !== phaseLog) {
      phaseLog = statuses;
      console.log(`   [poll ${((Date.now() - t0) / 1000).toFixed(0)}s] ${statuses}${d.awaiting ? ' ← AWAITING' : ''}`);
    }
    if (d.awaiting) {
      awaitingPhase = d.awaitingPhase;
      console.log(`[3] 任务挂起等待人工介入: ${d.awaitingPhase.name} - ${d.awaitingPhase.reason}`);
      break;
    }
    if (d.failed) throw new Error('任务失败');
  }
  if (!awaitingPhase) throw new Error('未进入 awaiting 状态（超时）');

  // 4. 人工介入：approve
  const rev = await fetch(`${BASE}/api/agent/review`, {
    method: 'POST',
    headers: headers(cookie),
    body: JSON.stringify({ taskId, phaseId: awaitingPhase.phaseId, action: 'approve' }),
  });
  const revData = await rev.json();
  if (!rev.ok) throw new Error(`review failed: ${JSON.stringify(revData)}`);
  console.log('[4] 人工介入 approve 已提交:', revData.message);

  // 5. 轮询到 completed
  let completed = false;
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/api/agent/start?taskId=${taskId}`, { headers: headers(cookie) });
    const d = await res.json();
    if (d.completed) { completed = true; break; }
    if (d.failed) throw new Error(`任务失败: ${JSON.stringify(d)}`);
  }
  if (!completed) throw new Error('人工介入后任务未完成（超时）');
  console.log(`[5] 人工介入后任务完成，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('ALL OK');
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
