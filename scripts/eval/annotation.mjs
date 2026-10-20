/**
 * 金标注与评分（纯逻辑，无 IO / 无 LLM）
 *
 * 定位：P2 评分系统的计算核。CLI（annotate / review-sheet / freeze / score）只负责读写文件，
 * 所有可测逻辑集中在这里，`annotation.test.mjs` 用 node:assert 零成本守卫。
 *
 * 两个刻意的设计：
 * 1. **来源可追溯**：金标注带 provenance（llm-draft / human），评分时会检查「标注来源」与
 *    「被评运行」是否同一模型同一 prompt —— 同一配置自标自评 = 循环论证，必须显式告警。
 * 2. **抽检即降权**：只有 reviewed=true 的样本计入正式分数；未抽检的样本单独统计，
 *    允许「先跑起来」但不会悄悄污染结论。
 */

export const GOLD_SCHEMA = 'screenplay-gold/v1';
export const DRAFT_SCHEMA = 'screenplay-gold-draft/v1';

/** 场景匹配阈值：段落区间 IoU ≥ 0.5 视为同一场景 */
export const SCENE_IOU_THRESHOLD = 0.5;
/** holdout 比例：约 1/N 的样本进 holdout（按 sampleId 哈希确定性分配） */
export const HOLDOUT_EVERY = 5;

// ── 规范化 ────────────────────────────────────────────────────────────────

