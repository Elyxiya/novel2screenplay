/**
 * Few-shot 最小对（B-06）：原文→剧本样例的加载、指纹与注入格式化。
 *
 * 纪律：
 * - **只注入 Phase3**（场景转换），不全篇注入；默认关闭（未设置 env 零变化）；
 * - 样例库位于仓库 `scripts/eval/fewshots/*.yaml`（或 PHASE3_FEWSHOTS_DIR 指定目录）；
 * - 指纹（稳定序列化 sha256 前 16）随产物落库，供 eval manifest/AB 对比标识版本；
 * - 收益裁决走评估链 + 盲评（见 docs/conversion-quality/fewshot-ab-plan.md），无显著收益即弃。
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import YAML from 'yaml';

export interface FewshotEntry {
  id: string;
  note?: string;
  sourceText: string;
  target: unknown;
}

/** 解析单份样例（缺 id/source.text/target 即抛错——样例库损坏必须显式暴露） */
export function parseFewshot(doc: string): FewshotEntry {
  const parsed = YAML.parse(doc) as Record<string, unknown> | null;
  const id = parsed && typeof parsed.id === 'string' ? parsed.id : null;
  const sourceText = parsed && typeof (parsed.source as { text?: unknown })?.text === 'string'
    ? String((parsed.source as { text: string }).text)
    : null;
  const target = parsed?.target;
  if (!id || !sourceText || target === undefined) {
    throw new Error(`fewshot 样例缺少 id/source.text/target：${id ?? '(无 id)'}`);
  }
  return { id, note: typeof parsed?.note === 'string' ? (parsed.note as string) : undefined, sourceText, target };
}

export function parseFewshots(docs: string[]): FewshotEntry[] {
  return docs.map(parseFewshot);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}

/** 样例集指纹（顺序敏感：注入顺序影响上下文，指纹需与之一致） */
export function hashFewshots(entries: FewshotEntry[]): string {
  return createHash('sha256').update(stableStringify(entries)).digest('hex').slice(0, 16);
}

/** 注入块（≤maxChars；每对：原文 + 目标 JSON 单行截断） */
export function formatFewshotBlock(entries: FewshotEntry[], maxChars = 900): string {
  if (!entries || entries.length === 0) return '';
  const lines = ['【转换示例（严格模仿其"可见动作 / 原话对白 / 不编造"口径）】'];
  for (const e of entries) {
    lines.push(`〈原文〉${e.sourceText.trim().slice(0, 220)}`);
    lines.push(`〈目标〉${JSON.stringify(e.target).slice(0, 380)}`);
  }
  let block = lines.join('\n');
  if (block.length > maxChars) block = `${block.slice(0, maxChars - 8)}…（截断）`;
  return block;
}

const DEFAULT_DIR = path.resolve(process.cwd(), '..', '..', 'scripts', 'eval', 'fewshots');
const cache = new Map<string, FewshotEntry[]>();

/** 加载目录内全部 *.yaml（按文件名排序保证顺序稳定）；目录缺失返回 undefined 并告警 */
export function loadFewshotsFromDir(dir: string): FewshotEntry[] | undefined {
  if (cache.has(dir)) return cache.get(dir);
  if (!existsSync(dir)) {
    console.warn(`[fewshots] 样例目录不存在: ${dir}`);
    cache.set(dir, undefined as unknown as FewshotEntry[]);
    return undefined;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).sort();
  const entries = parseFewshots(files.map((f) => readFileSync(path.join(dir, f), 'utf8')));
  cache.set(dir, entries);
  return entries;
}

/** 启停与目录解析：PHASE3_FEWSHOTS=1 或 PHASE3_FEWSHOTS_DIR=<dir> 时启用；否则 undefined（零变化） */
export function loadFewshots(env: Record<string, string | undefined> = process.env): FewshotEntry[] | undefined {
  const enabled = env.PHASE3_FEWSHOTS === '1' || Boolean(env.PHASE3_FEWSHOTS_DIR);
  if (!enabled) return undefined;
  return loadFewshotsFromDir(env.PHASE3_FEWSHOTS_DIR ?? DEFAULT_DIR);
}
