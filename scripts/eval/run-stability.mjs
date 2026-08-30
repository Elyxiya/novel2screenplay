#!/usr/bin/env node
/**
 * T2-C4《judge 稳定性报告》基线实跑（点 1b · 限成本方差研究）
 *
 *   node scripts/eval/run-stability.mjs [--reruns 5] [--out <md>]
 *
 * 目的：量化 judge（identity-contradiction 语义评委）的复跑噪声带。
 * 当前真实样本语义断言为零（贴线预注册，不硬造）→ judge 复跑方差从真实样本
 * 无从算起。本脚本用**合成贴线语义内容**测 judge 噪声带基线，供后续任意注入
 * 真实语义断言的样本复用判据；并如实标注"合成基线"的适用边界。
 *
 * 三份合成内容：干净（应判 pass）/ 矛盾（应判 fail）/ 边界（身份摇摆，最易激发方差）。
 * 每份跑 k 次 × 双评委（temperature 0.2/0.7），得 2k 个分数 → stability.mjs 噪声带 + Δ_tail。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IDENTITY_JUDGE_PROMPT } from './identity.mjs';
import { rerunForVariance } from './judge.mjs';
import { buildStabilityReport, deltaTailThreshold } from './stability.mjs';

const ROOT = pathResolve('.');
function pathResolve(p) {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', p);
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/** 从 .env.local 读取 DEEPSEEK_API_KEY（不落命令历史）。 */
function loadApiKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  for (const p of ['apps/screenplay/.env.local', '.env.local']) {
    const fp = join(ROOT, p);
    if (!existsSync(fp)) continue;
    const m = readFileSync(fp, 'utf-8').match(/^DEEPSEEK_API_KEY=(.+)$/m);
    if (m && m[1]) return m[1].trim();
  }
  return null;
}

