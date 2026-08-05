import { z } from 'zod';

// ── Source Reference ──

export const SourceRefSchema = z.object({
  chapterIndex: z.number().int().min(0),
  paragraphIndex: z.number().int().min(0),
  excerpt: z.string(),
  offsetStart: z.number().int().optional(),
  offsetEnd: z.number().int().optional(),
});

// ── Character ──

export const CharacterSchema = z.object({
  characterId: z.string().regex(/^char_\d+$/),
  name: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  personalityTags: z.array(z.string()).max(10).default([]),
  description: z.string().default(''),
  sourceRef: SourceRefSchema.optional(),
  isMajor: z.boolean().default(true),
});

// ── Location ──

export const LocationSchema = z.object({
  locationId: z.string().regex(/^loc_\d+$/),
  name: z.string().min(1),
  type: z.enum(['interior', 'exterior', 'abstract']).default('interior'),
  description: z.string().default(''),
  sourceRef: SourceRefSchema.optional(),
});

// ── Content Blocks ──

export const ActionBlockSchema = z.object({
  type: z.literal('action'),
  description: z.string().min(1),
  sourceRefs: z.array(SourceRefSchema).default([]),
});

export const DialogueBlockSchema = z.object({
  type: z.literal('dialogue'),
  characterId: z.string().min(1),
  line: z.string().min(1),
  direction: z.string().optional(),
  sourceRefs: z.array(SourceRefSchema).default([]),
});

export const ContentBlockSchema = z.discriminatedUnion('type', [
  ActionBlockSchema,
  DialogueBlockSchema,
]);

// ── Scene ──

export const SceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  slugline: z.string().min(1),
  timeOfDay: z
    .enum(['dawn', 'morning', 'afternoon', 'dusk', 'night', 'late-night', 'unknown'])
    .default('unknown'),
  locationId: z.string().regex(/^loc_\d+$/),
  characterIds: z.array(z.string()).default([]),
  content: z.array(ContentBlockSchema).min(1),
  summary: z.string().default(''),
  sourceChapterRange: z.tuple([z.number(), z.number()]).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

// ── Analytics ──

export const AnalyticsSchema = z
  .object({
    totalWords: z.number().int(),
    dialoguePercentage: z.number().min(0).max(100),
    actionPercentage: z.number().min(0).max(100),
    avgSceneLength: z.number(),
    longestScene: z.number(),
    shortestScene: z.number(),
  })
  .optional();

// ── Root Screenplay ──

export const ScreenplaySchema = z.object({
  formatVersion: z.literal('novel2screenplay-v1'),
  metadata: z.object({
    title: z.string().min(1),
    author: z.string().default(''),
    sourceNovel: z.string().min(1),
    version: z.string().default('1.0.0'),
    createdAt: z.string().datetime(),
    totalScenes: z.number().int(),
    totalCharacters: z.number().int(),
    totalLocations: z.number().int(),
  }),
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  scenes: z.array(SceneSchema),
  analytics: AnalyticsSchema,
});

// ── Derived Types ──

export type Screenplay = z.infer<typeof ScreenplaySchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type ContentBlock = z.infer<typeof ContentBlockSchema>;
export type ActionBlock = z.infer<typeof ActionBlockSchema>;
export type DialogueBlock = z.infer<typeof DialogueBlockSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type SourceRef = z.infer<typeof SourceRefSchema>;
