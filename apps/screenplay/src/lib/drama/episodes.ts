/**
 * 分集规划（FIX-12 / B-13）：按集时长预算把场景序列切分成集 + 集末钩子检测。
 *
 * 规则全确定性（零 LLM）：
 * - 场景时长 = Σ（对白/独白：estimateDialogueDuration；动作：estimateActionDuration）；
 * - 贪心累积直到 ≥ episodeTargetMinutes×60 收束一集；
 * - hookPolicy='cliffhanger' 时做一次微调：若收束点当前场景无钩子、而下一场景本身是 hooks
 *   且加上它后不超预算 ×1.2，则并入下一场景使集末落在钩子上；
 * - 单一场景长于预算时独立成集（不拆场景——场景是质量/重转单元）。
 */
import type { Screenplay } from '@novel/contracts/screenplay';
import type { StyleProfile } from '@novel/contracts/pipeline';
import { estimateDialogueDuration, estimateActionDuration } from './dramatize';

/** 集末钩子判定词（悬念/转折信号） */
const HOOK_WORDS = /(竟然|居然|难道|不料|突然|真相|秘密|没想到|怎么会|为什么)/;

export interface SceneDurationInfo {
  sceneNumber: number;
  durationSec: number;
  hookAtEnd: boolean;
  hookReasons: string[];
}

/** 场景时长（秒）：按块类型估算；空场景按最小 3 秒计。 */
export function estimateSceneDuration(scene: Screenplay['scenes'][number]): number {
  let total = 0;
  for (const block of scene.content ?? []) {
    if (block.type === 'action') total += estimateActionDuration(block.description ?? '');
    else total += estimateDialogueDuration(block.line ?? ''); // dialogue / monologue 同语速口径
  }
  return total > 0 ? total : 3;
}

/** 集末钩子：最后一个对白/独白行的悬念信号（句尾问号或 HOOK_WORDS） */
export function detectSceneHook(scene: Screenplay['scenes'][number]): { hook: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const spoken = ((scene.content ?? []) as unknown as DubbingBlock[]).filter(
    (b) => b.type === 'dialogue' || b.type === 'monologue',
  );
  const last = spoken.at(-1);
  if (!last?.line) return { hook: false, reasons };
  const line = last.line.trim();
  if (/[？?]$/.test(line)) reasons.push('句尾疑问');
  if (HOOK_WORDS.test(line)) reasons.push(`悬念词: ${(line.match(HOOK_WORDS) ?? [''])[0]}`);
  return { hook: reasons.length > 0, reasons };
}

export interface Episode {
  episodeNumber: number;
  sceneNumbers: number[];
  durationSec: number;
  hookAtEnd: boolean;
  hookReasons: string[];
}

export interface EpisodePlan {
  episodes: Episode[];
  sceneInfos: SceneDurationInfo[];
  stats: {
    episodeCount: number;
    totalDurationSec: number;
    avgEpisodeSec: number;
    targetEpisodeSec: number;
    hookEndings: number;
  };
}

export function planEpisodes(
  screenplay: Pick<Screenplay, 'scenes'>,
  rhythmUnit: StyleProfile['rhythmUnit'],
): EpisodePlan {
  const targetSec = Math.max(30, rhythmUnit.episodeTargetMinutes * 60);
  const sceneInfos: SceneDurationInfo[] = (screenplay.scenes ?? []).map((s) => {
    const { hook, reasons } = detectSceneHook(s);
    return { sceneNumber: s.sceneNumber, durationSec: estimateSceneDuration(s), hookAtEnd: hook, hookReasons: reasons };
  });

  const episodes: Episode[] = [];
  let current: Episode = { episodeNumber: 1, sceneNumbers: [], durationSec: 0, hookAtEnd: false, hookReasons: [] };
  const closeEpisode = () => {
    if (current.sceneNumbers.length === 0) return;
    const lastInfo = sceneInfos.find((i) => i.sceneNumber === current.sceneNumbers.at(-1));
    current.hookAtEnd = lastInfo?.hookAtEnd ?? false;
    current.hookReasons = lastInfo?.hookReasons ?? [];
    episodes.push(current);
    current = { episodeNumber: episodes.length + 1, sceneNumbers: [], durationSec: 0, hookAtEnd: false, hookReasons: [] };
  };

  for (let i = 0; i < sceneInfos.length; i++) {
    const info = sceneInfos[i];
    current.sceneNumbers.push(info.sceneNumber);
    current.durationSec += info.durationSec;

    if (current.durationSec >= targetSec) {
      if (rhythmUnit.hookPolicy === 'cliffhanger' && !info.hookAtEnd) {
        const next = sceneInfos[i + 1];
        // 微调：并入下一场景以落在钩子上（预算放宽 20%，且下一场景本身带钩子）
        if (next && next.hookAtEnd && current.durationSec + next.durationSec <= targetSec * 1.2) {
          current.sceneNumbers.push(next.sceneNumber);
          current.durationSec += next.durationSec;
          i += 1;
        }
      }
      closeEpisode();
    }
  }
  closeEpisode();

  const totalDurationSec = sceneInfos.reduce((s, i) => s + i.durationSec, 0);
  return {
    episodes,
    sceneInfos,
    stats: {
      episodeCount: episodes.length,
      totalDurationSec,
      avgEpisodeSec: episodes.length > 0 ? Math.round(totalDurationSec / episodes.length) : 0,
      targetEpisodeSec: targetSec,
      hookEndings: episodes.filter((e) => e.hookAtEnd).length,
    },
  };
}

/**
 * 配音脚本序列化（artifactForm='dubbing-script'）：
 * 每集：集头（时长/钩子）→ 场景 → 块行（对白【角色】（direction）台词 / 独白【NV】/ 动作（音效·环境）描述）。
 */
/** 配音脚本块（宽松类型：monologue 属分阶段迁移中的独立 schema，见 contracts B-22 注） */
interface DubbingBlock {
  type: string;
  line?: string;
  description?: string;
  direction?: string;
  characterId?: string;
  speaker?: string;
}

export function serializeDubbingScript(
  screenplay: Pick<Screenplay, 'scenes' | 'characters'>,
  episodes: Episode[],
): string {
  const nameById = new Map((screenplay.characters ?? []).map((c) => [c.characterId, c.name]));
  const lines: string[] = ['# 配音脚本（dubbing-script）', ''];
  for (const ep of episodes) {
    const mm = Math.floor(ep.durationSec / 60);
    const ss = ep.durationSec % 60;
    lines.push(`## 第 ${ep.episodeNumber} 集（约 ${mm} 分 ${ss} 秒；集末钩子：${ep.hookAtEnd ? `有（${ep.hookReasons.join('、')}）` : '无'}）`);
    lines.push('');
    for (const sn of ep.sceneNumbers) {
      const scene = (screenplay.scenes ?? []).find((s) => s.sceneNumber === sn);
      if (!scene) continue;
      lines.push(`### 场 ${scene.sceneNumber} · ${scene.slugline}`);
      for (const block of (scene.content ?? []) as unknown as DubbingBlock[]) {
        if (block.type === 'dialogue') {
          const who = nameById.get(block.characterId ?? '') ?? block.characterId ?? '';
          lines.push(`【${who}】${block.direction ? `（${block.direction}）` : ''}${block.line ?? ''}`);
        } else if (block.type === 'monologue') {
          lines.push(`【${block.speaker ?? 'NV'}·旁白】${block.direction ? `（${block.direction}）` : ''}${block.line ?? ''}`);
        } else {
          lines.push(`（音效·环境）${block.description ?? ''}`);
        }
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}
