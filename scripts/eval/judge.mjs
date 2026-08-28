/**
 * Judge 调用器（T2-C3）：语义断言走双评委。
 *
 * caller 接口（依赖注入，便于单测与 CLI 双实现）：
 *   call(messages) => Promise<string>   // 返回 LLM 的文本回答
 * 双评委 = 同一格子用两份独立 judge 调用（不同 temperature / 可配不同模型），
 * 打分取平均，分歧超带时标记 disagreement 供稳定性报告。
 */

/** 从 judge 回复解析出场景裁决列表。 */
export function parseJudgeVerdicts(text) {
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {
        parsed = null;
      }
    }
  }
  if (!parsed || !Array.isArray(parsed.scenes)) return [];
  return parsed.scenes
    .filter((s) => s && typeof s.sceneNumber === 'number')
    .map((s) => ({
      sceneNumber: s.sceneNumber,
      verdict: s.verdict === 'fail' ? 'fail' : 'pass',
      reason: typeof s.reason === 'string' ? s.reason : '',
    }));
}

/** 语义断言通过率：pass 场景数 / 可判场景数（无可判场景视为通过）。 */
export function passRate(verdicts) {
  if (verdicts.length === 0) return 1;
  const pass = verdicts.filter((v) => v.verdict === 'pass').length;
  return pass / verdicts.length;
}

/**
 * 双评委判一个语义格子。
 * @param {{
 *   caller: { call: (messages: Array<{role:string,content:string}>, options?: Record<string, unknown>) => Promise<string> },
 *   judgePrompt: string,
 *   content: string,
 * }} deps
 * @returns {Promise<{ scores: number[], verdicts: Array<object>, agreement: boolean }>}
 */
export async function judgeSemanticCell({ caller, judgePrompt, content }) {
  const messages = [
    { role: 'system', content: judgePrompt },
    { role: 'user', content },
  ];
  // 双评委：两次独立调用（调用方负责差异化 temperature/model）
  const [r1, r2] = await Promise.all([
    caller.call(messages, { temperature: 0.2 }),
    caller.call(messages, { temperature: 0.7 }),
  ]);
  const v1 = parseJudgeVerdicts(r1);
  const v2 = parseJudgeVerdicts(r2);
  const s1 = Math.round(passRate(v1) * 100);
  const s2 = Math.round(passRate(v2) * 100);
  return {
    scores: [s1, s2],
    verdicts: v1,
    agreement: v1.length > 0 && v2.length > 0 ? s1 === s2 : v1.length === 0 && v2.length === 0,
  };
}

/**
 * 复跑方差：同一格子跑 k 次收集分数（每类抽 1 本 × k=5 的成本受限研究）。
 * @param {{ caller, judgePrompt, content }} deps
 * @param {number} k
 */
export async function rerunForVariance({ caller, judgePrompt, content }, k = 5) {
  const all = [];
  for (let i = 0; i < k; i++) {
    const { scores } = await judgeSemanticCell({ caller, judgePrompt, content });
    all.push(...scores);
  }
  return all;
}
