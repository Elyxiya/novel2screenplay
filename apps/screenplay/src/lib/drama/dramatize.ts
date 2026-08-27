/**
 * 短剧分镜转换引擎（规则增强版）
 *
 * 纯函数、无 LLM 依赖：把剧本（Screenplay）按可解释规则拆解为短剧分镜（Drama）。
 * 相比基础版增强点（见 .trae/documents/分镜深化-规则增强.md）：
 *  - 每个场景先产出定场镜头（establishing shot）
 *  - 动作块按「语义断句」拆分为完整动作节拍，而非固定字符硬切
 *  - 景别/运镜按内容性质给出更多样取值（打斗/追逐/审视/环视…）
 *  - 为镜头推导可选深化字段：mood（情绪氛围）、sound（环境音）、
 *    characterEmotion（说话人情绪）、subtitle（落屏字幕稿）
 *  - 溯源不变：镜头携带 sceneNumber，metadata 携带 sourceScreenplayId / sourceNovelId
 *
 * 说明：深化字段均「可选」，旧分镜数据仍可解析（向后兼容）。
 */

import type { Screenplay, Location } from '@novel/contracts/screenplay';
import {
  DramaSchema,
  type Drama,
  type Shot,
  type ShotType,
  type CameraMove,
} from '@novel/contracts/drama';

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
/** 动作块单镜最大字数（超出则在语义断点拆分，兜底硬切） */
const ACTION_MAX_CHARS_PER_SHOT = 100;
/** 动作镜头时长：基础 3 秒 + 每 25 字加 1 秒，上限 15 秒 */
const ACTION_SECONDS_PER_25_CHARS = 25;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

// ── 情绪/氛围/音效 规则 ──

/** 时段 → 镜头情绪氛围 */
const TIME_MOOD: Record<string, string> = {
  dawn: '清新',
  morning: '安宁',
  afternoon: '热烈',
  dusk: '苍凉',
  night: '静谧',
  'late-night': '悬疑',
  unknown: '',
};
/** 时段 → 环境音 */
const TIME_SOUND: Record<string, string> = {
  night: '夜虫低鸣',
  'late-night': '风声萧瑟',
  dawn: '清晨鸟鸣',
  morning: '',
  afternoon: '',
  dusk: '归鸟鸣叫',
  unknown: '',
};

/** 动作文本 → 情绪氛围 */
function moodFromAction(text: string): string {
  if (/(打|杀|攻|战|斗|斩|挥|厮杀)/.test(text)) return '紧张';
  if (/(追|奔|逃|跑|疾驰)/.test(text)) return '急促';
  if (/(死|亡|诀别|泪|血|哀|墓|尸)/.test(text)) return '悲怆';
  if (/(静|寂|沉|凝|安).{0,4}(月|夜)/.test(text)) return '静谧';
  return '';
}

/** 动作文本 → 音效 */
function soundFromAction(text: string): string {
  if (/(打|杀|斗|斩|剑|刀|兵器|交锋)/.test(text)) return '刀剑碰撞/破风声';
  return '';
}

/** 对白：由 direction 与台词标点推说话人情绪 */
function emotionFromDialogue(line: string, direction?: string): string {
  const dir = (direction ?? '').trim();
  if (/(哭|泪|抽泣|哽咽)/.test(dir)) return '悲伤';
  if (/(笑|轻笑|扬|调侃)/.test(dir)) return '轻快';
  if (/(怒|吼|喝|呵斥|拍案|咬牙)/.test(dir)) return '愤怒';
  if (/(惊|愣|错愕|骇)/.test(dir)) return '惊讶';
  if (/(凝|沉思|沉吟|低语|喃喃|叹息)/.test(dir)) return '沉吟';
  if (/(平静|淡淡|漠然|冷静)/.test(dir)) return '平静';
  if (/[？！]/.test(line)) return '激动';
  if (/…/.test(line)) return '沉吟';
  return '平静';
}

/** 说话人情绪 → 镜头情绪氛围 */
function moodFromEmotion(emotion: string): string {
  switch (emotion) {
    case '悲伤':
    case '沉吟':
      return '悲怆';
    case '愤怒':
    case '激动':
      return '压抑';
    case '惊讶':
      return '突变';
    case '轻快':
      return '轻快';
    default:
      return '';
  }
}

/** 场景级情绪氛围（时段 + summary 关键词加权，取最显著者） */
function sceneMood(scene: { timeOfDay: string; summary: string }): string {
  const s = scene.summary ?? '';
  if (/(打|杀|斗|冲突|厮杀)/.test(s)) return '紧张';
  if (/(决裂|死|别|泪|血|哀)/.test(s)) return '悲怆';
  return TIME_MOOD[scene.timeOfDay] ?? '';
}

