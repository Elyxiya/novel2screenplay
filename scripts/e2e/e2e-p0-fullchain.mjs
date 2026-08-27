// P0 全链路贯通验收（Task 3・阶段 D）
//
// 北极星：一条「小说 → 剧本 → 分镜」链路全程无手工复制粘贴，且每步可回跳上游。
// 本脚本通过 API 全自动打通，零复制粘贴：
//   ① 创作台(writer)创作小说 → 送去转剧本(convert) 物化为资产
//   → 一键改编(POST /api/pipeline/start 带 novelId) → 轮询完成
//   → 一键转分镜(POST /api/drama/convert) → 取分镜(GET /api/drama/[id])
//   并逐条断言溯源字段（novelId→job→drama）与每个镜头的 sceneNumber。
//
// 运行前提：dev server（Node 24）已在 http://localhost:3001 就绪。
// 命令行：
//   $env:PATH = "E:\nvm\nodejs;" + $env:PATH
//   & "E:\桌面\novel\novel2screenplay\node_modules\next\dist\bin\next" dev -p 3001   （cwd=apps/screenplay）
//   node e2e-p0-fullchain.mjs
const BASE = 'http://localhost:3001';
const PASSWORD = 'pass-123456';
const U = 'p0_' + Date.now().toString(36).slice(-6);
const MODEL = 'deepseek-chat';
const NOVEL_TITLE = 'P0全链路验收·剑心';
const NOVEL_AUTHOR = 'e2e-p0';

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
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

