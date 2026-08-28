/**
 * Judge 稳定性报告（T2-C4）与 Δ_tail 阈值推导
 *
 * 复跑方差研究（每类抽 1 本 × k=5 × 双评委）→ 量化 judge 噪声带 →
 * Δ_tail 必须大于噪声带（2×SD 或 95% 置信区间宽度），否则曲线差值落进噪声内无法裁决。
 * 同一份方差数据同时驱动 T5-C1 的 Δ_tail。
 */

/** 均值（空数组返回 NaN）。 */
export function mean(values) {
  if (values.length === 0) return NaN;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** 样本标准差（Bessel 校正，n<2 返回 NaN）。 */
export function stdDev(values) {
  if (values.length < 2) return NaN;
  const m = mean(values);
  const sq = values.reduce((acc, v) => acc + (v - m) ** 2, 0);
  return Math.sqrt(sq / (values.length - 1));
}

/** 95% 置信区间半宽 = z * SD / sqrt(n)。 */
export function ciHalfWidth(values, z = 1.96) {
  const sd = stdDev(values);
  if (!Number.isFinite(sd)) return NaN;
  return (z * sd) / Math.sqrt(values.length);
}

/**
 * judge 噪声带：2×SD 与 CI 半宽取较大者（保守）。
 * @returns {number | null} 无可计算方差时返回 null
 */
export function judgeNoiseBand(scores, z = 1.96) {
  const sd = stdDev(scores);
  if (!Number.isFinite(sd)) return null;
  return Math.max(2 * sd, ciHalfWidth(scores, z));
}

/**
 * Δ_tail 阈值 = f(judge 方差)：取噪声带向上取整，保证曲线差值可裁决。
 * @param {number[]} rerunScores 同一格子复跑 k 次的 judge 分数
 * @param {number} z
 * @param {number} minDelta 兜底最小可裁决差值（默认 5 分）
 */
export function deltaTailThreshold(rerunScores, z = 1.96, minDelta = 5) {
  const band = judgeNoiseBand(rerunScores, z);
  if (band === null) return minDelta;
  return Math.max(minDelta, Math.ceil(band));
}

/**
 * 稳定性报告：对每个断言格子的复跑分数输出均值/SD/噪声带/阈值。
 * @param {Array<{ assertionId: string, scores: number[] }>} cells
 */
export function buildStabilityReport(cells) {
  return cells.map((cell) => {
    const m = mean(cell.scores);
    const sd = stdDev(cell.scores);
    const band = judgeNoiseBand(cell.scores);
    return {
      assertionId: cell.assertionId,
      reruns: cell.scores.length,
      scores: cell.scores,
      mean: Number.isFinite(m) ? Math.round(m * 100) / 100 : null,
      stdDev: Number.isFinite(sd) ? Math.round(sd * 100) / 100 : null,
      noiseBand: band === null ? null : Math.round(band * 100) / 100,
      deltaTailThreshold: deltaTailThreshold(cell.scores),
    };
  });
}