/** 名称归一：去空白与标点，保留中英文数字（"白冷叶 " / "白·冷叶" → "白冷叶"） */
export function normalizeName(name) {
  return String(name ?? '')
    .replace(/[\s·・.,，。、'"“”‘’()（）\[\]【】]/g, '')
    .toLowerCase();
}

/** 角色的全部称呼（canonical + aliases），已归一 */
export function aliasSetOf(character) {
  const set = new Set();
  const push = (n) => {
    const v = normalizeName(n);
    if (v) set.add(v);
  };
  push(character?.name);
  for (const a of character?.aliases ?? []) push(a);
  return set;
}

// ── 校验 ──────────────────────────────────────────────────────────────────

/**
 * 校验金标注结构。返回 { ok, errors, warnings }。
 * 只做「能明确判错」的检查；风格问题进 warnings。
 */
export function validateGold(gold) {
  const errors = [];
  const warnings = [];

  if (!gold || typeof gold !== 'object') return { ok: false, errors: ['标注不是对象'], warnings };
  if (gold.schema !== GOLD_SCHEMA) errors.push(`schema 应为 ${GOLD_SCHEMA}，实为 ${String(gold.schema)}`);
  if (!gold.sampleId) errors.push('缺少 sampleId');
  if (!Array.isArray(gold.characters)) errors.push('characters 必须是数组');
  if (!Array.isArray(gold.scenes)) errors.push('scenes 必须是数组');

  const chapterCount = gold?.meta?.chapterCount;
  if (!Number.isInteger(chapterCount) || chapterCount <= 0) {
    errors.push('meta.chapterCount 必须是正整数');
  }

  // 角色：名称非空、canonical 不重复、别名不跨角色冲突
  const seenCanonical = new Map();
  const seenAlias = new Map();
  (gold.characters ?? []).forEach((c, i) => {
    const canonical = normalizeName(c?.name);
    if (!canonical) {
      errors.push(`characters[${i}] 缺少 name`);
      return;
    }
    if (seenCanonical.has(canonical)) {
      errors.push(`角色重名：${c.name}（characters[${seenCanonical.get(canonical)}] 与 [${i}]）`);
    } else {
      seenCanonical.set(canonical, i);
    }
    for (const raw of c.aliases ?? []) {
      const a = normalizeName(raw);
      if (!a) continue;
      if (a === canonical) continue;
      if (seenAlias.has(a) && seenAlias.get(a) !== canonical) {
        warnings.push(`别名「${raw}」同时指向多个角色（${seenAlias.get(a)} 与 ${canonical}），匹配时会算作重叠`);
      }
      seenAlias.set(a, canonical);
    }
  });

  // 场景：章节范围、段落区间合法
  (gold.scenes ?? []).forEach((s, i) => {
    if (!Number.isInteger(s?.chapterIndex) || s.chapterIndex < 0) {
      errors.push(`scenes[${i}].chapterIndex 必须是非负整数`);
    } else if (Number.isInteger(chapterCount) && s.chapterIndex >= chapterCount) {
      errors.push(`scenes[${i}].chapterIndex=${s.chapterIndex} 超出章节数 ${chapterCount}`);
    }
    if (!Number.isInteger(s?.startParagraph) || !Number.isInteger(s?.endParagraph)) {
      errors.push(`scenes[${i}] 的 startParagraph/endParagraph 必须是整数`);
    } else if (s.startParagraph > s.endParagraph) {
      errors.push(`scenes[${i}] startParagraph(${s.startParagraph}) > endParagraph(${s.endParagraph})`);
    }
    // 口径：keyCharacterNames = 实际在场（允许未点名的角色，如「戴玉坠的少女」）；
    //       mentionedCharacterNames = 对话/背景中提及、但不在场的角色。
    if (s?.mentionedCharacterNames !== undefined) {
      if (!Array.isArray(s.mentionedCharacterNames)) {
        errors.push(`scenes[${i}].mentionedCharacterNames 必须是数组`);
      } else {
        for (const n of s.mentionedCharacterNames) {
          if (!normalizeName(n)) {
            errors.push(`scenes[${i}].mentionedCharacterNames 含空名字`);
          } else if (!seenCanonical.has(normalizeName(n)) && !seenAlias.has(normalizeName(n))) {
            warnings.push(`scenes[${i}] 提及的角色「${n}」不在角色卡中（可能是漏抽或别名未归一）`);
          }
        }
      }
    }
  });

  if ((gold.scenes ?? []).length === 0) warnings.push('scenes 为空：Phase 2 指标将无意义');
  if (gold.meta?.reviewed === false) warnings.push('标注尚未抽检（reviewed=false），不计入正式分数');

  return { ok: errors.length === 0, errors, warnings };
}

// ── 确定性切分 ────────────────────────────────────────────────────────────

/** FNV-1a 32 位哈希（确定性、无依赖），用于样本分桶 */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 按 sampleId 确定性分配 train / holdout（同样本永远同桶，跨机器一致） */
export function splitFor(sampleId, every = HOLDOUT_EVERY) {
  return hashString(sampleId) % every === 0 ? 'holdout' : 'train';
}

// ── Phase 1：角色抽取评分 ────────────────────────────────────────────────

/**
 * 贪心 1:1 匹配：预测角色与金标注角色在「任一词条（名字或别名）」上相交即命中。
 * 不做模糊编辑距离——那是模型能力之外的口径问题，先保证口径可解释。
 */
export function matchCharacters(goldCharacters, predictedCharacters) {
  const goldSets = (goldCharacters ?? []).map((c) => ({ raw: c, set: aliasSetOf(c) }));
  const used = new Set();
  const pairs = [];
  const missing = [];
  const extra = [];

  for (const pred of predictedCharacters ?? []) {
    const predSet = aliasSetOf(pred);
    let hit = -1;
    for (let i = 0; i < goldSets.length; i++) {
      if (used.has(i)) continue;
      const g = goldSets[i];
      const overlap = [...predSet].some((a) => g.set.has(a));
      if (overlap) {
        hit = i;
        break;
      }
    }
    if (hit >= 0) {
      used.add(hit);
      pairs.push({ gold: goldSets[hit].raw, predicted: pred });
    } else {
      extra.push(pred);
    }
  }

  goldSets.forEach((g, i) => {
    if (!used.has(i)) missing.push(g.raw);
  });

  return { pairs, missing, extra };
}

export function scorePhase1(goldCharacters, predictedCharacters) {
  const { pairs, missing, extra } = matchCharacters(goldCharacters, predictedCharacters);
  const goldCount = (goldCharacters ?? []).length;
  const predCount = (predictedCharacters ?? []).length;
  const matched = pairs.length;
  return {
    matched,
    goldCount,
    predCount,
    precision: predCount === 0 ? 0 : round(matched / predCount),
    recall: goldCount === 0 ? 0 : round(matched / goldCount),
    f1: f1(matched, predCount, goldCount),
    missing: missing.map((c) => c.name),
    extra: extra.map((c) => c.name),
  };
}

// ── Phase 2：场景切分评分 ────────────────────────────────────────────────

/** 段落区间 IoU（同章节内）；区间为闭区间 [start, end] */
export function iou(a, b) {
  const interStart = Math.max(a.startParagraph, b.startParagraph);
  const interEnd = Math.min(a.endParagraph, b.endParagraph);
  const inter = Math.max(0, interEnd - interStart + 1);
  const union =
    Math.max(a.endParagraph, b.endParagraph) - Math.min(a.startParagraph, b.startParagraph) + 1;
  return union <= 0 ? 0 : inter / union;
}

export function matchScenes(goldScenes, predictedScenes, threshold = SCENE_IOU_THRESHOLD) {
  const used = new Set();
  const pairs = [];
  const missing = [];

  for (const gold of goldScenes ?? []) {
    let bestIdx = -1;
    let bestIou = 0;
    (predictedScenes ?? []).forEach((pred, idx) => {
      if (used.has(idx)) return;
      if (pred.chapterIndex !== gold.chapterIndex) return;
      const overlap = iou(gold, pred);
      if (overlap > bestIou) {
        bestIou = overlap;
        bestIdx = idx;
      }
    });

    if (bestIdx >= 0 && bestIou >= threshold) {
      used.add(bestIdx);
      pairs.push({ gold, predicted: predictedScenes[bestIdx], iou: round(bestIou) });
    } else {
      missing.push(gold);
    }
  }

  const extra = (predictedScenes ?? []).filter((_, idx) => !used.has(idx));
  return { pairs, missing, extra };
}

export function scorePhase2(goldScenes, predictedScenes, threshold = SCENE_IOU_THRESHOLD) {
  const { pairs, missing, extra } = matchScenes(goldScenes, predictedScenes, threshold);
  const goldCount = (goldScenes ?? []).length;
  const predCount = (predictedScenes ?? []).length;
  const matched = pairs.length;
  return {
    matched,
    goldCount,
    predCount,
    precision: predCount === 0 ? 0 : round(matched / predCount),
    recall: goldCount === 0 ? 0 : round(matched / goldCount),
    f1: f1(matched, predCount, goldCount),
    missing: missing.map((s) => `ch${s.chapterIndex}:${s.startParagraph}-${s.endParagraph}`),
    extra: extra.map((s) => `ch${s.chapterIndex}:${s.startParagraph}-${s.endParagraph}`),
  };
}

// ── Phase 3：可溯源性评分 ────────────────────────────────────────────────

/**
 * sourceRef 命中率：剧本块声明的 excerpt 是否真的出现在该章原文中。
 * 这是「有没有编」的最直接信号，且不需要人工标注，任何运行都能算。
 */
export function scoreTraceability(scenes, chapterTexts) {
  let blocks = 0;
  let withRefs = 0;
  let hits = 0;

  for (const scene of scenes ?? []) {
    for (const block of scene?.content ?? []) {
      blocks += 1;
      const refs = block?.sourceRefs ?? [];
      if (refs.length === 0) continue;
      withRefs += 1;
      const hit = refs.some((ref) => {
        const chapter = chapterTexts?.[ref?.chapterIndex] ?? '';
        const excerpt = String(ref?.excerpt ?? '').trim();
        if (!chapter || !excerpt) return false;
        return chapter.includes(excerpt);
      });
      if (hit) hits += 1;
    }
  }

  return {
    blocks,
    withRefs,
    hits,
    refCoverage: blocks === 0 ? 0 : round(withRefs / blocks),
    hitRate: withRefs === 0 ? 0 : round(hits / withRefs),
  };
}

// ── 从运行产物反推预测 / 草稿标注 ────────────────────────────────────────

export function extractPrediction(pipelineState) {
  const chars = pipelineState?.phase1Output?.characters ?? [];
  const scenes = pipelineState?.phase2Output?.scenes ?? [];
  return {
    characters: chars.map((c) => ({ name: c.name, aliases: c.aliases ?? [], isMajor: c.isMajor ?? false })),
    scenes: scenes.map((s) => ({
      chapterIndex: s.chapterIndex,
      startParagraph: s.startParagraph,
      endParagraph: s.endParagraph,
      keyCharacterNames: s.keyCharacterNames ?? [],
    })),
    phase3Scenes: pipelineState?.phase3Output ?? [],
  };
}

/**
 * 把一次真实运行的 Phase1/Phase2 产物转成「草稿金标注」。
 * 这是用户选择的路径：LLM 预标 → 人工抽检。
 * provenance 必须记录清楚，评分时会做独立性检查。
 */
export function buildDraftAnnotation({ sampleId, title, chapterCount, pipelineState, modelId, promptHash, jobId }) {
  const pred = extractPrediction(pipelineState);
  return {
    schema: DRAFT_SCHEMA,
    sampleId,
    title: title ?? sampleId,
    meta: {
      chapterCount,
      reviewed: false,
      provenance: {
        source: 'llm-draft',
        jobId: jobId ?? null,
        modelId: modelId ?? null,
        promptHash: promptHash ?? null,
        draftedAt: new Date().toISOString(),
      },
    },
    characters: pred.characters.map((c) => ({
      name: c.name,
      aliases: c.aliases,
      isMajor: c.isMajor,
    })),
    scenes: pred.scenes,
    keyDialogues: [],
  };
}

// ── 独立性 / 汇总 ────────────────────────────────────────────────────────

/**
 * 循环论证检查：草稿标注若与「被评运行」同模型同 prompt，分数天然偏高。
 * 返回告警文案（无问题返回 null）。
 */
export function checkIndependence(gold, run) {
  const p = gold?.meta?.provenance;
  if (!p || p.source !== 'llm-draft') return null;
  if (run?.modelId && p.modelId === run.modelId && (!run.promptHash || p.promptHash === run.promptHash)) {
    return `样本 ${gold.sampleId} 的金标注由同一模型（${p.modelId}）自标，分数会偏高；建议抽检修正后再计入结论`;
  }
  return null;
}

/** 宏平均（各样本等权，避免长样本主导） */
export function macroAverage(values) {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) return null;
  return round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

/**
 * 汇总一次评测：只把 reviewed=true 的样本计入 official，
 * 未抽检样本进 pending（不影响结论，但可见）。
 */
export function summarizeEvaluation(records) {
  const official = records.filter((r) => r.reviewed);
  const pending = records.filter((r) => !r.reviewed);
  return {
    total: records.length,
    officialCount: official.length,
    pendingCount: pending.length,
    official: {
      phase1Recall: macroAverage(official.map((r) => r.phase1?.recall)),
      phase1Precision: macroAverage(official.map((r) => r.phase1?.precision)),
      phase1F1: macroAverage(official.map((r) => r.phase1?.f1)),
      phase2Recall: macroAverage(official.map((r) => r.phase2?.recall)),
      phase2Precision: macroAverage(official.map((r) => r.phase2?.precision)),
      phase2F1: macroAverage(official.map((r) => r.phase2?.f1)),
      traceabilityHitRate: macroAverage(official.map((r) => r.traceability?.hitRate)),
    },
    warnings: records.flatMap((r) => r.warnings ?? []),
  };
}

// ── 小工具 ───────────────────────────────────────────────────────────────

function round(n) {
  return Number(n.toFixed(4));
}

function f1(matched, predCount, goldCount) {
  if (matched === 0) return 0;
  const p = matched / predCount;
  const r = matched / goldCount;
  return round((2 * p * r) / (p + r));
}