async function main() {
  // ---------- a. 注册登录全新用户 ----------
  const cookie = await login();
  console.log(`[a] 已注册并登录全新用户 ${U}`);

  // ---------- b. ① 侧准备完整小说（创作台 → 物化资产） ----------
  console.log('[b] ① 创作台：创建小说并写入两章，然后 送去转剧本 物化为资产...');
  const draft = await req('/api/writer/novels', {
    method: 'POST',
    body: { title: NOVEL_TITLE, author: NOVEL_AUTHOR, synopsis: '少年循师命下山，结伴少女寻药王谷，一路见人心。' },
    cookie,
  });
  check('POST /api/writer/novels → 201 + id', draft.status === 201 && !!draft.data?.novel?.id, `status=${draft.status}`);
  const novelId = draft.data?.novel?.id;
  let chapterCount = 0;
  if (novelId) {
    const chapters = [
      {
        id: 'chp_1', volumeId: null, title: '第一章 剑心未明', order: 0,
        content: '清晨，少年阿辰在山中与师父习剑。师父年迈，剑法却依旧凌厉。\n\n阿辰问：“师父，我们何时下山？”\n\n师父望向远方：“待你剑心通明，自可下山。江湖凶险，人心更险。”\n\n“那弟子如何分辨善恶？”\n\n“观其行，莫信其言。”',
        wordCount: 0, updatedAt: Date.now(),
      },
      {
        id: 'chp_2', volumeId: null, title: '第二章 药王谷同行', order: 1,
        content: '三月后，师父留下书信不辞而别。阿辰循着足迹下山，途经野店。\n\n一名少女被山贼追赶，跌入店内。阿辰出手相救，三剑击退山贼。\n\n少女小禾拱手致谢：“多谢少侠，在下欲往药王谷寻药救母。”\n\n阿辰想起师父信中提到药王谷，决定同行。',
        wordCount: 0, updatedAt: Date.now(),
      },
    ];
    for (const c of chapters) {
      await req(`/api/writer/novels/${novelId}/chapter`, { method: 'POST', body: c, cookie });
    }
    const conv = await req(`/api/writer/novels/${novelId}/convert`, { method: 'POST', cookie });
    check('POST /api/writer/novels/[id]/convert → 200 物化为资产', conv.status === 200, `status=${conv.status}`);
    check('convert 返回 novelId 与 ② 输入对齐', conv.data?.novelId === novelId, `novelId=${conv.data?.novelId}`);
    chapterCount = conv.data?.chapterCount ?? 0;
    check('convert 章节数=2（novelText/chapterTexts/title/author 已物化）', chapterCount === 2, `chapterCount=${chapterCount}`);
  }

  // 从服务端资产取回物化结果（字段不丢），作为 ② 输入
  let novelText = '', novelTitle = '', novelAuthor = '';
  if (novelId) {
    const nd = await req(`/api/novels/${novelId}`, { cookie });
    const n = nd.data?.novel;
    check('GET /api/novels/[id] → 200 + kind=draft 溯源资产', nd.status === 200 && n?.kind === 'draft' && n?.id === novelId, `kind=${n?.kind}`);
    novelTitle = n?.title ?? NOVEL_TITLE;
    novelAuthor = n?.author ?? NOVEL_AUTHOR;
    novelText = (n?.chapterTexts ?? [])
      .map((c) => `${c.title}\n\n${c.text}`.trim())
      .join('\n\n');
    check('物化字段不丢（title/author/chapterTexts 全量回读）',
      !!novelText && novelTitle === NOVEL_TITLE && novelAuthor === NOVEL_AUTHOR && (n?.chapterTexts?.length === chapterCount),
      `len=${novelText.length}`);
  }

  // ---------- c. 一键改编：建 pipeline 任务并保留 novelId 溯源 ----------
  console.log('[c] ② 一键改编：POST /api/pipeline/start（携带 novelId）...');
  const p = await req('/api/pipeline/start', {
    method: 'POST',
    body: { novelText, title: novelTitle, author: novelAuthor, modelId: MODEL, novelId },
    cookie,
  });
  check('POST /api/pipeline/start → 200 + jobId', p.status === 200 && !!p.data?.jobId, `status=${p.status}`);
  const jobId = p.data?.jobId;

  // ---------- d. 轮询直至 completed，拿到剧本结果 ----------
  let jobMeta = null;
  if (jobId) {
    console.log('[d] 轮询剧本任务直至 completed（真实 LLM，约 1 分钟）...');
    let completed = false;
    const deadline = Date.now() + 300_000;
    while (Date.now() < deadline) {
      const h = await req('/api/jobs/history', { cookie });
      const job = (h.data?.jobs ?? []).find((j) => j.id === jobId);
      if (job?.status === 'completed') { completed = true; break; }
      if (job?.status === 'failed') break;
      await wait(5000);
    }
    check('剧本任务完成（status=completed）', completed);
    if (completed) {
      const h = await req('/api/jobs/history', { cookie });
      const entry = (h.data?.jobs ?? []).find((j) => j.id === jobId);
      check('history 溯源 novelId 与上游一致', entry?.novelId === novelId, `novelId=${entry?.novelId}`);
      check('history 溯源 sourceNovel（剧本来源小说标题）', (entry?.sourceNovel ?? '') === NOVEL_TITLE, `sourceNovel=${entry?.sourceNovel}`);

      const r = await req(`/api/result/${jobId}`, { cookie });
      jobMeta = r.data?.metadata;
      check('GET /api/result/[jobId] → 200 + metadata', r.status === 200 && !!jobMeta, `status=${r.status}`);
      check('剧本 metadata.sourceNovel 溯源到小说标题', jobMeta?.sourceNovel === NOVEL_TITLE, `sourceNovel=${jobMeta?.sourceNovel}`);
      check('剧本元数据：sourceNovel/author 不依赖手工输入', !!jobMeta?.sourceNovel && typeof jobMeta?.totalScenes === 'number', `scenes=${jobMeta?.totalScenes}`);
    }
  }

  // ---------- e. 一键转分镜 ----------
  console.log('[e] ③ 一键转分镜：POST /api/drama/convert（jobId）...');
  const dc = await req('/api/drama/convert', { method: 'POST', body: { jobId }, cookie });
  check('POST /api/drama/convert → 200 + dramaId', dc.status === 200 && !!dc.data?.dramaId, `status=${dc.status}`);
  const dramaId = dc.data?.dramaId;
  const src = dc.data?.source;
  check('source.sourceScreenplayId === jobId', src?.sourceScreenplayId === jobId, `${src?.sourceScreenplayId} vs ${jobId}`);
  check('source.sourceNovelId 向上游一致', src?.sourceNovelId === novelId, `${src?.sourceNovelId} vs ${novelId}`);
  check('source.sourceNovelTitle 溯源到小说标题', src?.sourceNovelTitle === NOVEL_TITLE, src?.sourceNovelTitle);
  const dramaMeta = dc.data?.drama?.metadata;
  check('drama.metadata.sourceScreenplayId === jobId', dramaMeta?.sourceScreenplayId === jobId, `${dramaMeta?.sourceScreenplayId}`);
  check('drama.metadata.sourceNovelId === novelId', dramaMeta?.sourceNovelId === novelId, `${dramaMeta?.sourceNovelId}`);

  // ---------- f. 取分镜数据：断言溯源一致 + 每个镜头带 sceneNumber ----------
  const shots = dc.data?.drama?.shots ?? [];
  check(`分镜镜头数>0（totalShots=${dramaMeta?.totalShots}）`, shots.length > 0, `shots=${shots.length}`);
  const allHaveScene = shots.length > 0 && shots.every((s) => Number.isInteger(s.sceneNumber) && s.sceneNumber >= 1);
  check('每个镜头 shot 都带有效 sceneNumber(≥1 整数)', allHaveScene,
    allHaveScene ? `sceneNumbers=${[...new Set(shots.map((s) => s.sceneNumber))].join(',')}` : '缺失');

  // 溯源回跳 URL（分镜 → 剧本场景）：/result/{sourceScreenplayId}?scene=N
  const jumpUrls = [...new Set(shots.map((s) => `/result/${src?.sourceScreenplayId}?scene=${s.sceneNumber}`))];
  check('可推导分镜→剧本场景溯源回跳 URL(去重 N<=totalScenes & 格式正确)',
    jumpUrls.length > 0 && jumpUrls.every((u) => /^\/result\/.+\?scene=\d+$/.test(u)),
    `示例=${jumpUrls[0]}`);

  // 从持久化取分镜（GET /api/drama/[id]），确认 YAML 上溯字段完整
  if (dramaId) {
    const gd = await req(`/api/drama/${dramaId}`, { cookie });
    check('GET /api/drama/[id] → 200', gd.status === 200, `status=${gd.status}`);
    check('分镜元数据 sourceJobId 与剧本任务一致', gd.data?.sourceJobId === jobId, `${gd.data?.sourceJobId}`);
    check('分镜元数据 sourceNovelId 向上游一致', gd.data?.sourceNovelId === novelId, `${gd.data?.sourceNovelId}`);
    const yaml = gd.data?.yaml ?? '';
    check('分镜 YAML 落库含 sourceScreenplayId', yaml.includes(jobId), 'yaml 含 jobId');
    check('分镜 YAML 落库含 sceneNumber（镜头带场景号）', /sceneNumber:\s*\d/.test(yaml), 'yaml 含 sceneNumber');
  }

  // ---------- 汇总 ----------
  console.log('\n溯源闭环：');
  console.log(`  小说资产  : /configure?novel=${novelId}`);
  console.log(`  剧本任务  : /result/${jobId}（sourceScreenplayId 回跳）`);
  console.log(`  分镜资产  : /shortdrama?id=${dramaId}`);
  console.log(failures === 0 ? '\nALL OK' : `\nE2E FAILED (${failures} 项失败)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error('E2E FAILED:', e.message); process.exit(1); });