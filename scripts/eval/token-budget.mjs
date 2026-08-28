/**
 * Token 预算预估（T2-C1 --dry-run）
 *
 * 跑 eval 战前先见账：对 manifest 各格按「输入 token + 预估输出 token」求和。
 * 用 tiktoken cl100k_base 精确计输入；失败时退化到字符数/1.3 估算。
 */

let encodingPromise = null;

/** 懒加载单例 tiktoken 编码（加载 BPE 表 50-300ms，复用免重复开销）。 */
function getEncoding() {
  if (!encodingPromise) {
    encodingPromise = import('tiktoken').then(({ get_encoding }) =>
      get_encoding('cl100k_base'),
    );
  }
  return encodingPromise;
}

/** token 计数：tiktoken 精确值，失败退化为 ceil(len/0.77)（约 1.3 字符/token）。 */
export async function estimateTokens(text) {
  try {
    const enc = await getEncoding();
    return enc.encode(text).length;
  } catch {
    return Math.ceil(String(text).length / 0.77);
  }
}

/** 同步字符级估算（无 tiktoken 依赖，适合 --dry-run 预览的兜底）。 */
export function estimateTokensSync(text) {
  return Math.ceil(String(text).length / 0.77);
}

/**
 * 单个格子的预估：
 * @param {{ inputText: string, outputEstimate?: number }} cell
 * @returns {Promise<{ inputTokens: number, outputTokens: number, totalTokens: number }>}
 */
export async function estimateCell(cell) {
  const inputTokens = await estimateTokens(cell.inputText ?? '');
  const outputTokens = cell.outputEstimate ?? 2000; // 语义 judge 默认预估 2k 输出
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

/**
 * 战前总预算（--dry-run 主输出）。
 * @param {Array<{ id: string, inputText: string, outputEstimate?: number }>} cells
 * @param {(c: { id: string, inputText: string, outputEstimate?: number }) => Promise<{ inputTokens: number, outputTokens: number, totalTokens: number }>} [estimateCellFn] 可注入估算器（单测用）
 * @returns {Promise<{ totalInput: number, totalOutput: number, total: number, perCell: Array<{id:string,total:number}> }>}
 */
export async function computeDryRunBudget(cells, estimateCellFn = estimateCell) {
  const perCell = [];
  let totalInput = 0;
  let totalOutput = 0;
  for (const cell of cells) {
    const est = await estimateCellFn(cell);
    totalInput += est.inputTokens;
    totalOutput += est.outputTokens;
    perCell.push({ id: cell.id, ...est });
  }
  return { totalInput, totalOutput, total: totalInput + totalOutput, perCell };
}
