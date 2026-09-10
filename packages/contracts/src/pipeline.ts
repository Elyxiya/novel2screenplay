import { z } from 'zod';

// ── Raw entities (Phase 1 output) ──

/** One (alias, chapterIndex) pair that contributed to a merged entity's identity. */
export const MergeProvenanceSchema = z.object({
  name: z.string(),
  chapterIndex: z.number().int(),
});

/** FIX-21：分阶段卡——按章节区间的角色状态快照（缺省=整篇恒定，向后兼容） */
export const CardSegmentSchema = z.object({
  fromChapterIndex: z.number().int(),
  /** 含端点；缺省 = 至结尾 */
  toChapterIndex: z.number().int().optional(),
  personalityTags: z.array(z.string()).optional(),
  description: z.string().optional(),
  /** 阶段状态自由文本（如「重伤」「继任宗主」），供注入展示与人工核对 */
  status: z.string().optional(),
});

export const RawCharacterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  personalityTags: z.array(z.string()),
  description: z.string(),
  isMajor: z.boolean(),
  sourceChapterIndex: z.number().int(),
  /**
   * map-reduce 归并出处（可选）：跨章合并时，记录被归并进的别名及来源章节，
   * 使断言矛盾可回溯到具体 merge 决策。旧截断路径不产出该字段。
   */
  mergeProvenance: z.array(MergeProvenanceSchema).optional(),
  /**
   * FIX-21：分阶段卡段（可选）。多段命中时取「最晚开始」的段（更贴近当下章）；
   * 全部不命中回退基础字段。v1 由人工/后处理补齐，map-reduce 不自动产出。
   */
  cardSegments: z.array(CardSegmentSchema).optional(),
  /** FIX-21：真名揭示章（含）；此前应使用别名口径，称谓断言据此放行/拦截 */
  revealAt: z.number().int().optional(),
});

export const RawLocationSchema = z.object({
  name: z.string(),
  type: z.enum(['interior', 'exterior', 'abstract']),
  description: z.string(),
  sourceChapterIndex: z.number().int(),
});

export const TimelineHintSchema = z.object({
  chapterIndex: z.number().int(),
  timeCue: z.string(),
  type: z.enum(['time-of-day', 'time-jump', 'season']),
});

// ── Phase 1 map-reduce: 全局设定卡（章节摘要 + open threads）──

export const ChapterSummarySchema = z.object({
  chapterIndex: z.number().int(),
  summary: z.string(),
});

export const OpenThreadSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  startChapterIndex: z.number().int(),
  /** 有终点则为已闭合伏笔，否则是开放线索 */
  endChapterIndex: z.number().int().optional(),
});

export const SettingCardSchema = z.object({
  chapterSummaries: z.array(ChapterSummarySchema),
  openThreads: z.array(OpenThreadSchema),
});

export const Phase1OutputSchema = z.object({
  characters: z.array(RawCharacterSchema),
  locations: z.array(RawLocationSchema),
  timelineHints: z.array(TimelineHintSchema),
  /** 全局设定卡（map-reduce 路径产出；旧截断路径无此字段） */
  settingCard: SettingCardSchema.optional(),
  rawResponse: z.string(),
});

// ── Phase 2: scene boundaries ──

export const SceneBoundarySchema = z.object({
  sceneIndex: z.number().int(),
  chapterIndex: z.number().int(),
  startParagraph: z.number().int(),
  endParagraph: z.number().int(),
  originalStartOffset: z.number(),
  originalEndOffset: z.number(),
  draftSlugline: z.string(),
  keyCharacterNames: z.array(z.string()),
  summary: z.string(),
});

export const Phase2OutputSchema = z.object({
  scenes: z.array(SceneBoundarySchema),
  rawResponses: z.array(z.string()),
  /** 后处理事件统计（FIX-03）：合并/重叠修正次数——属过程信息、读时不可复现，随产物落库 */
  stats: z
    .object({
      mergedPairs: z.number().int().min(0),
      overlapFixes: z.number().int().min(0),
    })
    .optional(),
});

// ── Phase 3: converted scene ──

export const Phase3ContentBlockSchema = z.object({
  type: z.enum(['action', 'dialogue']),
  description: z.string().optional(),
  characterId: z.string().optional(),
  line: z.string().optional(),
  direction: z.string().optional(),
  sourceRefs: z.array(
    z.object({
      chapterIndex: z.number().int(),
      paragraphIndex: z.number().int(),
      excerpt: z.string(),
    }),
  ),
});

export const Phase3SceneErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  attempts: z.number().int().optional(),
});

export const Phase3OutputSchema = z.object({
  sceneNumber: z.number().int(),
  slugline: z.string(),
  timeOfDay: z.string(),
  locationId: z.string(),
  characterIds: z.array(z.string()),
  content: z.array(Phase3ContentBlockSchema),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
  /** 场景级失败明细（FIX-03/FIX-22）：降级场景携带，供聚合与人工定位 */
  error: Phase3SceneErrorSchema.optional(),
});

// ── Pipeline job state (persisted JSON, consumed by shared store) ──

export const PipelineJobStateSchema = z.object({
  phase1Output: Phase1OutputSchema.optional(),
  phase2Output: Phase2OutputSchema.optional(),
  phase3Output: z.array(Phase3OutputSchema).optional(),
});

// ── Derived Types ──

export type MergeProvenance = z.infer<typeof MergeProvenanceSchema>;
export type CardSegment = z.infer<typeof CardSegmentSchema>;
export type RawCharacter = z.infer<typeof RawCharacterSchema>;
export type RawLocation = z.infer<typeof RawLocationSchema>;
export type TimelineHint = z.infer<typeof TimelineHintSchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type OpenThread = z.infer<typeof OpenThreadSchema>;
export type SettingCard = z.infer<typeof SettingCardSchema>;
export type Phase1Output = z.infer<typeof Phase1OutputSchema>;
export type SceneBoundary = z.infer<typeof SceneBoundarySchema>;
export type Phase2Output = z.infer<typeof Phase2OutputSchema>;
export type Phase3ContentBlock = z.infer<typeof Phase3ContentBlockSchema>;
export type Phase3SceneError = z.infer<typeof Phase3SceneErrorSchema>;
export type Phase3Output = z.infer<typeof Phase3OutputSchema>;
export type PipelineJobState = z.infer<typeof PipelineJobStateSchema>;