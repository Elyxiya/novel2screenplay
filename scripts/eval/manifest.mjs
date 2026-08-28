/**
 * Eval manifest —— 评估复现单元（T2-C1）
 *
 * manifest = (prompt 文件 hash, model id, 参数, 数据集 hash, judge prompt hash, stage, sample, assertion)
 * → fingerprint（sha256）→ 按 hash 缓存避免重付不变格子的钱。
 *
 * 纯逻辑模块：不依赖 CLI 状态，可被 vitest 直接 import。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/** 稳定化一个值用于哈希：对象按键排序、数组保序、字符串原样。 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return String(value);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  const out = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = canonicalize(value[key]);
  }
  return out;
}

/** sha256 hex（输入先 canonicalize 为 JSON 再哈希，保证可复现）。 */
export function sha256Hex(value) {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex');
}

/** 读取 prompt 文件内容并返回 sha256（用于 prompt 版本纳入指纹）。 */
export function promptFileHash(filePath) {
  return sha256Hex(readFileSync(filePath, 'utf8'));
}

/**
 * 一个评估格子（cell）：样本 × 阶段 × 断言的原子执行单元。
 * @typedef {{
 *   set: string,
 *   sampleId: string,
 *   stage: 'analyze'|'convert',
 *   assertionId: string,
 *   modelId: string,
 *   params: Record<string, unknown>,
 *   datasetHash: string,
 *   judgePromptHash: string,
 * }} EvalCell
 */

/**
 * 构建格子指纹。
 * @param {EvalCell} cell
 * @returns {string} 32 位 hex
 */
export function fingerprintCell(cell) {
  return sha256Hex({
    kind: 'novel2screenplay-eval-cell',
    version: 1,
    cell,
  });
}

/**
 * 简易磁盘缓存：fingerprint → 记录。
 * JSONL 语义（一行一条），key 即 fingerprint。
 */
export class EvalCache {
  /**
   * @param {{ read: (key: string) => unknown | null, write: (key: string, record: unknown) => void }} store
   */
  constructor(store) {
    this.store = store;
  }

  /** @param {EvalCell} cell */
  get(cell) {
    return this.store.read(fingerprintCell(cell));
  }

  /** @param {EvalCell} cell @param {unknown} record */
  set(cell, record) {
    this.store.write(fingerprintCell(cell), record);
  }
}

/** 文件系统版 cache store（JSONL 文件，逐行 { key, record }）。 */
export function createFileCache(cacheFile) {
  const rows = new Map();
  try {
    const text = readFileSync(cacheFile, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      rows.set(row.key, row.record);
    }
  } catch {
    /* 缓存文件不存在时静默初始化 */
  }
  return {
    read(key) {
      return rows.has(key) ? rows.get(key) : null;
    },
    write(key, record) {
      rows.set(key, record);
      writeFileSync(cacheFile, `${JSON.stringify({ key, record })}\n`, { flag: 'a' });
    },
  };
}
