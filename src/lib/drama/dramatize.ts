/**
 * 短剧分镜转换引擎
 *
 * 纯函数、无 LLM 依赖：把剧本（Screenplay）按规则拆解为短剧分镜（Drama）。
 * 规则：
 *  - 每个对白块 → 一个镜头（景别按场景角色数推断，时长按台词语速估算）
 *  - 每个动作块 → 一个或多个镜头（超长描述按 ~100 字/镜拆分）
 *  - 溯源：镜头携带 sceneNumber，metadata 携带 sourceScreenplayId / sourceNovelId
 *
 * 说明：P0 先以规则引擎打通链路；LLM 增强版分镜（运镜/氛围高级生成）留待后续阶段。
 */

import type { Screenplay } from '../schema/screenplay.schema';
import {
  DramaSchema,
  type Drama,
  type Shot,
  type ShotType,
  type CameraMove,
} from '../schema/drama.schema';

export interface DramatizeOptions {
  title?: string;
  sourceScreenplayId: string;
  sourceNovelId?: string | null;
  sourceNovelTitle?: string;
  /** 可注入当前时间（默认 now） */
  now?: Date;
}

/** 中文对白语速估算：约 240 字/分钟 ≈ 4 字/秒 */
const DIALOGUE_CHARS_PER_SECOND = 4;
/** 动作块单镜最大字数（超出则拆分） */
const ACTION_MAX_CHARS_PER_SHOT = 100;
/** 动作镜头时长：基础 3 秒 + 每 25 字加 1 秒，上限 15 秒 */
const ACTION_SECONDS_PER_25_CHARS = 25;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** 根据场景内角色数量推断对白镜头景别 */
function shotTypeForScene(characterCount: number): ShotType {
  if (characterCount <= 1) return 'close-up';
  if (characterCount === 2) return 'two-shot';
  return 'medium';
}

/** 根据动作描述长度推断镜头景别 */
function shotTypeForAction(description: string): ShotType {
  const len = description.length;
  if (len < 30) return 'medium';
  if (len < 80) return 'full';
  return 'wide';
}

/** 动作镜头运镜：描述含运动词时给简单运镜，否则固定机位 */
function cameraMoveForAction(description: string): CameraMove {
  if (/走|跑|追|奔|移动/.test(description)) return 'track';
  if (/看|望|凝视|注视/.test(description)) return 'dolly-in';
  if (/转|环视|扫视/.test(description)) return 'pan';
  return 'static';
}

function estimateDialogueDuration(line: string): number {
  return Math.max(3, Math.ceil(line.length / DIALOGUE_CHARS_PER_SECOND));
}

function estimateActionDuration(description: string): number {
  return clamp(3 + Math.ceil(description.length / ACTION_SECONDS_PER_25_CHARS), 3, 15);
}

/** 拆分超长动作描述为 ≤ACTION_MAX_CHARS_PER_SHOT 的片段 */
function splitActionDescription(description: string): string[] {
  if (description.length <= ACTION_MAX_CHARS_PER_SHOT) return [description];
  const parts: string[] = [];
  for (let i = 0; i < description.length; i += ACTION_MAX_CHARS_PER_SHOT) {
    parts.push(description.slice(i, i + ACTION_MAX_CHARS_PER_SHOT));
  }
  return parts;
}

/**
 * 把剧本转换为短剧分镜。
 * @throws 若剧本无效（zod 校验失败）
 */
export function dramatize(screenplay: Screenplay, options: DramatizeOptions): Drama {
  const characterNames = new Map(
    screenplay.characters.map(c => [c.characterId, c.name] as const),
  );

  let shotCounter = 0;
  const shots: Shot[] = [];

  for (const scene of screenplay.scenes) {
    const characterCount = scene.characterIds.length;

    // 空场景兜底：至少产出一个镜头
    if (scene.content.length === 0) {
      shotCounter += 1;
      shots.push({
        shotId: `shot_${shotCounter}`,
        shotNumber: shotCounter,
        sceneNumber: scene.sceneNumber,
        slugline: scene.slugline,
        shotType: 'wide',
        cameraMove: 'static',
        durationSec: 5,
        dialogue: '',
        visual: scene.summary || scene.slugline,
        action: scene.summary,
        notes: '空场景兜底镜头',
      });
      continue;
    }

    for (const block of scene.content) {
      if (block.type === 'dialogue') {
        shotCounter += 1;
        const speaker = characterNames.get(block.characterId) ?? block.characterId;
        const direction = block.direction?.trim();
        shots.push({
          shotId: `shot_${shotCounter}`,
          shotNumber: shotCounter,
          sceneNumber: scene.sceneNumber,
          slugline: scene.slugline,
          shotType: shotTypeForScene(characterCount),
          cameraMove: 'static',
          durationSec: estimateDialogueDuration(block.line),
          dialogue: block.line,
          speaker,
          visual: direction ? `${speaker} ${direction}` : `${speaker} 开口说话`,
          action: '',
        });
      } else {
        // action 块：超长描述拆分为多个镜头
        const parts = splitActionDescription(block.description);
        for (const part of parts) {
          shotCounter += 1;
          shots.push({
            shotId: `shot_${shotCounter}`,
            shotNumber: shotCounter,
            sceneNumber: scene.sceneNumber,
            slugline: scene.slugline,
            shotType: shotTypeForAction(part),
            cameraMove: cameraMoveForAction(part),
            durationSec: estimateActionDuration(part),
            dialogue: '',
            visual: part,
            action: part,
          });
        }
      }
    }
  }

  const now = (options.now ?? new Date()).toISOString();
  const drama: Drama = {
    formatVersion: 'novel2drama-v1',
    metadata: {
      title: options.title ?? screenplay.metadata.title,
      sourceScreenplayId: options.sourceScreenplayId,
      sourceNovelId: options.sourceNovelId ?? null,
      sourceNovelTitle: options.sourceNovelTitle ?? '',
      version: '1.0.0',
      createdAt: now,
      totalShots: shots.length,
      totalScenes: screenplay.scenes.length,
    },
    shots,
  };

  // 校验后返回（保证产出始终符合契约）
  return DramaSchema.parse(drama);
}
