import { z } from 'zod';

// ── Raw entities (Phase 1 output) ──

export const RawCharacterSchema = z.object({
  name: z.string(),
  aliases: z.array(z.string()),
  personalityTags: z.array(z.string()),
  description: z.string(),
  isMajor: z.boolean(),
  sourceChapterIndex: z.number().int(),
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

export const Phase1OutputSchema = z.object({
  characters: z.array(RawCharacterSchema),
  locations: z.array(RawLocationSchema),
  timelineHints: z.array(TimelineHintSchema),
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

export const Phase3OutputSchema = z.object({
  sceneNumber: z.number().int(),
  slugline: z.string(),
  timeOfDay: z.string(),
  locationId: z.string(),
  characterIds: z.array(z.string()),
  content: z.array(Phase3ContentBlockSchema),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

// ── Pipeline job state (persisted JSON, consumed by shared store) ──

export const PipelineJobStateSchema = z.object({
  phase1Output: Phase1OutputSchema.optional(),
  phase2Output: Phase2OutputSchema.optional(),
  phase3Output: z.array(Phase3OutputSchema).optional(),
});

// ── Derived Types ──

export type RawCharacter = z.infer<typeof RawCharacterSchema>;
export type RawLocation = z.infer<typeof RawLocationSchema>;
export type TimelineHint = z.infer<typeof TimelineHintSchema>;
export type Phase1Output = z.infer<typeof Phase1OutputSchema>;
export type SceneBoundary = z.infer<typeof SceneBoundarySchema>;
export type Phase2Output = z.infer<typeof Phase2OutputSchema>;
export type Phase3ContentBlock = z.infer<typeof Phase3ContentBlockSchema>;
export type Phase3Output = z.infer<typeof Phase3OutputSchema>;
export type PipelineJobState = z.infer<typeof PipelineJobStateSchema>;