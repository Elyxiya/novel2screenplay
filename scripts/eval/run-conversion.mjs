#!/usr/bin/env node
/**
 * 转换运行为脚本（点 1b · medium 两步共用，付管线费）
 *
 *   node scripts/eval/run-conversion.mjs --sample <id> --tag <old|new>
 *
 * 通过 HTTP 驱动在线转换管线（e2e 同款式）：
 *   - 读 samples/<id>/chapters.txt（#N 标题分章）拼 novelText → 注册登录临时用户
 *     → POST /api/pipeline/start → 轮询 status 至 completed/超时
 *   - 从 pipelineState.phase4Output 提 scenes、phase1Output.characters 生
 *     charIdToName + charIdSet + aliasIndex → 写 <tag>.scenes.json
 *   - 写 <tag>.run.json（jobId/status/时长/token 估算/格子数）
 *
 * 成本节奏（依 1b-data-chain-medium-plan.md §3.2/§4.1）：
 *   - 旧路径：dev server 不带 PHASE1_MODE（默认 truncate），端口 3001；
 *   - 新路径：dev server 带 PHASE1_MODE=mapreduce，换端口（如 3002，--base 指向）。
 *   - 硬红线：单 job 显式超时（默认 90 分钟）到时导出 partial pipelineState 落
 *     <tag>.partial.json 供诊断，不静默挂起；费用硬上限（默认 ¥20，估算 token×费率）
 *     超出即中止并报告已消耗。两步之间必须按计划停点验收，勿连跑。
 *
 * 运行前提：dev server（Node 24）就绪；DEEPSEEK_API_KEY 配置于 server 环境。
 *   $node = "E:\nvm\nodejs\node.exe"
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');
const require = createRequire(import.meta.url);
// better-sqlite3 由根 node_modules hoist（项目基建），Node 24 编译，脚本直连隔离库用
const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// ── 配置 ─────────────────────────────────────────────────────────────────
const sample = arg('sample', 'xiuzhen-medium');
const tag = arg('tag', 'old'); // old | new
const base = arg('base', 'http://localhost:3001');
const modelId = arg('model', 'deepseek-chat');
const timeoutMin = Number(arg('timeout-min', '90'));
const costCapCny = Number(arg('cost-cap-cny', '20'));
const author = arg('author', 'eval-1b');
const PASSWORD = 'pass-123456';
const USR = `1b_${Date.now().toString(36).slice(-6)}`;
// 隔离库路径（与 dev server 的 DB_DIR/DB_FILE 一致），completion 后从 jobs.pipeline_state 直读全量产物
const DB_DIR = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
const DB_FILE = arg('db-file', process.env.DB_FILE || '1b-data.db');

/**
 * 直连隔离库读取指定 job 的 pipeline_state，还原 pipelineState。
 * status API 不暴露 pipelineState（仅 public 快照），产物须从 DB 取（db-peek 同款）。
 */
function readPipelineState(jobId) {
  const dbPath = path.join(DB_DIR, DB_FILE);
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT pipeline_state FROM jobs WHERE id = ?').get(jobId);
    if (!row?.pipeline_state) return null;
    return JSON.parse(row.pipeline_state);
  } finally {
    db.close();
  }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const costPerMTokenCny = 2; // deepseek-chat 粗估价（输入≈¥/1M·输入+输出，留二道保险用）— 非精确计费

if (sample !== 'xiuzhen-medium') {
  console.error(`[run-conversion] 默认走 xiuzhen-medium；其它样本需确认标注/断言齐全。拿到 --sample=${sample}`);
}
if (tag !== 'old' && tag !== 'new') {
  console.error(`[run-conversion] --tag 须为 old 或 new`);
  process.exit(2);
}

const sampleDir = path.join(SAMPLES_DIR, sample);
const chaptersFile = path.join(sampleDir, 'chapters.txt');
if (!existsSync(chaptersFile)) {
  console.error(`[run-conversion] 样本章节文件缺失: ${chaptersFile}`);
  process.exit(2);
}