/** 场景级环境音（雨 / 时段兜底） */
function sceneSound(
  scene: { timeOfDay: string; summary: string; slugline: string },
  location?: Location,
): string {
  const probe = `${scene.summary} ${scene.slugline} ${location?.description ?? ''}`;
  if (/雨|滂沱|细雨|霖/.test(probe)) return '雨声淅沥';
  return TIME_SOUND[scene.timeOfDay] ?? '';
}

// ── 景别 / 运镜 规则 ──

/** 对白景别：1 人结合情绪给近景/特写；2 人双人；多人中景 */
function dialogueShotType(characterCount: number, emotion: string): ShotType {
  if (characterCount <= 1) {
    return emotion === '愤怒' || emotion === '激动' || emotion === '惊讶'
      ? 'extreme-close-up'
      : 'close-up';
  }
  if (characterCount === 2) return 'two-shot';
  return 'medium';
}

/** 对白运镜：情绪强烈时推近到说话人，否则固定机位 */
function dialogueCameraMove(emotion: string): CameraMove {
  return emotion === '愤怒' || emotion === '激动' || emotion === '惊讶'
    ? 'dolly-in'
    : 'static';
}

/** 动作景别：打斗→全景，审视/细节→近景，环境→远景，其余按长度 */
function actionShotType(part: string): ShotType {
  if (/(打|杀|攻|战|斗|斩|挥|厮杀|拳)/.test(part)) return 'full';
  if (/(看|望|定睛|审视|盯|端详|凝视)/.test(part)) return 'close-up';
  if (/(天|山|街|院|远|远眺|俯瞰|全景|旷野)/.test(part)) return 'wide';
  if (part.length < 30) return 'medium';
  if (part.length < 80) return 'full';
  return 'wide';
}

/** 动作运镜：打斗→手持，追逐→跟移，审视→推近，环视→横摇，其余固定 */
function actionCameraMove(part: string): CameraMove {
  if (/(打|杀|斗|斩|挥|厮杀|拳|拼)/.test(part)) return 'handheld';
  if (/(追|奔|跑|疾驰|赶|追赶)/.test(part)) return 'track';
  if (/(切|审视|逼近|定睛|端详|特写|聚焦)/.test(part)) return 'zoom-in';
  if (/(转|环视|扫视|环绕|拉开|环顾)/.test(part)) return 'pan';
  if (/(走|移|靠近|踱|跟随)/.test(part)) return 'track';
  if (/(看|望|凝视|注视)/.test(part)) return 'dolly-in';
  return 'static';
}

// ── 时长 ──

function estimateDialogueDuration(line: string): number {
  return Math.max(3, Math.ceil(line.length / DIALOGUE_CHARS_PER_SECOND));
}

function estimateActionDuration(description: string): number {
  return clamp(3 + Math.ceil(description.length / ACTION_SECONDS_PER_25_CHARS), 3, 15);
}

// ── 动作语义切分 ──

/**
 * 把动作描述按「语义断句」拆分为镜头节拍：
 *  - 优先在句末标点（。！？…）断句；
 *  - 过长分句按逗号继续细分（保留标点）；
 *  - 贪心合并到单镜 ≤ ACTION_MAX_CHARS_PER_SHOT；
 *  - 若单句仍超限，硬切作为兜底（不跨语义时尽量少用）。
 */
function splitActionDescription(description: string): string[] {
  const normalized = description.trim();
  if (!normalized) return [];

  const rawSentences = normalized.match(/[^。！？!?…]+[。！？!?…]?/g) ?? [];

  const units: string[] = [];
  for (const s of rawSentences) {
    const t = s.trim();
    if (!t) continue;
    if (t.length > ACTION_MAX_CHARS_PER_SHOT) {
      // 单分句超限：按逗号/顿号细分
      const clauses = t.split(/(?<=[，、；：])/);
      let acc = '';
      for (const c of clauses) {
        const cc = c.trim();
        if (!cc) continue;
        if (acc && acc.length + cc.length > ACTION_MAX_CHARS_PER_SHOT) {
          units.push(acc);
          acc = '';
        }
        acc += cc;
      }
      if (acc) units.push(acc);
    } else {
      units.push(t);
    }
  }

  // 贪心合并成 ≤ 上限的镜头块
  const groups: string[] = [];
  let cur = '';
  for (const u of units) {
    if (u.length > ACTION_MAX_CHARS_PER_SHOT) {
      // 兜底：单单位仍超限，硬切
      if (cur) {
        groups.push(cur);
        cur = '';
      }
      for (let i = 0; i < u.length; i += ACTION_MAX_CHARS_PER_SHOT) {
        groups.push(u.slice(i, i + ACTION_MAX_CHARS_PER_SHOT));
      }
      continue;
    }
    if (cur && cur.length + u.length > ACTION_MAX_CHARS_PER_SHOT) {
      groups.push(cur);
      cur = '';
    }
    cur += u;
  }
  if (cur) groups.push(cur);
  return groups;
}