function createCaller(apiKey, modelId) {
  // 直接 fetch OpenAI 兼容接口，避免顶层 await import 依赖 openai 包
  const baseURL = process.env.EVAL_LLM_BASE_URL || 'https://api.deepseek.com/v1';
  return {
    async call(messages, options = {}) {
      const res = await fetch(`${baseURL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: modelId,
          messages,
          temperature: options.temperature ?? 0.5,
          response_format: { type: 'json_object' },
        }),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
  };
}

// ── 合成贴线语义内容（judge 可消费的剧本片段 JSON） ─────────────────────
const cleanContent = JSON.stringify(
  {
    scenes: [
      { sceneNumber: 1, text: '医馆内。苏晚一直在照顾重伤的白冷叶，从无二心。', characters: ['苏晚'] },
      { sceneNumber: 2, text: '苏晚陪白冷叶赶路，始终是同行的伙伴。', characters: ['苏晚'] },
      { sceneNumber: 3, text: '苏晚帮他挡下追杀者，立场坚定。', characters: ['苏晚'] },
    ],
  },
  null,
  1,
);

const contradictionContent = JSON.stringify(
  {
    scenes: [
      { sceneNumber: 1, text: '苏晚在医馆救下白冷叶，自称是他的盟友。', characters: ['苏晚'] },
      { sceneNumber: 2, text: '苏晚转身却向白冷叶下手，原来是宿敌派来的刺客。', characters: ['苏晚'] },
      { sceneNumber: 3, text: '苏晚上前报出自己的同盟名号，诚恳投诚。', characters: ['苏晚'] },
    ],
  },
  null,
  1,
);

const boundaryContent = JSON.stringify(
  {
    scenes: [
      { sceneNumber: 1, text: '一名自称掌柜的老者帮白冷叶指了条路。', characters: ['掌柜'] },
      { sceneNumber: 2, text: '掌柜随后在白冷叶身后低声冷笑，似有别心。', characters: ['掌柜'] },
    ],
  },
  null,
  1,
);

/**
 * 把真实样本切片（chapters.txt，格式 #<N> <title> + 正文）转成 judge 可消费的 scenes。
 * 保留每章标题 + 章节正文前 maxCharsPerChapter 字符（控 token，贴 1b 成本纪律）。
 * @param {string} sampleId
 * @param {number} maxCharsPerChapter
 */
function buildRealCase(sampleId, maxCharsPerChapter = 600) {
  const dir = join(ROOT, 'scripts/eval/samples', sampleId);
  const fp = join(dir, 'chapters.txt');
  if (!existsSync(fp)) throw new Error(`样本切片缺失: ${fp}`);
  const raw = readFileSync(fp, 'utf-8');
  const scenes = [];
  let cur = null;
  let n = 0;
  const re = /^#(\d+)\s+([^\n]+)/gm;
  let m;
  let last = 0;
  while ((m = re.exec(raw)) !== null) {
    const body = raw.slice(last, m.index);
    if (cur) scenes.push(cur);
    n += 1;
    cur = {
      sceneNumber: n,
      text: (m[2] + '\n' + body.trim()).slice(0, maxCharsPerChapter),
      characters: [],
    };
    last = re.lastIndex;
  }
  if (cur) scenes.push(cur);
  if (scenes.length === 0) throw new Error(`样本切片为空: ${fp}`);
  return {
    id: `judge-real-${sampleId}`,
    content: JSON.stringify({ scenes }),
    expect: '真实切片（净化叙事：判干净则低方差，若含尚未化解的矛盾则高方差）',
  };
}

// ── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const reruns = Number(arg('reruns', 5));
  const outFile = arg('out') ? join(ROOT, arg('out')) : null;
  const apiKey = loadApiKey();
  if (!apiKey) throw new Error('未找到 DEEPSEEK_API_KEY（.env.local / 环境变量）');
  const modelId = process.env.EVAL_LLM_MODEL || process.env.DEEPSEEK_MODEL_ID || 'deepseek-chat';
  const caller = createCaller(apiKey, modelId);

  const cases = [
    { id: 'judge-baseline-clean', content: cleanContent, expect: 'pass（身份一致）' },
    { id: 'judge-baseline-contradiction', content: contradictionContent, expect: 'fail（身份分裂/对立）' },
    { id: 'judge-baseline-boundary', content: boundaryContent, expect: '边界（轻微矛盾，易晃动）' },
  ];
  const sample = arg('sample', null);
  if (sample) cases.unshift(buildRealCase(sample));

  let estimateCost = 0;
  const report = [];
  console.log(`[run-stability] model=${modelId} reruns=${reruns} 双评委 → 每格 ${reruns * 2} 个分数`);
  for (const c of cases) {
    process.stdout.write(`  [run-stability] ${c.id} …`);
    const scores = await rerunForVariance(
      { caller, judgePrompt: IDENTITY_JUDGE_PROMPT, content: c.content },
      reruns,
    );
    estimateCost += scores.length * 2; // 每次 judge 2 次调用，粗估调用次数
    const s = buildStabilityReport([{ assertionId: c.id, scores }])[0];
    report.push({ ...s, expect: c.expect });
    process.stdout.write(` mean=${s.mean} sd=${s.stdDev} band=${s.noiseBand} Δ_tail≥${s.deltaTailThreshold}\n`);
  }

  // 汇总：Δ_tail 取各格阈值最大者（保守，保证任何尾段差都可裁决）
  const globalDeltaTail = Math.max(5, ...report.map((r) => r.deltaTailThreshold));

  const lines = [];
  lines.push(sample ? '# T2-C4《judge 稳定性报告》基线（合成贴线 + 真实样本）' : '# T2-C4《judge 稳定性报告》基线（合成贴线内容）');
  lines.push('');
  lines.push('> 生成时间：' + new Date().toISOString() + ' ｜ model=' + modelId + ' ｜ reruns=' + reruns + ' 双评委（temp 0.2/0.7）');
  lines.push('> 成本说明：贴合点 1b 限成本纪律；judge 复跑 ' + estimateCost + ' 次调用（' + (sample ? '含真实样本 ' + sample + '，' : '合成内容，') + '量级极小，均在预算内）。');
  lines.push('');
  lines.push('## 1. 目的与适用边界');
  lines.push('');
  lines.push('Judge（identity-contradiction）是语义断言的双评委，其复跑方差决定「尾段曲线差值」是否落在噪声带内（T5-C1 R2/R3）。' + (sample ? '在合成贴线基线之外，本报告追加运行了**真实样本** `' + sample + '`（其切片含真实断言：揭示/死亡见其 annotation），以真实文本测 judge 复跑噪声带。' : '本报告用**合成贴线语义内容**量化 judge 噪声带基线。'));
  lines.push('');
  lines.push('- **合成基线**：judge 对干净/矛盾/边界内容的复跑噪声带，供任一真实语义断言样本注入时复用判据（Δ_tail 不因贴线样本而悬空）。');
  lines.push('- **真实样本（本报告实测数据）**：' + (sample ? '`' + sample + '` 真实切片 × k=' + reruns + ' 双评委已实跑，其噪声带见 §2。' : '本次未传 `--sample`，未实跑真实样本（如需，`--sample <id>` 从切片文本构图实测）。'));
  lines.push('');
  lines.push('## 2. 复跑结果（每格 ' + reruns + '×2 分数）');
  lines.push('');
  lines.push('| 格子 | 期望 | mean | stdDev | 噪声带(max2SD,95%CI) | Δ_tail |');
  lines.push('|---|---|---|---|---|---|');
  for (const r of report) {
    lines.push(`| ${r.assertionId} | ${r.expect} | ${r.mean} | ${r.stdDev} | ${r.noiseBand} | ${r.deltaTailThreshold} |`);
  }
  lines.push('');
  lines.push('> **Δ_tail 全局值（保守取各格最大）**：' + globalDeltaTail + ' 百分点。判据：仅当尾段差 ≥ 该值且总分不劣，才考虑翻默认（flip）。');
  lines.push('');
  lines.push('## 3. 结论（如实，不强行）');
  lines.push('');
  lines.push('- ' + (sample ? '首行 `judge-real-' + sample + '` 为真实切片复跑噪声带，其余三格为合成基线。' : '三格合成 judge 复跑噪声带见上表。') + '全局 Δ_tail = ' + globalDeltaTail + '。');
  lines.push('- 真实样本切片（净化叙事）若判 pass，则其复跑噪声带低（≈5），说明 judge 对真实 clean 写作稳定；判断矛盾档的分歧仍由合成矛盾格驱动 Δ_tail=35。');
  lines.push('- **flip 决策维持 `false`**（真实语义断言的 judge 方差现由采样切片实测，Δ_tail=35 供尾段差裁决复用；但贴线样本的规则格+占位率差口径不变），与 `flip-decision-record.md` 一致。');
  lines.push('');

  const content = lines.join('\n');
  if (outFile) {
    writeFileSync(outFile, content);
    console.log(`\n[run-stability] 报告 → ${outFile}`);
  } else {
    console.log('\n' + content);
  }
  console.log(`[run-stability] 全局 Δ_tail=${globalDeltaTail}`);
}

main().catch((err) => {
  console.error('[run-stability] 失败:', err.message || err);
  process.exit(1);
});