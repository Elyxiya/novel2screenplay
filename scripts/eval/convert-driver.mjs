/**
 * 转换驱动（共享基建）——prompt-diff（B-07）与 drift（B-02）共用
 *
 * 自包含 HTTP 驱动：注册临时用户→登录→POST /api/pipeline/start→轮询至终态
 * →从隔离库直读 pipeline_state→导出 scenes/run 产物。不依赖 run-conversion.mjs。
 *
 * 前提：目标 dev server 就绪（其 CONVERT_PROMPT_FILE/模型/DB_DIR/DB_FILE 决定运行口径）；
 *       本模块读取的隔离库须与 server 一致（默认 apps/screenplay/data-test/1b-data.db）。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// better-sqlite3 由根 node_modules hoist（与 run-conversion.mjs 同款直连隔离库）
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));

const PASSWORD = 'pass-123456';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** 解析 #N 标题 分章 → [{title, text}]（与 run-conversion.mjs 同款解析，保证样本对齐） */
export function splitChapters(raw) {
  const blocks = raw.split(/^#\s*(\d+)\s+(.+)$/gm);
  const out = [];
  for (let i = 1; i < blocks.length; i += 3) {
    const text = (blocks[i + 2] ?? '').trim();
    if (!text) continue;
    out.push({ chapterNo: Number(blocks[i]), title: (blocks[i + 1] ?? '').trim(), text });
  }
  return out;
}

let _encoder = null;

/**
 * 估算输入 token 数（成本守卫用）。
 *
 * 为什么不是 `length * 0.6`：实测中文约 **1.3–1.4 token/字**
 * （doupo 28898 字 → 38451 token），旧系数低估约 2.2 倍，
 * 导致 `costCapCny` 在高估成本时不会如期拦截。优先用 tiktoken，不可用时回退 1.3 并告警。
 */
export function estimateInputTokens(text) {
  try {
    if (!_encoder) {
      const { get_encoding } = require('tiktoken');
      _encoder = get_encoding('cl100k_base');
    }
    return _encoder.encode(text).length;
  } catch (err) {
    console.warn(`[eval] tiktoken 不可用，回退 1.3 token/字估算：${err.message}`);
    return Math.round(text.length * 1.3);
  }
}

export function readPipelineState(jobId, dbDir, dbFile) {
  const dbPath = path.join(dbDir, dbFile);
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT pipeline_state, config FROM jobs WHERE id = ?').get(jobId);
    return row?.pipeline_state ? JSON.parse(row.pipeline_state) : null;
  } finally {
    db.close();
  }
}

/**
 * 读取 job 落库的分章正文（`chapter_texts` 列）。
 *
 * 为什么单独提供：这是**管线实际输入**，也是溯源检查的正确基准。
 * 此前 score.mjs 只读 pipelineState.chapterTexts（该字段不存在）→ 静默回退到 chapters.txt，
 * 与 snapshot 的 DB 列口径不一致，同一运行出现 95.1% 与 95.4% 两个数。
 */
export function readChapterTexts(jobId, dbDir, dbFile) {
  const dbPath = path.join(dbDir, dbFile);
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT chapter_texts FROM jobs WHERE id = ?').get(jobId);
    return row?.chapter_texts ? JSON.parse(row.chapter_texts) : null;
  } finally {
    db.close();
  }
}

/**
 * 读取 job 行内的落库 config（含 **实际使用的 modelId**）。
 * 为什么需要：resolveProvider 对未知 modelId 会静默回退默认 provider——
 * 横评矩阵必须记录 actual 模型，避免"请求 gpt-4o 实际跑了 deepseek"这类串标签。
 */
export function readJobConfig(jobId, dbDir, dbFile) {
  const dbPath = path.join(dbDir, dbFile);
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT config FROM jobs WHERE id = ?').get(jobId);
    return row?.config ? JSON.parse(row.config) : null;
  } finally {
    db.close();
  }
}

/**
 * 驱动一次完整转换并导出产物。
 * @param {{
 *   base: string, sampleDir: string, runLabel: string, side: string,
 *   model: string, timeoutMin: number, costCapCny: number, dbDir: string, dbFile: string,
 *   titlePrefix?: string,
 * }} opts
 * @returns {Promise<{ scenesJson: object, run: object }>}
 */
