#!/usr/bin/env node
/**
 * eval runner CLI（T2-C1）
 *
 *   npm run eval -- --set identity-fixture --model deepseek-chat [--dry-run]
 *
 * 选项：
 *   --set <name>       数据集（identity-fixture | identity）
 *   --model <id>       judge 模型 id（默认 deepseek-chat）
 *   --stages <s>       过滤阶段（analyze|convert，可逗号分隔）
 *   --dry-run          只出 token 预算账单，不调 LLM（跑 eval 战前先见账）
 *   --cache <file>     hash 缓存 JSONL（默认 data/eval-cache.jsonl，data/ 不入库）
 *   --out <file>       JSONL 报告输出（默认 stdout）
 *   --stability        对语义格子做复跑方差 → 稳定性报告（每格 k 次 × 双评委）
 *   --reruns <k>       复跑次数（默认 5，配合 --stability）
 */

import { resolveSet, listSets } from './eval/sets.mjs';
import { computeDryRunBudget } from './eval/token-budget.mjs';
import { EvalCache, createFileCache, fingerprintCell, sha256Hex } from './eval/manifest.mjs';
import { runIdentityRule, IDENTITY_RULES } from './eval/identity.mjs';
import { judgeSemanticCell, rerunForVariance } from './eval/judge.mjs';
import { buildStabilityReport } from './eval/stability.mjs';

// ── 参数解析 ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function createCaller(modelId) {
  const { default: OpenAI } = await_openai();
  const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('未配置 LLM key：设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY（dry-run 不需要）');
  }
  const baseURL = process.env.EVAL_LLM_BASE_URL || 'https://api.deepseek.com/v1';
  const client = new OpenAI({ apiKey, baseURL });
  return {
    async call(messages, options = {}) {
      const res = await client.chat.completions.create({
        model: modelId,
        messages,
        temperature: options.temperature ?? 0.5,
        response_format: { type: 'json_object' },
      });
      return res.choices?.[0]?.message?.content ?? '';
    },
  };
}

async function await_openai() {
  return import('openai');
}

// ── 主流程 ───────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const set = args.set ?? 'identity-fixture';
  const modelId = args.model ?? 'deepseek-chat';
  const stages = args.stages
    ? String(args.stages).split(',').map((s) => s.trim())
    : null;
  const cacheFile = args.cache ?? 'data/eval-cache.jsonl';
  const outFile = args.out ?? null;
  const reruns = Number(args.reruns ?? 5);
  const dryRun = Boolean(args['dry-run']);

  const judgePromptHash = sha256Hex(IDENTITY_RULES.identityContradiction.description);
  const cells = resolveSet(set, { modelId, datasetHash: `set:${set}`, judgePromptHash });
  const filtered = stages ? cells.filter((c) => stages.includes(c.stage)) : cells;

  if (filtered.length === 0) {
    console.error(`set "${set}" 无匹配格子（stages=${stages ?? 'all'}）`);
    process.exit(2);
  }

  if (dryRun) {
    const budget = await computeDryRunBudget(filtered);
    console.log(`[dry-run] set=${set} model=${modelId} 格子数=${filtered.length}`);
    for (const row of budget.perCell) {
      console.log(
        `  ${row.id.padEnd(40)} in=${row.inputTokens} out=${row.outputTokens} total=${row.totalTokens}`,
      );
    }
    console.log(
      `[dry-run] 合计 in=${budget.totalInput} out=${budget.totalOutput} total=${budget.total} tokens`,
    );
    return;
  }

  const cache = new EvalCache(createFileCache(cacheFile));
  // 规则集零 LLM：仅当存在语义格子（需 judge）时才要求 API key
  const hasSemantic = filtered.some((c) => c.kind === 'semantic');
  const caller = hasSemantic ? createCaller(modelId) : null;
  const rows = [];
  let ruleFail = 0;
  let ruleTotal = 0;

  for (const cell of filtered) {
    const fingerprint = fingerprintCell(cell);
    let result;
    if (cell.kind === 'rule') {
      const r = runIdentityRule(cell.assertionId, cell.data);
      ruleTotal++;
      if (!r.passed) ruleFail++;
      result = r;
    } else {
      const cached = cache.get(cell);
      if (cached) {
        result = cached;
      } else {
        const judged = await judgeSemanticCell({
          caller,
          judgePrompt: IDENTITY_RULES.identityContradiction.description,
          content: cell.data.content,
        });
        result = { kind: 'semantic', judged, reruns: 1 };
        cache.set(cell, result);
      }
    }
    rows.push({ fingerprint, cell: { id: cell.id, set: cell.set, stage: cell.stage }, result });
  }

  if (args.stability) {
    const semanticCells = filtered.filter((c) => c.kind === 'semantic');
    const report = [];
    for (const cell of semanticCells) {
      const scores = await rerunForVariance(
        {
          caller,
          judgePrompt: IDENTITY_RULES.identityContradiction.description,
          content: cell.data.content,
        },
        reruns,
      );
      report.push({ assertionId: cell.assertionId, scores });
    }
    const stability = buildStabilityReport(report);
    console.log('[stability]');
    for (const s of stability) {
      console.log(
        `  ${s.assertionId.padEnd(30)} reruns=${s.reruns} mean=${s.mean} sd=${s.stdDev} band=${s.noiseBand} Δ_tail≥${s.deltaTailThreshold}`,
      );
    }
  }

  const out = JSON.stringify({ set, modelId, generatedAt: new Date().toISOString(), rows }, null, 2);
  if (outFile) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outFile, `${out}\n`);
  } else {
    console.log(out);
  }

  console.log(
    `[eval] 规则格子 ${ruleTotal} 个，失败 ${ruleFail} 个（通过率 ${Math.round(((ruleTotal - ruleFail) / Math.max(ruleTotal, 1)) * 100)}%）`,
  );
  if (!args.stability && semantic_hint(filtered)) {
    console.log('[eval] 提示：--stability 可对语义格子做复跑方差（T2-C4 稳定性报告）');
  }
}

function semantic_hint(cells) {
  return cells.some((c) => c.kind === 'semantic');
}

main().catch((err) => {
  console.error('[eval] 失败:', err.message || err);
  process.exit(1);
});
