#!/usr/bin/env node
/**
 * 单次转换运行（评估薄 CLI）——B-01 模式对比 / FIX-09 定期检测复用
 *
 * 用法：
 *   node scripts/eval/run-once.mjs --name <label> --sample <id> \
 *     [--base http://localhost:3001] [--model deepseek-chat] [--prompt-file <path>]\
 *     [--timeout-min 25] [--cost-cap-cny 20]
 *
 * 产物：samples/<id>/once-<label>.{scenes,run}.json（run 含 actualModelId）。
 * 说明：目标 server 的 PHASE1_MODE / CONVERT_PROMPT_FILE 决定运行口径——本 CLI 不换 env，
 *       三模式对比时按需重启 server（Next dev 项目级单实例锁）。
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { driveConversion } from './convert-driver.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SAMPLES_DIR = path.join(ROOT, 'scripts', 'eval', 'samples');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const name = arg('name');
  const sample = arg('sample', 'zhanlan-short');
  const base = arg('base', 'http://localhost:3001');
  const model = arg('model', 'deepseek-chat');
  const timeoutMin = Number(arg('timeout-min', '25'));
  const costCapCny = Number(arg('cost-cap-cny', '20'));
  const dbDir = arg('db-dir', process.env.DB_DIR || path.join(ROOT, 'apps', 'screenplay', 'data-test'));
  const dbFile = arg('db-file', process.env.DB_FILE || '1b-data.db');

  if (!name) {
    console.error('用法：node scripts/eval/run-once.mjs --name <label> --sample <id> [--base URL]');
    process.exitCode = 2;
    return;
  }

  const sampleDir = path.join(SAMPLES_DIR, sample);
  mkdirSync(sampleDir, { recursive: true });
  const result = await driveConversion({
    base, sampleDir, runLabel: name, side: 'once', model, timeoutMin, costCapCny, dbDir, dbFile, titlePrefix: 'once',
  });
  console.log(`[run-once] ${name}: job=${result.run.jobId} 实际模型=${result.run.actualModelId ?? '未知'} 场景=${result.run.scenes} 耗时=${(result.run.elapsedMs / 60000).toFixed(1)}min`);
}

main().catch((err) => { console.error(`[run-once] 失败: ${err.message}`); process.exitCode = 1; });
