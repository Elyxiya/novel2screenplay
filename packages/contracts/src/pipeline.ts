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

/** FIX-14：同名/近名冲突预警候选（只提示人工，不参与归并裁决） */
export const NameConflictCandidateSchema = z.object({
  kind: z.enum(['alias-collision', 'circular-alias', 'far-apart-same-name']),
  names: z.array(z.string()),
  chapters: z.array(z.number().int()),
  message: z.string(),
});

export const Phase1OutputSchema = z.object({
  characters: z.array(RawCharacterSchema),
  locations: z.array(RawLocationSchema),
  timelineHints: z.array(TimelineHintSchema),
  /** 全局设定卡（map-reduce 路径产出；旧截断路径无此字段） */
  settingCard: SettingCardSchema.optional(),
  /** FIX-14：归并前检测的同名/近名冲突候选（map-reduce 产出） */
  nameConflicts: z.array(NameConflictCandidateSchema).optional(),
  /**
   * 别名 → canonical 名 索引（map-reduce 产出）。
   * 注：评估脚本（run-conversion/identity）消费该字段；此前被 Analyzer 剥离导致
   * "别名当 ID"断言空跑（B-21），C5 批顺带持久化修复。
   */
  aliasIndex: z.record(z.string(), z.string()).optional(),
  rawResponse: z.string(),
});

// ── FIX-13: 用户自定义设定（意图通道，C5 契约域）──

/** 角色覆盖：按 name 匹配抽取卡；用户值优先，差异记 conflict */
export const UserCharacterOverrideSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()).optional(),
  personalityTags: z.array(z.string()).optional(),
  description: z.string().optional(),
  isMajor: z.boolean().optional(),
});

/** 结构化约束（可映射到断言/卡字段的部分显式建模，其余走自由文本） */
export const PlotConstraintSchema = z.object({
  id: z.string().optional(),
  rule: z.string(),
  kind: z
    .enum(['forbid-death', 'forbid-reveal-before', 'require-reveal-at', 'lock-appellation', 'custom'])
    .optional(),
  character: z.string().optional(),
  chapterIndex: z.number().int().optional(),
});

/** 称谓锁定：该角色只准使用 lockedNames 中的称呼 */
export const AppellationLockSchema = z.object({
  character: z.string(),
  lockedNames: z.array(z.string()).min(1),
});

/**
 * 用户画像（用户显式提供的改编意图）：
 * - 融合规则：**用户设定 > 原文抽取**；差异一律记 conflict（不静默覆盖）；
 * - 注入：格式化块常驻 Phase3（≤500 字符）；profile 参与指纹（manifest/eval cells）。
 */
export const UserProfileSchema = z.object({
  characters: z.array(UserCharacterOverrideSchema).default([]),
  appellations: z.array(AppellationLockSchema).default([]),
  constraints: z.array(PlotConstraintSchema).default([]),
  /** 预留：目标形态（短剧/有声剧…），由风格参数化批（C6）消费 */
  targetFormat: z.string().optional(),
});

// ── FIX-12: 风格五轴参数化（C6 契约域）──

/**
 * 风格 = 五轴参数（非离散模板；预设只是参数组合的快捷方式）：
 * ① channel 信息通道：visual（画面承担叙事）| audio（一切必须可听）
 * ② dialoguePolicy 对白策略：implicit（潜台词/低密度）| direct（直给/高密度）| plain（平实叙述型）
 * ③ rhythmUnit 节奏单元：episodeTargetMinutes + hookPolicy（集末钩子）
 * ④ voPolicy 旁白地位：forbidden（忌用）| allowed（限量）| primary（主叙事通道）
 * ⑤ artifactForm 下游产物形态：screenplay（文学剧本）| dubbing-script（配音脚本）
 */
export const StyleProfileSchema = z.object({
  channel: z.enum(['visual', 'audio']),
  dialoguePolicy: z.enum(['implicit', 'direct', 'plain']),
  rhythmUnit: z.object({
    episodeTargetMinutes: z.number().positive(),
    hookPolicy: z.enum(['cliffhanger', 'none']),
  }),
  voPolicy: z.enum(['forbidden', 'allowed', 'primary']),
  artifactForm: z.enum(['screenplay', 'dubbing-script']),
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
export type UserCharacterOverride = z.infer<typeof UserCharacterOverrideSchema>;
export type PlotConstraint = z.infer<typeof PlotConstraintSchema>;
export type AppellationLock = z.infer<typeof AppellationLockSchema>;
export type UserProfile = z.infer<typeof UserProfileSchema>;
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
export type RawLocation = z.infer<typeof RawLocationSchema>;
export type TimelineHint = z.infer<typeof TimelineHintSchema>;
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type OpenThread = z.infer<typeof OpenThreadSchema>;
export type SettingCard = z.infer<typeof SettingCardSchema>;
export type Phase1Output = z.infer<typeof Phase1OutputSchema>;
export type NameConflictCandidate = z.infer<typeof NameConflictCandidateSchema>;
export type SceneBoundary = z.infer<typeof SceneBoundarySchema>;
export type Phase2Output = z.infer<typeof Phase2OutputSchema>;
export type Phase3ContentBlock = z.infer<typeof Phase3ContentBlockSchema>;
export type Phase3SceneError = z.infer<typeof Phase3SceneErrorSchema>;
export type Phase3Output = z.infer<typeof Phase3OutputSchema>;
export type PipelineJobState = z.infer<typeof PipelineJobStateSchema>;