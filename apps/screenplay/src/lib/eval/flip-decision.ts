/**
 * Phase1 翻默认决策规则（T5-C1，出数前固化版）
 *
 * 契约（职责分离）：
 *  - eval 侧稳定性报告（scripts/eval/stability.mjs `buildStabilityReport` / `deltaTailThreshold`）
 *    负责「从 judge 复跑方差算 Δ_tail」；
 *  - 本模块只做「判定」：拿到调用方注入的 Δ_tail，判是否允许把 map-reduce 翻为默认路径，
 *    不重复推导阈值。Δ_tail 未就绪（judge 稳定性方差未跑出）时**缺数据不裁决**——宁可暂不翻。
 *
 * 口径定死在代码与 docs/conversion-quality/task5-flip-decision.md，
 * 出数后不临时改（防集中式"降/压平"事后合理化）。
 */

export interface FlipDecisionInput {
  /** 旧 → 新 尾段（最后 1/3 章节断面）通过率升幅（百分点，0–100）。>0 表示新管线压平了尾段 */
  tailDropPct: number;
  /** 总分是否不劣于旧（允许相等或更好）。"不劣"的判定口径由调用方按分层曲线/总分契约给出 */
  totalNotWorse: boolean;
  /** Δ_tail 阈值（百分点）。由 stability 报告 `deltaTailThreshold` 计算后注入；
   *  null / undefined / 非有限数 = judge 复跑方差未就绪 → 不得翻默认 */
  deltaTail: number | null | undefined;
}

export interface FlipDecision {
  /** 是否允许翻默认 */
  flip: boolean;
  /** 判定理由（逐条，供人工核验口径） */
  reasons: string[];
  /** 本次评估命中的规则条文（备查，保证口径不变） */
  evaluatedRules: string[];
}

const R1 = '【R1】无 judge 复跑方差（Δ_tail 未填充）→ 缺数据不裁决，暂不翻默认。';
const R2 = '【R2】Δ_tail 须大于 judge 噪声带，否则尾段差值落进噪声内无从裁决。';
const R3 = '【R3】翻默认 = 尾段差 ≥ Δ_tail 且 总分不劣；任一不满足不翻。';

/** 四舍五入到 0.1 以便展示。 */
function round(x: number): number {
  return Math.round(x * 10) / 10;
}

export function decidePhase1Flip(input: FlipDecisionInput): FlipDecision {
  const { tailDropPct, totalNotWorse, deltaTail } = input;

  // R1：缺方差数据不裁决
  if (deltaTail === null || deltaTail === undefined || !Number.isFinite(deltaTail)) {
    return { flip: false, reasons: [R1], evaluatedRules: [R1] };
  }

  const meeting = tailDropPct >= deltaTail;
  const reasons: string[] = [];
  if (!meeting) {
    reasons.push(
      `【R3】翻默认为 false：尾段差 ${round(tailDropPct)}pt < Δ_tail ${round(deltaTail)}pt，差值落在 judge 噪声带内（R2），无法裁决。`,
    );
  }
  if (!totalNotWorse) {
    reasons.push('【R3】翻默认为 false：总分劣化，不满足"总分不劣"。');
  }
  const flip = meeting && totalNotWorse;
  if (flip) {
    reasons.push(
      `【R3】翻默认为 true：尾段差 ${round(tailDropPct)}pt ≥ Δ_tail ${round(deltaTail)}pt 且总分不劣，允许翻默认。`,
    );
  }
  return { flip, reasons, evaluatedRules: [R1, R2, R3] };
}