/** 解析 #N 标题 分章 → [{title, text}]。 */
function splitChapters(raw) {
  const blocks = raw.split(/^#\s*(\d+)\s+(.+)$/gm);
  const out = [];
  for (let i = 1; i < blocks.length; i += 3) {
    const num = blocks[i];
    const title = blocks[i + 1];
    const text = (blocks[i + 2] ?? '').trim();
    if (!text) continue;
    out.push({ chapterNo: Number(num), title: title.trim(), text });
  }
  return out;
}

async function req(pathname, { method = 'GET', body, cookie } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(base + pathname, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data, text };
}

async function login() {
  // 冷启动预热：app 层 repository 用 @novel/db 原生 getEngine（无初始化兜底），
  // 首次请求先打 /api/health 触发 healthCheck→getDatabase() 完成引擎注册，避免 register 500。
  await req('/api/health');
  await req('/api/auth/register', { method: 'POST', body: { username: USR, password: PASSWORD } });
  const res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USR, password: PASSWORD }),
  });
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error(`登录失败: ${USR}`);
  return setCookie.split(';')[0];
}

async function main() {
  console.log(`[run-conversion] sample=${sample} tag=${tag} model=${modelId} base=${base}`);
  console.log(`[run-conversion] 红线: 超时=${timeoutMin}min 费用上限=¥${costCapCny}`);

  const raw = readFileSync(chaptersFile, 'utf-8');
  const chapters = splitChapters(raw);
  if (chapters.length === 0) {
    console.error(`[run-conversion] 未能按 #N 标题解析章节，请检查 chapters.txt`);
    process.exit(2);
  }
  const novelText = chapters.map((c) => `${c.title}\n\n${c.text}`.trim()).join('\n\n');
  console.log(`[run-conversion] 解析章节 ${chapters.length} 章，novelText ${novelText.length} 字符`);

  const cookie = await login();
  console.log(`[run-conversion] 临时用户 ${USR} 已登录`);

  const started = Date.now();
  const startRes = await req('/api/pipeline/start', {
    method: 'POST',
    body: { novelText, title: `扇影·${tag}`, author, modelId, selectedChapters: chapters.map((_, i) => i) },
    cookie,
  });
  if (!startRes.data?.jobId) {
    console.error(`[run-conversion] 启动转换失败 status=${startRes.status}: ${startRes.text}`);
    process.exit(3);
  }
  const jobId = startRes.data.jobId;
  console.log(`[run-conversion] job 已启动: ${jobId}`);

  // ── 轮询至 completed / 超时 / 成本红线 ─────────────────────────────
  let ps = null;
  let finalStatus = 'pending';
  let timedOut = false;
  let fed = 0;
  while (true) {
    const elapsedMin = (Date.now() - started) / 60000;
    if (elapsedMin > timeoutMin) {
      timedOut = true;
      finalStatus = 'timeout';
      console.error(`[run-conversion] 超时（${timeoutMin}min）`);
      break;
    }
    const s = await req(`/api/pipeline/status/${jobId}`, { cookie });
    const body = s.data;
    finalStatus = body?.status ?? 'unknown';
    if (body?.status && ['completed', 'failed', 'error'].includes(body.status)) break;
    if (++fed % 6 === 0) {
      const m = elapsedMin.toFixed(0);
      console.log(`  …轮询 ${m}min 状态=${body?.status ?? 'unknown'}`);
    }
    await wait(5000);
  }

  // 产物不暴露于 status API，完成/超时后统一从隔离库直读 pipelineState（db-peek 同款）
  ps = readPipelineState(jobId);

  const elapsedMs = Date.now() - started;
  console.log(`[run-conversion] 终态=${finalStatus} 耗时=${(elapsedMs / 60000).toFixed(1)}min`);

  const pipelineState = ps ?? {};
  if (timedOut) {
    const partialFile = path.join(sampleDir, `${tag}.partial.json`);
    writeFileSync(partialFile, JSON.stringify({ jobId, finalStatus, capturedAt: new Date().toISOString(), pipelineState }, null, 2));
    console.log(`[run-conversion] 已导出 partial pipelineState → ${partialFile}`);
  }

  const phase4 = pipelineState.phase4Output;
  const phase1 = pipelineState.phase1Output;
  if (!phase4 || !Array.isArray(phase4.scenes) || phase4.scenes.length === 0) {
    console.error(`[run-conversion] 未取到 phase4Output.scenes（状态=${finalStatus}）——检查是否中途失败`);
    const runFile = path.join(sampleDir, `${tag}.run.json`);
    writeFileSync(runFile, JSON.stringify({ sample, tag, jobId, finalStatus, elapsedMs, error: 'no-scenes' }, null, 2));
    if (timedOut) return;
    process.exit(4);
  }

  // 参考集（占位率用，依 1b 计划 §3.3）= phase1 分析卡（characters 只有 name，无 id）。
  // scene 引用的是 phase4 分配的字符 id（char_XX），须经 phase4.characters（{characterId,name}）
  // 按名字命中 phase1 卡映射回 id——只取命中卡的名字,命中卡外的引用即"占位/损伤"信号。
  // 注意：phase1.characters 无 characterId 字段；直接读 c.characterId 恒 undefined（历史 bug）。
  const p4Chars = Array.isArray(phase4?.characters) ? phase4.characters : [];
  const phase1Names = new Set((Array.isArray(phase1?.characters) ? phase1.characters : []).map((c) => c.name));
  const charIdToName = Object.fromEntries(
    p4Chars.map((c) => [c.characterId, c.name]).filter(([id, n]) => id && n),
  );
  // 参考 id 集 = phase4 中名字命中 phase1 分析的 characterId（即"进得了设定卡"的角色）
  const charIdSet = p4Chars.filter((c) => phase1Names.has(c.name)).map((c) => c.characterId);
  const aliasIndex = phase1?.aliasIndex ?? {};

  const scenesJson = {
    tag,
    generatedAt: new Date().toISOString(),
    jobId,
    scenes: phase4.scenes,
    charIdToName,
    charIdSet,
    aliasIndex,
  };
  const scenesFile = path.join(sampleDir, `${tag}.scenes.json`);
  writeFileSync(scenesFile, JSON.stringify(scenesJson, null, 2));

  // cost estimate（二道保险）——以输入 token 粗估，超限中止前已挡
  const estimatedInputTokens = Math.round(novelText.length * 0.6);
  const estimateCny = (estimatedInputTokens / 1_000_000) * costPerMTokenCny;
  const runFile = path.join(sampleDir, `${tag}.run.json`);
  const run = {
    sample, tag, model: modelId, jobId, finalStatus, elapsedMs,
    scenes: phase4.scenes.length,
    characters: phase4.characters?.length ?? chars.length,
    charIdSet: charIdSet.length,
    inputEstimateTokens: estimatedInputTokens,
    estimatedCostCny: Math.round(estimateCny * 100) / 100,
    costCapCny,
    gridCells: { scenes: phase4.scenes.length, charIdToName: Object.keys(charIdToName).length, deadCharacters: 2 },
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(runFile, JSON.stringify(run, null, 2));

  console.log(`[run-conversion] 产物已导出：`);
  console.log(`  scenes    → ${scenesFile}（scenes=${run.scenes} charIdSet=${run.charIdSet}）`);
  console.log(`  run 记录  → ${runFile}（estimate ¥${run.estimatedCostCny} ≤ ¥${costCapCny}）`);
  console.log(`[run-conversion] 停点：验收 <tag>.run.json 格子数>0、规则格非占位、占位率非全段严格为 0 后再付第二步。`);
}

main().catch((err) => {
  console.error(`[run-conversion] 失败: ${err.message || err}`);
  process.exit(1);
});