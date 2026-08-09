// P-评估 E2E：传统管线接 LLM 评估 + 质量基准集
// 1. 创建 pipeline 任务（真实 LLM 4 阶段转换），完成后验证 job.pipelineState.qualityAssessment 被写入
// 2. GET /api/debug/flow-eval 返回 llmAssessment（分数 0-100 + 四维）
// 3. POST /api/debug/quality-benchmark 运行基准集（3 次 LLM 调用），验证区分度排序
const BASE = 'http://localhost:3001';
const PASSWORD = 'pass-123456';
const U = 'peval_' + Date.now().toString(36).slice(-6);
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
  // ---- 0. 未登录：quality-benchmark 401 ----
  const u = await req('/api/debug/quality-benchmark', { method: 'POST' });
  check('未登录 POST /api/debug/quality-benchmark → 401', u.status === 401, String(u.status));

  const cookie = await login();
  console.log(`[登录] ${U}`);

  // ---- 1. 传统管线：创建任务并等待完成 ----
  console.log('[1/3] 创建 pipeline 任务（真实 LLM 4 阶段转换，约 1 分钟）...');
  const p = await req('/api/pipeline/start', {
    method: 'POST',
    body: {
      novelText: '短篇\n少年阿辰自幼在山中与师父习剑。一日师父下山未归，阿辰循踪迹踏入江湖，沿途救下一名被山贼追捕的少女小禾，二人结伴前往传说中的药王谷寻找师父的下落。',
      title: 'P-评估验证',
      author: 'e2e',
      selectedChapters: [],
    },
    cookie,
  });
  check('POST /api/pipeline/start → 200 + jobId', p.status === 200 && !!p.data?.jobId, `status=${p.status}`);
  const jobId = p.data?.jobId;

  if (jobId) {
    let completed = false;
    const deadline = Date.now() + 240_000;
    while (Date.now() < deadline) {
      const h = await req('/api/jobs/history', { cookie });
      const job = (h.data?.jobs ?? []).find((j) => j.id === jobId);
      if (job?.status === 'completed') { completed = true; break; }
      if (job?.status === 'failed') break;
      await wait(5000);
    }
    check('管线任务完成（status=completed）', completed);

    // ---- 2. LLM 质量评估（complete 后异步写入 pipelineState.qualityAssessment）----
    let assessment = null;
    const evalDeadline = Date.now() + 120_000;
    while (Date.now() < evalDeadline) {
      const fe = await req(`/api/debug/flow-eval?jobId=${jobId}`, { cookie });
      if (fe.data?.llmAssessment) { assessment = fe.data.llmAssessment; break; }
      await wait(5000);
    }
    check('flow-eval 返回 llmAssessment（LLM 四维评估已写入）', !!assessment, assessment ? `score=${assessment.score}` : 'null');
    if (assessment) {
      check('评估分数在 0-100', assessment.score >= 0 && assessment.score <= 100, String(assessment.score));
      check('四维齐全（format/consistency/coherence/drama）',
        [assessment.dimensions.format, assessment.dimensions.consistency, assessment.dimensions.coherence, assessment.dimensions.drama]
          .every((v) => typeof v === 'number'),
        JSON.stringify(assessment.dimensions));
      check('passed 布尔字段', typeof assessment.passed === 'boolean', String(assessment.passed));
      console.log(`   LLM 评估：${assessment.score} 分 | F=${assessment.dimensions.format} C=${assessment.dimensions.consistency} Co=${assessment.dimensions.coherence} D=${assessment.dimensions.drama}`);
      if (assessment.suggestions?.length) {
        console.log(`   建议：${assessment.suggestions.slice(0, 2).join('；')}`);
      }
    }
  }

  // ---- 3. 质量基准集（3 次 LLM 调用，验证区分度）----
  console.log('[3/3] 运行质量基准集（3 次 LLM 调用）...');
  const bm = await req('/api/debug/quality-benchmark', { method: 'POST', cookie });
  check('POST /api/debug/quality-benchmark → 200', bm.status === 200, `status=${bm.status}`);
  if (bm.status === 200) {
    const report = bm.data?.report;
    check('基准报告含 3 个样本', report?.samples?.length === 3, `samples=${report?.samples?.length}`);
    check('区分度排序有效（excellent > fair > poor）', report?.orderValid === true, String(report?.orderValid));
    for (const s of report?.samples ?? []) {
      console.log(`   [${s.id}] ${s.score} 分（预期 ${s.expectedGrade}，实际 ${s.grade}${s.withinExpectation ? ' ✓' : ' ✗'}）F=${s.dimensions.format} C=${s.dimensions.consistency} Co=${s.dimensions.coherence} D=${s.dimensions.drama}`);
    }
  }

  console.log(failures === 0 ? '\nALL OK' : `\nE2E FAILED (${failures} 项失败)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });
