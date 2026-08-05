import { z } from 'zod';

// ── 卷（Volume）──

export const VolumeSchema = z.object({
  /** 卷唯一 ID */
  id: z.string(),
  /** 卷标题 */
  title: z.string().min(1),
  /** 排序（0 起） */
  order: z.number().int().min(0),
  /** 卷简介 */
  description: z.string().default(''),
});

// ── 章节（Chapter，分卷下叶子节点）──

export const ChapterSchema = z.object({
  /** 章节唯一 ID */
  id: z.string(),
  /** 所属卷 ID（可为空 = 未分卷） */
  volumeId: z.string().nullable(),
  /** 章节标题 */
  title: z.string().min(1),
  /** 排序（卷内 0 起） */
  order: z.number().int().min(0),
  /** 章节正文 */
  content: z.string().default(''),
  /** 字数统计（服务端计算） */
  wordCount: z.number().int().min(0).default(0),
  /** 更新时间 */
  updatedAt: z.number(),
});

// ── 人物卡（CharacterCard）──

export const CharacterCardSchema = z.object({
  id: z.string(),
  /** 姓名 */
  name: z.string().min(1),
  /** 角色定位（主角/反派/配角等） */
  role: z.string().default(''),
  /** 性格特质 */
  traits: z.string().default(''),
  /** 背景设定 */
  background: z.string().default(''),
  /** 备注 */
  notes: z.string().default(''),
});

// ── 世界观词条（WorldItem）──

export const WorldItemSchema = z.object({
  id: z.string(),
  /** 词条名 */
  name: z.string().min(1),
  /** 分类（地理/势力/设定/物品等） */
  category: z.string().default(''),
  /** 描述 */
  description: z.string().default(''),
});

// ── 创作小说（DraftNovel，writer 模块资产）──

export const DraftNovelSchema = z.object({
  /** 资产 ID（与 novels 表主键一致，复用小说资产体系） */
  id: z.string(),
  /** 标题 */
  title: z.string().min(1),
  /** 作者 */
  author: z.string().default(''),
  /** 简介 */
  synopsis: z.string().default(''),
  /** 卷结构 */
  volumes: z.array(VolumeSchema),
  /** 章节（含正文，跨卷扁平存储） */
  chapters: z.array(ChapterSchema),
  /** 人物卡 */
  characters: z.array(CharacterCardSchema),
  /** 世界观词条 */
  worldItems: z.array(WorldItemSchema),
  /** 归属用户 */
  userId: z.string().nullable(),
  /** 创建/更新时间 */
  createdAt: z.number(),
  updatedAt: z.number(),
});

// ── 创建草稿入参 ──

export const CreateDraftParamsSchema = z.object({
  title: z.string().min(1).max(120),
  author: z.string().max(60).optional().default(''),
  synopsis: z.string().max(5000).optional().default(''),
});

export type NovelVolume = z.infer<typeof VolumeSchema>;
export type NovelChapter = z.infer<typeof ChapterSchema>;
export type NovelCharacterCard = z.infer<typeof CharacterCardSchema>;
export type NovelWorldItem = z.infer<typeof WorldItemSchema>;
export type DraftNovel = z.infer<typeof DraftNovelSchema>;
export type CreateDraftParams = z.infer<typeof CreateDraftParamsSchema>;
