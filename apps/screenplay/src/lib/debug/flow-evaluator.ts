/**
 * 流程效果评测器（FlowEvaluator）
 *
 * 从 StoredJob.pipelineState 计算各阶段质量指标与整体评分。
 * 纯函数、只读、无 LLM 调用，全部为确定性规则。
 *
 * 评分维度：
 * - format：结构完整性（各阶段产物齐全）
 * - consistency：引用一致性（characterId/locationId 可解析）
 * - coherence：叙事连贯性（场景编号连续、章节覆盖）
 * - drama：戏剧张力（对白占比合理性）
 */

import type { StoredJob } from '../store/job-store';

// ── 类型定义 ──────────────────────────────────────────────────────────────

export interface PhaseEval {
  status: 'ok' | 'warn' | 'error' | 'empty';
  score: number; // 0-100
  metrics: Record<string, string | number>;
}

export interface FlowEvaluation {
  jobId: string;
  status: string;
  overall: {
    score: number;
    grade: 'excellent' | 'good' | 'fair' | 'poor';
    dimensions: {
      format: number;
      consistency: number;
      coherence: number;
      drama: number;
      efficiency: number;
    };
  };
  phases: {
    analyze: PhaseEval;
    segment: PhaseEval;
    convert: PhaseEval;
    merge: PhaseEval;
    efficiency: PhaseEval;
  };
  stats: {
    phaseTimings: Record<string, { durationMs: number }>;
    sceneConfidence: { avg: number; min: number; lowCount: number; total: number; buckets: number[] };
    dialoguePercentage: number | null;
    actionPercentage: number | null;
    totalScenes: number;
    fixes: number;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      inputChars: number;
      calls: number;
      tokensPerChar: number | null;
    } | null;
  };
  issues: Array<{ level: 'warn' | 'error'; phase: string; message: string }>;
}

// ── 常量（评分阈值，可调） ────────────────────────────────────────────────

const SCORE = {
  FORMAT_W: 0.25,
  CONSISTENCY_W: 0.2,
  COHERENCE_W: 0.2,
  DRAMA_W: 0.15,
  EFFICIENCY_W: 0.2,
  // 角色数合理性
  CHAR_MIN: 2,
  CHAR_MAX: 40,
  // 场景/章 密度
  SCENE_PER_CHAPTER_MIN: 0.5,
  SCENE_PER_CHAPTER_MAX: 10,
  // 对白占比理想区间
  DIALOGUE_IDEAL_MIN: 25,
  DIALOGUE_IDEAL_MAX: 65,
  // 置信度
  CONFIDENCE_LOW: 0.5,
  CONFIDENCE_LOW_RATIO_MAX: 0.3,
  // token 效率：每转换 1 字原文消耗的总 token 数
  TOKENS_PER_CHAR_GOOD: 1.5,
  TOKENS_PER_CHAR_WARN: 3,
  TOKENS_PER_CHAR_BAD: 5,
} as const;

function clamp(n: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, n));
}

function gradeOf(score: number): FlowEvaluation['overall']['grade'] {
  if (score >= 85) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 55) return 'fair';
  return 'poor';
}

// ── 工具 ──────────────────────────────────────────────────────────────────

function parsePhaseTimings(job: StoredJob): Record<string, { durationMs: number }> {
  const raw = job.metadata?.phaseTimings;
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, { durationMs: number }> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v && typeof v === 'object' && typeof (v as { durationMs?: unknown }).durationMs === 'number') {
      out[k] = { durationMs: (v as { durationMs: number }).durationMs };
    }
  }
  return out;
}

// ── 各阶段评测 ────────────────────────────────────────────────────────────

function evalAnalyze(
  job: StoredJob,
  issues: FlowEvaluation['issues'],
): PhaseEval {
  const p1 = job.pipelineState.phase1Output;
  if (!p1) {
    return { status: 'empty', score: 0, metrics: {} };
  }
  const chars = p1.characters?.length ?? 0;
  const locs = p1.locations?.length ?? 0;
  const hints = p1.timelineHints?.length ?? 0;

  let score = 100;
  if (chars === 0) {
    score -= 100;
    issues.push({ level: 'error', phase: 'analyze', message: '未提取到任何角色' });
  } else if (chars < SCORE.CHAR_MIN) {
    score -= 30;
    issues.push({ level: 'warn', phase: 'analyze', message: `角色数过少（${chars}），可能遗漏主要角色` });
  } else if (chars > SCORE.CHAR_MAX) {
    score -= 20;
    issues.push({ level: 'warn', phase: 'analyze', message: `角色数过多（${chars}），可能存在过度提取` });
  }

  if (locs === 0) {
    score -= 40;
    issues.push({ level: 'warn', phase: 'analyze', message: '未提取到任何地点' });
  }

  return {
    status: score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error',
    score: clamp(score),
    metrics: { 角色: chars, 地点: locs, 时间线索: hints },
  };
}