export async function driveConversion(opts) {
  const { base, sampleDir, runLabel, side, model, timeoutMin, costCapCny, dbDir, dbFile } = opts;
  const titlePrefix = opts.titlePrefix ?? 'pd';

  const req = async (pathname, { method = 'GET', body, cookie } = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* 非 JSON 响应 */ }
    return { status: res.status, data, text };
  };

  // 用户名约束：字母数字下划线、**≤20 字符**（titlePrefix 可能含 '-' 且偏长，如 model-matrix）
  const usrPrefix = String(titlePrefix).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 6);
  const usrSide = String(side).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 4);
  const usr = `${usrPrefix}_${usrSide}_${Date.now().toString(36).slice(-6)}`; // ≤18 字符
  const chapters = splitChapters(readFileSync(path.join(sampleDir, 'chapters.txt'), 'utf-8'));
  if (chapters.length === 0) throw new Error('未能按 #N 标题解析章节，请检查 chapters.txt');
  const novelText = chapters.map((c) => `${c.title}\n\n${c.text}`.trim()).join('\n\n');
  console.log(`[convert-driver] ${side}: ${chapters.length} 章 / ${novelText.length} 字符，base=${base}`);

  await req('/api/health');
  const regRes = await req('/api/auth/register', { method: 'POST', body: { username: usr, password: PASSWORD } });
  const loginRes = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: usr, password: PASSWORD }),
  });
  const setCookie = loginRes.headers.get('set-cookie');
  if (!setCookie) throw new Error(`${side}: 登录失败（register=${regRes.status}${regRes.data?.error ? ` ${regRes.data.error}` : ''}；用户名 ${usr}）`);
  const cookie = setCookie.split(';')[0];

  const estimatedInputTokens = estimateInputTokens(novelText);
  const estimateCny = Math.round(((estimatedInputTokens / 1_000_000) * 2) * 100) / 100;
  if (estimateCny > costCapCny) throw new Error(`${side}: 预估成本 ¥${estimateCny} 超红线 ¥${costCapCny}，中止`);

  const started = Date.now();
  const startRes = await req('/api/pipeline/start', {
    method: 'POST',
    body: { novelText, title: `${titlePrefix}-${runLabel}-${side}`, author: titlePrefix, modelId: model, selectedChapters: chapters.map((_, i) => i) },
    cookie,
  });
  if (!startRes.data?.jobId) throw new Error(`${side}: 启动失败 status=${startRes.status}: ${startRes.text?.slice(0, 200)}`);
  const jobId = startRes.data.jobId;
  console.log(`[convert-driver] ${side}: job=${jobId} 已启动`);

  let finalStatus = 'pending';
  let fed = 0;
  while (true) {
    if ((Date.now() - started) / 60000 > timeoutMin) { finalStatus = 'timeout'; break; }
    const s = await req(`/api/pipeline/status/${jobId}`, { cookie });
    finalStatus = s.data?.status ?? 'unknown';
    if (['completed', 'failed', 'error'].includes(finalStatus)) break;
    if (++fed % 12 === 0) console.log(`[convert-driver] ${side}: 轮询中 status=${finalStatus} (${((Date.now() - started) / 60000).toFixed(1)}min)`);
    await wait(5000);
  }
  const elapsedMs = Date.now() - started;
  console.log(`[convert-driver] ${side}: 终态=${finalStatus} 耗时=${(elapsedMs / 60000).toFixed(1)}min`);

  const pipelineState = readPipelineState(jobId, dbDir, dbFile) ?? {};
  const phase4 = pipelineState.phase4Output;
  const phase1 = pipelineState.phase1Output;
  if (!phase4 || !Array.isArray(phase4.scenes) || phase4.scenes.length === 0) {
    throw new Error(`${side}: 未取到 phase4Output.scenes（状态=${finalStatus}）——检查 dev server 日志`);
  }

  const p4Chars = Array.isArray(phase4.characters) ? phase4.characters : [];
  const phase1Names = new Set((Array.isArray(phase1?.characters) ? phase1.characters : []).map((c) => c.name));
  const charIdToName = Object.fromEntries(p4Chars.map((c) => [c.characterId, c.name]).filter(([id, n]) => id && n));
  const charIdSet = p4Chars.filter((c) => phase1Names.has(c.name)).map((c) => c.characterId);
  const aliasIndex = phase1?.aliasIndex ?? {};

  const jobConfig = readJobConfig(jobId, dbDir, dbFile);
  const actualModelId = jobConfig?.modelId ?? null;

  const scenesJson = {
    tag: `${titlePrefix}-${runLabel}-${side}`,
    generatedAt: new Date().toISOString(),
    jobId,
    scenes: phase4.scenes,
    charIdToName,
    charIdSet,
    aliasIndex,
  };
  writeFileSync(path.join(sampleDir, `${titlePrefix}-${runLabel}-${side}.scenes.json`), JSON.stringify(scenesJson, null, 2));
  const run = {
    sample: path.basename(sampleDir), tag: scenesJson.tag, model, actualModelId, jobId, finalStatus, elapsedMs,
    scenes: phase4.scenes.length,
    characters: phase4.characters?.length ?? 0,
    charIdSet: charIdSet.length,
    inputEstimateTokens: estimatedInputTokens,
    estimatedCostCny: estimateCny,
    costCapCny,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(path.join(sampleDir, `${titlePrefix}-${runLabel}-${side}.run.json`), JSON.stringify(run, null, 2));
  return { scenesJson, run };
}