/** 动作镜头字幕稿：取首句白描 */
function actionSubtitle(part: string): string {
  const first = part.split(/[。！？!?…]/)[0] || part;
  return first.trim();
}

/** 定场镜头 */
function makeEstablishingShot(
  scene: Screenplay['scenes'][number],
  location: Location | undefined,
  shotNumber: number,
): Shot {
  const shotType: ShotType =
    location?.type === 'exterior' ? 'extreme-wide' : 'wide';
  const desc = location?.description ? ` ${location.description}` : '';
  const visual = `${scene.slugline}${desc}`.trim() || scene.summary || scene.slugline;
  return {
    shotId: `shot_${shotNumber}`,
    shotNumber,
    sceneNumber: scene.sceneNumber,
    slugline: scene.slugline,
    shotType,
    cameraMove: 'static',
    durationSec: 5,
    dialogue: '',
    action: scene.summary || '',
    visual,
    mood: sceneMood(scene),
    sound: sceneSound(scene, location),
    subtitle: actionSubtitle(scene.summary || scene.slugline),
    notes: '定场镜头',
  };
}

/**
 * 把剧本转换为短剧分镜（规则增强版）。
 * @throws 若剧本无效（zod 校验失败）
 */
export function dramatize(screenplay: Screenplay, options: DramatizeOptions): Drama {
  const characterNames = new Map(
    screenplay.characters.map(c => [c.characterId, c.name] as const),
  );
  const locationById = new Map(screenplay.locations.map(l => [l.locationId, l] as const));

  let shotCounter = 0;
  const shots: Shot[] = [];

  for (const scene of screenplay.scenes) {
    const characterCount = scene.characterIds.length;
    const location = locationById.get(scene.locationId);

    // 空场景兜底：至少产出一个镜头（不再叠加定场镜头）
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

    // 定场镜头
    shotCounter += 1;
    shots.push(makeEstablishingShot(scene, location, shotCounter));

    const sceneAmbient = sceneSound(scene, location);
    const sceneAtmosphere = sceneMood(scene);

    for (const block of scene.content) {
      if (block.type === 'dialogue') {
        shotCounter += 1;
        const speaker = characterNames.get(block.characterId) ?? block.characterId;
        const emotion = emotionFromDialogue(block.line, block.direction);
        shots.push({
          shotId: `shot_${shotCounter}`,
          shotNumber: shotCounter,
          sceneNumber: scene.sceneNumber,
          slugline: scene.slugline,
          shotType: dialogueShotType(characterCount, emotion),
          cameraMove: dialogueCameraMove(emotion),
          durationSec: estimateDialogueDuration(block.line),
          dialogue: block.line,
          speaker,
          visual: block.direction?.trim()
            ? `${speaker} ${block.direction.trim()}`
            : `${speaker} 开口说话`,
          action: '',
          characterEmotion: emotion,
          mood: moodFromEmotion(emotion) || sceneAtmosphere,
          subtitle: block.line,
          ...(sceneAmbient ? { sound: sceneAmbient } : {}),
        });
      } else {
        // action 块：语义断句拆分为多个镜次
        const parts = splitActionDescription(block.description);
        for (const part of parts) {
          shotCounter += 1;
          shots.push({
            shotId: `shot_${shotCounter}`,
            shotNumber: shotCounter,
            sceneNumber: scene.sceneNumber,
            slugline: scene.slugline,
            shotType: actionShotType(part),
            cameraMove: actionCameraMove(part),
            durationSec: estimateActionDuration(part),
            dialogue: '',
            visual: part,
            action: part,
            mood: moodFromAction(part) || sceneAtmosphere,
            subtitle: actionSubtitle(part),
            ...(soundFromAction(part) ? { sound: soundFromAction(part) } : {}),
            ...(sceneAmbient && !soundFromAction(part) ? { sound: sceneAmbient } : {}),
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