function evalSegment(
  job: StoredJob,
  chapterCount: number,
  issues: FlowEvaluation['issues'],
): PhaseEval {
  const p2 = job.pipelineState.phase2Output;
  if (!p2) {
    return { status: 'empty', score: 0, metrics: {} };
  }
  const sceneCount = p2.scenes?.length ?? 0;
  const perChapter = chapterCount > 0 ? sceneCount / chapterCount : 0;

  let score = 100;
  if (sceneCount === 0) {
    score -= 100;
    issues.push({ level: 'error', phase: 'segment', message: '未切分出任何场景' });
  } else if (perChapter < SCORE.SCENE_PER_CHAPTER_MIN) {
    score -= 25;
    issues.push({
      level: 'warn',
      phase: 'segment',
      message: `场景密度过低（每章约 ${perChapter.toFixed(2)} 个场景），可能存在欠切分`,
    });
  } else if (perChapter > SCORE.SCENE_PER_CHAPTER_MAX) {
    score -= 20;
    issues.push({ level: 'warn', phase: 'segment', message: `场景密度过高（每章约 ${perChapter.toFixed(2)} 个场景）` });
  }

  return {
    status: score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error',
    score: clamp(score),
    metrics: { 场景数: sceneCount, 每章场景: Number(perChapter.toFixed(2)) },
  };
}

function evalConvert(
  job: StoredJob,
  issues: FlowEvaluation['issues'],
): PhaseEval {
  const p3 = job.pipelineState.phase3Output;
  if (!p3 || p3.length === 0) {
    return { status: 'empty', score: 0, metrics: {} };
  }

  const confidences = p3
    .map((s) => s.confidence)
    .filter((c): c is number => typeof c === 'number');
  const avg = confidences.length > 0
    ? confidences.reduce((a, b) => a + b, 0) / confidences.length
    : 0;
  const lowCount = confidences.filter((c) => c < SCORE.CONFIDENCE_LOW).length;
  const lowRatio = confidences.length > 0 ? lowCount / confidences.length : 0;

  let score = Math.round(avg * 100);
  if (confidences.length === 0) {
    score = 60;
    issues.push({ level: 'warn', phase: 'convert', message: '场景缺少 confidence 字段，无法评估转换质量' });
  }
  if (lowRatio > SCORE.CONFIDENCE_LOW_RATIO_MAX) {
    score -= 20;
    issues.push({
      level: 'warn',
      phase: 'convert',
      message: `低置信度场景占比 ${(lowRatio * 100).toFixed(0)}%，存在质量风险`,
    });
  }

  return {
    status: score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error',
    score: clamp(score),
    metrics: {
      场景: p3.length,
      平均置信度: confidences.length > 0 ? Number(avg.toFixed(2)) : '未知',
      低置信度: lowCount,
    },
  };
}

function evalMerge(
  job: StoredJob,
  issues: FlowEvaluation['issues'],
): PhaseEval {
  const p4 = job.pipelineState.phase4Output;
  if (!p4) {
    return { status: 'empty', score: 0, metrics: {} };
  }

  const scenes = p4.scenes ?? [];
  const characters = p4.characters ?? [];
  const locations = p4.locations ?? [];
  const analytics = p4.analytics;
  let score = 100;

  // 场景编号连续
  const numbers = scenes.map((s) => s.sceneNumber).sort((a, b) => a - b);
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] !== numbers[i - 1] + 1) {
      score -= 15;
      issues.push({
        level: 'warn',
        phase: 'merge',
        message: `场景编号不连续（...${numbers[i - 1]}, ${numbers[i]}...）`,
      });
      break;
    }
  }

  // characterId 引用有效
  const charIds = new Set(characters.map((c) => c.characterId));
  const danglingChars = scenes.flatMap((s) => s.characterIds ?? []).filter((id) => !charIds.has(id));
  if (danglingChars.length > 0) {
    score -= 15;
    issues.push({
      level: 'error',
      phase: 'merge',
      message: `${danglingChars.length} 个场景引用了不存在的角色 ID（如 ${danglingChars.slice(0, 3).join(', ')}）`,
    });
  }

  // locationId 引用有效
  const locIds = new Set(locations.map((l) => l.locationId));
  const danglingLocs = scenes.flatMap((s) => (s.locationId ? [s.locationId] : [])).filter((id) => !locIds.has(id));
  if (danglingLocs.length > 0) {
    score -= 15;
    issues.push({
      level: 'error',
      phase: 'merge',
      message: `${danglingLocs.length} 个场景引用了不存在的地点 ID`,
    });
  }

  // 对白/动作分布（计入 drama）
  const dialogue = analytics?.dialoguePercentage;
  const action = analytics?.actionPercentage;
  if (dialogue !== undefined && (dialogue < SCORE.DIALOGUE_IDEAL_MIN || dialogue > SCORE.DIALOGUE_IDEAL_MAX)) {
    score -= 10;
    issues.push({
      level: 'warn',
      phase: 'merge',
      message: `对白占比 ${dialogue}% 偏离理想区间（${SCORE.DIALOGUE_IDEAL_MIN}-${SCORE.DIALOGUE_IDEAL_MAX}%）`,
    });
  }

  return {
    status: score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error',
    score: clamp(score),
    metrics: {
      场景: scenes.length,
      角色: characters.length,
      地点: locations.length,
      对白: dialogue !== undefined ? `${dialogue}%` : '未知',
      动作: action !== undefined ? `${action}%` : '未知',
    },
  };
}

// ── 整体评测 ───────────────────────────────────────────────────────────────

function parseUsage(job: StoredJob): FlowEvaluation['stats']['usage'] {
  const raw = job.metadata?.usage;
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const promptTokens = typeof u.promptTokens === 'number' ? u.promptTokens : 0;
  const completionTokens = typeof u.completionTokens === 'number' ? u.completionTokens : 0;
  const inputChars = typeof u.inputChars === 'number' ? u.inputChars : 0;
  const calls = typeof u.calls === 'number' ? u.calls : 0;
  if (calls === 0) return null;
  const totalTokens = promptTokens + completionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    inputChars,
    calls,
    tokensPerChar: inputChars > 0 ? Number((totalTokens / inputChars).toFixed(2)) : null,
  };
}

function evalEfficiency(
  usage: FlowEvaluation['stats']['usage'],
  issues: FlowEvaluation['issues'],
): PhaseEval {
  if (!usage || usage.calls === 0) {
    return {
      status: 'empty',
      score: 60,
      metrics: { 说明: '无 usage 数据' },
    };
  }

  const tpc = usage.tokensPerChar;
  let score = 100;
  if (tpc === null) {
    score = 60;
    issues.push({ level: 'warn', phase: 'convert', message: '无输入字符数据，无法计算 token 效率' });
  } else if (tpc > SCORE.TOKENS_PER_CHAR_BAD) {
    score = 30;
    issues.push({
      level: 'warn',
      phase: 'convert',
      message: `token 效率低（每字 ${tpc} token），上下文裁剪未生效或输入过大`,
    });
  } else if (tpc > SCORE.TOKENS_PER_CHAR_WARN) {
    score = 55;
    issues.push({
      level: 'warn',
      phase: 'convert',
      message: `token 效率一般（每字 ${tpc} token），可进一步裁剪上下文`,
    });
  } else if (tpc > SCORE.TOKENS_PER_CHAR_GOOD) {
    score = 80;
  }

  return {
    status: score >= 85 ? 'ok' : score >= 60 ? 'warn' : 'error',
    score: clamp(score),
    metrics: {
      调用次数: usage.calls,
      输入token: usage.promptTokens,
      输出token: usage.completionTokens,
      输入字符: usage.inputChars,
      每字token: tpc ?? '未知',
    },
  };
}

