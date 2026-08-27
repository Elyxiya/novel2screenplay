// L2 局部追问 E2E（工作流脚本，不入库）
// 1. 注册+登录 2. SQL 注入一个 completed job（含 phase4Output + chapterTexts）
// 3. GET 结果页数据链路 4. POST /api/result/revise（scope=scene 真实调用 LLM）
// 5. 验证落库后场景内容已更新 6. scope=all 7. 异常分支（400/403/404）
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const BASE = 'http://localhost:3001';
const DB_PATH = path.join(ROOT, 'apps/screenplay/data/novel2screenplay.db');
const OUT = path.join(ROOT, 'pr-evidence');
mkdirSync(OUT, { recursive: true });

const USERNAME = 'l2_' + Date.now().toString(36).slice(-6);
const PASSWORD = 'pass-123456';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAPTERS = [
  '第一章：夜雨。林小满伏在案前改稿，窗外的雨丝连成银线。陈默推门进来，抖落肩头的雨水，问：稿子改得怎么样了？林小满头也不抬：还差最后一场戏。',
  '第二章：清晨。晨光透进办公室，林小满把改好的稿子递给陈默。陈默翻了两页，皱眉：结尾太仓促了。林小满叹气：我知道，但实在想不出更好的收尾。',
];

const SCREENPLAY = {
  formatVersion: 'novel2screenplay-v1',
  metadata: {
    title: '雨夜改稿',
    author: 'L2 验证',
    sourceNovel: '雨夜改稿',
    version: '1.0.0',
    createdAt: new Date().toISOString(),
    totalScenes: 2,
    totalCharacters: 2,
    totalLocations: 1,
  },
  characters: [
    { characterId: 'char_1', name: '林小满', aliases: ['小满'], personalityTags: ['认真'], description: '编剧', isMajor: true },
    { characterId: 'char_2', name: '陈默', aliases: [], personalityTags: ['沉稳'], description: '导演', isMajor: true },
  ],
  locations: [{ locationId: 'loc_1', name: '办公室', type: 'interior', description: '编剧工作室' }],
  scenes: [
    {
      sceneNumber: 1,
      slugline: '内景 · 办公室 - 夜',
      timeOfDay: 'night',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        { type: 'action', description: '林小满伏在案前修改剧本，窗外雨丝连成银线。', sourceRefs: [{ chapterIndex: 0, paragraphIndex: 0, excerpt: '夜雨。林小满伏在案前改稿。' }] },
        { type: 'dialogue', characterId: 'char_2', line: '稿子改得怎么样了？', direction: '推门进来', sourceRefs: [{ chapterIndex: 0, paragraphIndex: 0, excerpt: '陈默推门进来' }] },
        { type: 'dialogue', characterId: 'char_1', line: '还差最后一场戏。', sourceRefs: [{ chapterIndex: 0, paragraphIndex: 0, excerpt: '林小满头也不抬' }] },
      ],
      summary: '夜雨中林小满改稿，陈默关心进度',
      sourceChapterRange: [0, 0],
      confidence: 0.9,
    },
    {
      sceneNumber: 2,
      slugline: '内景 · 办公室 - 清晨',
      timeOfDay: 'morning',
      locationId: 'loc_1',
      characterIds: ['char_1', 'char_2'],
      content: [
        { type: 'action', description: '晨光透进办公室，林小满把改好的稿子递给陈默。', sourceRefs: [{ chapterIndex: 1, paragraphIndex: 0, excerpt: '林小满把改好的稿子递给陈默' }] },
        { type: 'dialogue', characterId: 'char_2', line: '结尾太仓促了。', direction: '翻了两页皱眉', sourceRefs: [{ chapterIndex: 1, paragraphIndex: 0, excerpt: '陈默翻了两页，皱眉' }] },
        { type: 'dialogue', characterId: 'char_1', line: '我知道，但实在想不出更好的收尾。', sourceRefs: [{ chapterIndex: 1, paragraphIndex: 0, excerpt: '林小满叹气' }] },
      ],
      summary: '清晨交稿，陈默指出结尾仓促',
      sourceChapterRange: [1, 1],
      confidence: 0.88,
    },
  ],
  analytics: {
    totalWords: 120,
    dialoguePercentage: 60,
    actionPercentage: 40,
    avgSceneLength: 60,
    longestScene: 70,
    shortestScene: 50,
  },
};

async function main() {
  // ── 1. 注册 + 登录 ──
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

  // ── 2. SQL 注入 completed job ──
  const jobId = 'l2-revise-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  const config = JSON.stringify({ modelId: 'deepseek-chat', selectedChapters: [0, 1], temperature: 0.7, title: '雨夜改稿', author: 'L2 验证' });
  const pipelineState = JSON.stringify({ phase4Output: SCREENPLAY });
  const db = new Database(DB_PATH);
  db.prepare(
    `INSERT INTO jobs (id, status, current_phase, progress, scenes_status, logs, created_at, updated_at, started_at, completed_at,
       novel_text, chapter_texts, config, pipeline_state, user_id)
     VALUES (?, 'completed', 4, 100, '[]', '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    jobId, now, now, now, now,
    CHAPTERS.join('\n'), JSON.stringify(CHAPTERS), config, pipelineState, login.user.id,
  );
  db.close();
  console.log(`[2] 已注入 completed job: ${jobId}（2 场景）`);

  // ── 3. GET 结果页数据链路 ──
  const getRes = await fetch(`${BASE}/api/result/${jobId}`, { headers: { Cookie: cookieHeader() } });
  const getData = await getRes.json();
  if (!getData.screenplay?.scenes?.length) throw new Error(`结果页数据链路失败: ${JSON.stringify(getData).slice(0, 300)}`);
  console.log(`[3] GET /api/result 可读: scenes=${getData.screenplay.scenes.length} chars=${getData.screenplay.characters.length} chapterTexts=${getData.chapterTexts?.length ?? 0}`);
  const before1 = JSON.stringify(getData.screenplay.scenes[0].content);

  // ── 4. POST revise scope=scene（场景 1：对白口语化）──
  const sceneReviseRes = await fetch(`${BASE}/api/result/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ jobId, sceneNumber: 1, instruction: '对白改得更口语化，林小满的语气要更疲惫', scope: 'scene' }),
  });
  const sceneRevise = await sceneReviseRes.json();
  if (!sceneRevise.success) throw new Error(`场景级 revise 失败: ${JSON.stringify(sceneRevise)}`);
  console.log(`[4] 场景级 revise 成功: ${sceneRevise.message} | totalUpdated=${sceneRevise.totalUpdated}`);

  // ── 5. 验证落库后场景内容已更新 ──
  const get2Res = await fetch(`${BASE}/api/result/${jobId}`, { headers: { Cookie: cookieHeader() } });
  const get2Data = await get2Res.json();
  const after1 = JSON.stringify(get2Data.screenplay.scenes[0].content);
  if (before1 === after1) throw new Error('场景 1 内容未变化（revise 未生效）');
  const s1 = get2Data.screenplay.scenes[0];
  if (s1.sceneNumber !== 1 || s1.locationId !== 'loc_1' || s1.timeOfDay !== 'night') {
    throw new Error(`场景基础字段被改动: sceneNumber=${s1.sceneNumber} loc=${s1.locationId} tod=${s1.timeOfDay}`);
  }
  const blockCount = s1.content.length;
  console.log(`[5] 场景 1 内容已更新: blocks=${blockCount} 基础字段(sceneNumber/locationId/timeOfDay)保持`);
  console.log(`    新 content 摘要: ${after1.slice(0, 200)}...`);

  // ── 6. POST revise scope=all ──
  const allReviseRes = await fetch(`${BASE}/api/result/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ jobId, instruction: '全剧对白更精炼，去掉重复的寒暄', scope: 'all' }),
  });
  const allRevise = await allReviseRes.json();
  if (!allRevise.success || allRevise.totalUpdated !== 2) {
    throw new Error(`全局 revise 失败: ${JSON.stringify(allRevise)}`);
  }
  console.log(`[6] 全局 revise 成功: ${allRevise.message} | totalUpdated=${allRevise.totalUpdated}`);

  // ── 7. 异常分支 ──
  // 7.1 空 instruction → 400
  const r400 = await fetch(`${BASE}/api/result/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ jobId, sceneNumber: 1, instruction: '   ', scope: 'scene' }),
  });
  const d400 = await r400.json();
  if (r400.status !== 400 || !d400.error) throw new Error(`空 instruction 应 400，实得 ${r400.status}`);
  console.log(`[7.1] 空 instruction → 400: ${d400.error}`);

  // 7.2 场景不存在 → 404
  const r404 = await fetch(`${BASE}/api/result/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader() },
    body: JSON.stringify({ jobId, sceneNumber: 99, instruction: '任何修改', scope: 'scene' }),
  });
  if (r404.status !== 404) throw new Error(`场景不存在应 404，实得 ${r404.status}`);
  console.log(`[7.2] 场景不存在 → 404: ${(await r404.json()).error}`);

  // 7.3 其他用户无权限 → 403
  const user2 = 'l2b_' + Date.now().toString(36).slice(-6);
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user2, password: PASSWORD }),
  });
  const login2Res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user2, password: PASSWORD }),
  });
  const jar2 = new Map();
  for (const c of login2Res.headers.getSetCookie?.() ?? []) {
    const [pair] = c.split(';');
    const idx = pair.indexOf('=');
    jar2.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
  }
  const cookie2 = [...jar2.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const r403 = await fetch(`${BASE}/api/result/revise`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie2 },
    body: JSON.stringify({ jobId, sceneNumber: 1, instruction: '任何修改', scope: 'scene' }),
  });
  if (r403.status !== 403) throw new Error(`无权限应 403，实得 ${r403.status}`);
  console.log(`[7.3] 其他用户无权限 → 403: ${(await r403.json()).error}`);

  // ── 8. 输出状态文件 ──
  writeFileSync(
    path.join(OUT, '.l2-revise-state.json'),
    JSON.stringify({ jobId, userId: login.user.id, username: USERNAME }, null, 2),
  );
  console.log(`[8] 状态已写入 ${OUT}/.l2-revise-state.json`);
  console.log('L2 REVISE OK ✅');
}

main().catch((e) => { console.error('L2 REVISE FAILED:', e.message); process.exit(1); });
