// E2E 验证 P0-4：Agent 对话后端链路
// 1. 注册测试用户 2. POST /api/agent/start 启动真实转换 3. 轮询阶段状态 4. 验证四阶段推进
const USERNAME = 'p04_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const NOVEL = `夜雨敲窗，林小满伏在案前修改剧本。桌上摊开的小说泛黄，第三幕的字迹被反复划改。她抬头看向窗外，雨丝连成银线。

陈默推门进来，抖落肩头的雨水："这么晚还在改？"
"导演明天要看第三幕。"林小满头也不抬，笔尖沙沙作响。
陈默走近，瞥见满纸红笔："这场戏的台词太满了。"
"我知道。"林小满搁笔，揉了揉眉心，"但删掉哪句都舍不得。"

凌晨三点，两人终于敲定终稿。林小满望向窗外渐收的雨势，轻轻呼出一口气。`;

async function main() {
  const BASE = 'http://localhost:3001';
  // 1. 注册
  const reg = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  const regData = await reg.json();
  if (!reg.ok) throw new Error(`register failed: ${JSON.stringify(regData)}`);
  console.log(`[1] 注册成功: ${USERNAME}`);

  // 2. 启动 Agent 任务（真实 LLM 编排）
  const t0 = Date.now();
  const start = await fetch(`${BASE}/api/agent/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      novelText: NOVEL,
      title: '雨夜改稿',
      author: '测试作者',
      instruction: '对白更口语化，强化雨夜氛围',
    }),
  });
  const startData = await start.json();
  if (!start.ok) throw new Error(`start failed: ${JSON.stringify(startData)}`);
  const taskId = startData.taskId;
  console.log(`[2] Agent 任务已启动: ${taskId} (${(Date.now() - t0).toFixed(0)}ms)`);

  // 3. 轮询阶段状态（最多 300s）
  const seen = new Set();
  let completed = false, failed = false;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const res = await fetch(`${BASE}/api/agent/start?taskId=${taskId}`);
    const d = await res.json();
    if (!res.ok) {
      console.log(`   [poll] ${d.error}`);
      break;
    }
    const statuses = (d.phases ?? []).map((p) => `${p.name}=${p.status}`).join(', ');
    if (statuses && !seen.has(statuses)) {
      seen.add(statuses);
      console.log(`   [poll ${((Date.now() - t0) / 1000).toFixed(0)}s] ${statuses}`);
    }
    if (d.failed) { failed = true; break; }
    if (d.completed) { completed = true; break; }
  }

  if (failed) throw new Error('Agent 任务失败');
  if (!completed) throw new Error('Agent 任务超时未完成');
  console.log(`[3] 四阶段全部完成，总耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('ALL OK');
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