export function evaluateFlow(job: StoredJob): FlowEvaluation {
  const issues: FlowEvaluation['issues'] = [];
  const chapterCount = job.chapterTexts?.length ?? 0;

  const usage = parseUsage(job);
  const phaseAnalyze = evalAnalyze(job, issues);
  const phaseSegment = evalSegment(job, chapterCount, issues);
  const phaseConvert = evalConvert(job, issues);
  const phaseMerge = evalMerge(job, issues);
  const phaseEfficiency = evalEfficiency(usage, issues);

  // format：产物完整性
  const hasP1 = Boolean(job.pipelineState.phase1Output);
  const hasP2 = Boolean(job.pipelineState.phase2Output);
  const hasP3 = (job.pipelineState.phase3Output?.length ?? 0) > 0;
  const hasP4 = Boolean(job.pipelineState.phase4Output);
  const format =
    (hasP1 ? 25 : 0) + (hasP2 ? 25 : 0) + (hasP3 ? 25 : 0) + (hasP4 ? 25 : 0);
  if (!hasP4) {
    issues.push({ level: 'error', phase: 'overall', message: '缺少最终剧本（Phase 4 未完成）' });
  }

  // consistency：引用有效性（取 merge 阶段的引用类扣分）
  const p4 = job.pipelineState.phase4Output;
  let consistency = 100;
  if (p4) {
    const charIds = new Set(p4.characters.map((c) => c.characterId));
    const danglingChars = p4.scenes.flatMap((s) => s.characterIds ?? []).filter((id) => !charIds.has(id));
    const locIds = new Set(p4.locations.map((l) => l.locationId));
    const danglingLocs = p4.scenes.map((s) => s.locationId).filter((id) => !locIds.has(id));
    if (danglingChars.length > 0) consistency -= 30;
    if (danglingLocs.length > 0) consistency -= 30;
  } else {
    consistency = 0;
  }

  // coherence：场景编号连续 + 章节覆盖
  let coherence = 100;
  if (p4 && p4.scenes.length > 0) {
    const numbers = p4.scenes.map((s) => s.sceneNumber).sort((a, b) => a - b);
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        coherence -= 40;
        break;
      }
    }
    const withRange = p4.scenes.filter((s) => s.sourceChapterRange).length;
    if (withRange === 0) coherence -= 20;
  } else {
    coherence = 0;
  }

  // drama：对白占比合理性
  const dialogue = p4?.analytics?.dialoguePercentage;
  let drama = 70; // 默认中位
  if (dialogue !== undefined) {
    if (dialogue >= SCORE.DIALOGUE_IDEAL_MIN && dialogue <= SCORE.DIALOGUE_IDEAL_MAX) {
      drama = 95;
    } else if (dialogue >= 10 && dialogue <= 90) {
      drama = 70;
    } else {
      drama = 40;
    }
  }

  const score = Math.round(
    format * SCORE.FORMAT_W +
      consistency * SCORE.CONSISTENCY_W +
      coherence * SCORE.COHERENCE_W +
      drama * SCORE.DRAMA_W +
      phaseEfficiency.score * SCORE.EFFICIENCY_W,
  );

  const p3 = job.pipelineState.phase3Output ?? [];
  const confidences = p3
    .map((s) => s.confidence)
    .filter((c): c is number => typeof c === 'number');

  // 置信度分布桶：0-0.2 / 0.2-0.4 / 0.4-0.6 / 0.6-0.8 / 0.8-1.0
  const BUCKET_COUNT = 5;
  const buckets = Array<number>(BUCKET_COUNT).fill(0);
  for (const c of confidences) {
    const idx = Math.min(BUCKET_COUNT - 1, Math.floor(c / (1 / BUCKET_COUNT)));
    buckets[idx]++;
  }

  return {
    jobId: job.id,
    status: job.status,
    overall: {
      score,
      grade: gradeOf(score),
      dimensions: {
        format: clamp(format),
        consistency: clamp(consistency),
        coherence: clamp(coherence),
        drama: clamp(drama),
        efficiency: phaseEfficiency.score,
      },
    },
    phases: {
      analyze: phaseAnalyze,
      segment: phaseSegment,
      convert: phaseConvert,
      merge: phaseMerge,
      efficiency: phaseEfficiency,
    },
    stats: {
      phaseTimings: parsePhaseTimings(job),
      sceneConfidence: {
        avg: confidences.length > 0
          ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2))
          : 0,
        min: confidences.length > 0 ? Math.min(...confidences) : 0,
        lowCount: confidences.filter((c) => c < SCORE.CONFIDENCE_LOW).length,
        total: confidences.length,
        buckets,
      },
      dialoguePercentage: p4?.analytics?.dialoguePercentage ?? null,
      actionPercentage: p4?.analytics?.actionPercentage ?? null,
      totalScenes: p4?.scenes?.length ?? p3.length,
      fixes: 0,
      usage,
    },
    issues,
  };
}
