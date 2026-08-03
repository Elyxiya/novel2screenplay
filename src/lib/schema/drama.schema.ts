import { z } from 'zod';

// ── 景别（Shot Type）──

export const ShotTypeSchema = z.enum([
  'extreme-wide', // 大远景
  'wide', // 远景
  'full', // 全景
  'medium', // 中景
  'close-up', // 近景
  'extreme-close-up', // 特写
  'over-shoulder', // 过肩
  'two-shot', // 双人
]);

// ── 运镜（Camera Move）──

export const CameraMoveSchema = z.enum([
  'static', // 固定
  'pan', // 横摇
  'tilt', // 纵摇
  'dolly-in', // 推
  'dolly-out', // 拉
  'track', // 跟移
  'crane', // 升降
  'handheld', // 手持
  'zoom-in', // 变焦推近
  'zoom-out', // 变焦拉远
]);

// ── 镜头（Shot）──

export const ShotSchema = z.object({
  /** 镜头唯一 ID：shot_1, shot_2 ... */
  shotId: z.string().regex(/^shot_\d+$/),
  /** 全片连续镜号 */
  shotNumber: z.number().int().min(1),
  /** 溯源：来源剧本的场景号 */
  sceneNumber: z.number().int().min(1),
  /** 场景标题行（继承剧本 slugline） */
  slugline: z.string(),
  shotType: ShotTypeSchema,
  cameraMove: CameraMoveSchema,
  /** 预估时长（秒），按台词语速 240 字/分估算 */
  durationSec: z.number().int().min(1),
  /** 台词（若有对白） */
  dialogue: z.string().default(''),
  /** 说话人（若为对白镜头） */
  speaker: z.string().optional(),
  /** 画面提示词（用于成片/文生图） */
  visual: z.string(),
  /** 动作描述 */
  action: z.string().default(''),
  /** 备注 */
  notes: z.string().optional(),
});

// ── 元信息（含溯源链）──

export const DramaMetadataSchema = z.object({
  title: z.string().min(1),
  /** 溯源：来源剧本任务 ID（jobId） */
  sourceScreenplayId: z.string(),
  /** 溯源：来源小说资产 ID（novelId，可为空） */
  sourceNovelId: z.string().nullable().optional(),
  /** 溯源：来源小说标题 */
  sourceNovelTitle: z.string().default(''),
  version: z.string().default('1.0.0'),
  createdAt: z.string().datetime(),
  totalShots: z.number().int(),
  totalScenes: z.number().int(),
});

// ── 根 Drama ──

export const DramaSchema = z.object({
  formatVersion: z.literal('novel2drama-v1'),
  metadata: DramaMetadataSchema,
  shots: z.array(ShotSchema).min(1),
});

// ── Derived Types ──

export type Drama = z.infer<typeof DramaSchema>;
export type Shot = z.infer<typeof ShotSchema>;
export type DramaMetadata = z.infer<typeof DramaMetadataSchema>;
export type ShotType = z.infer<typeof ShotTypeSchema>;
export type CameraMove = z.infer<typeof CameraMoveSchema>;
