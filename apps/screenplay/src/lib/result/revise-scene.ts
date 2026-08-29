/**
 * 结果页局部追问（L2）：按用户自然语言指令重生成单个场景。
 * 仅替换场景的 content（及可选 summary/timeOfDay/confidence），其余字段与其它场景不动。
 */
import type { LLMProvider } from '@/lib/llm/types';
import { resolveDefaultProvider } from '@/lib/llm/llm-gateway';
import { SYSTEM_PROMPT } from '@/lib/llm/prompts/convert-scene';
import { safeJsonParse } from '@/lib/utils/safe-json';
import type { ActionBlock, DialogueBlock, Scene } from '@novel/contracts/screenplay';

/** 单个场景原文片段上限（超长截断，避免超 token） */
export const MAX_SOURCE_CHARS = 6000;

const TIME_OF_DAY_VALUES = ['dawn', 'morning', 'afternoon', 'dusk', 'night', 'late-night', 'unknown'] as const;

export interface ReviseSceneOptions {
  provider?: LLMProvider;
  temperature?: number;
  /** 归属用户：provider 缺省时经用户级网关解析其自定义 LLM，回退全局 env */
  userId?: string;
  /** 角色名（含别名）→ characterId，用于归一化模型可能返回的 speaker 字段 */
  nameToCharacterId?: Record<string, string>;
}

export function buildReviseScenePrompt(sourceText: string, currentScene: Scene, instruction: string): string {
  const fragment =
    sourceText.length > MAX_SOURCE_CHARS
      ? `${sourceText.slice(0, MAX_SOURCE_CHARS)}\n\n（原文过长已截断）`
      : sourceText;
  return [
    '根据以下【用户修改意见】，重新生成这一个场景的剧本内容。',
    '',
    '【用户修改意见】',
    instruction,
    '',
    '【小说原文片段】',
    fragment,
    '',
    '【当前场景（参考其结构，按意见调整）】',
    JSON.stringify(currentScene, null, 2),
    '',
    '要求：保持场景编号、时间、地点不变；只输出符合系统提示格式的剧本 JSON（含 summary/timeOfDay/confidence/content）；content 内对白使用角色 id（characterId），不要用角色名；如意见与原文冲突以用户意见为准；只输出纯 JSON。',
  ].join('\n');
}

/** 归一化模型输出的场景：保留当前场景基础字段，只替换 content/summary/timeOfDay/confidence */
function normalizeScene(current: Scene, parsed: unknown, nameToCharacterId?: Record<string, string>): Scene {
  const obj = (parsed ?? {}) as Record<string, unknown>;
  const rawContent = Array.isArray(obj.content) ? (obj.content as unknown[]) : [];

  const resolveCharacterId = (block: Record<string, unknown>): string | undefined => {
    const direct = typeof block.characterId === 'string' && block.characterId ? block.characterId : undefined;
    if (direct) return direct;
    const speaker =
      typeof block.speaker === 'string'
        ? block.speaker
        : typeof block.character === 'string'
          ? block.character
          : undefined;
    if (!speaker) return undefined;
    if (nameToCharacterId) {
      const exact = nameToCharacterId[speaker];
      if (exact) return exact;
      const fuzzy = Object.entries(nameToCharacterId).find(([name]) => name.includes(speaker) || speaker.includes(name));
      if (fuzzy) return fuzzy[1];
    }
    return speaker;
  };

  const content = rawContent
    .map((b): ActionBlock | DialogueBlock | null => {
      const block = (b ?? {}) as Record<string, unknown>;
      if (block.type === 'dialogue') {
        const characterId = resolveCharacterId(block);
        const line = typeof block.line === 'string' ? block.line : '';
        if (!characterId || !line.trim()) return null;
        return {
          type: 'dialogue',
          characterId,
          line,
          direction: typeof block.direction === 'string' && block.direction ? block.direction : undefined,
          sourceRefs: Array.isArray(block.sourceRefs) ? (block.sourceRefs as DialogueBlock['sourceRefs']) : [],
        };
      }
      if (block.type === 'action') {
        const description = typeof block.description === 'string' ? block.description : '';
        if (!description.trim()) return null;
        return {
          type: 'action',
          description,
          sourceRefs: Array.isArray(block.sourceRefs) ? (block.sourceRefs as ActionBlock['sourceRefs']) : [],
        };
      }
      return null;
    })
    .filter((b): b is ActionBlock | DialogueBlock => b !== null);

  if (content.length === 0) throw new Error('重生成结果缺少有效场景内容');

  return {
    ...current,
    content,
    summary: typeof obj.summary === 'string' ? obj.summary : current.summary,
    timeOfDay: TIME_OF_DAY_VALUES.includes(obj.timeOfDay as (typeof TIME_OF_DAY_VALUES)[number])
      ? (obj.timeOfDay as Scene['timeOfDay'])
      : current.timeOfDay,
    confidence: typeof obj.confidence === 'number' ? obj.confidence : current.confidence,
  };
}

export async function reviseScene(
  sourceText: string,
  currentScene: Scene,
  instruction: string,
  options: ReviseSceneOptions = {},
): Promise<Scene> {
  for await (const out of reviseSceneStream(sourceText, currentScene, instruction, options)) {
    if ('full' in out) return out.full;
  }
  throw new Error('场景重生成失败：未获得最终结果');
}

/** reviseSceneStream 产出的事件：生成中逐段 delta，末尾产出归一化后的完整场景 */
export type ReviseSceneStreamOut = { delta: string } | { full: Scene };

export async function *reviseSceneStream(
  sourceText: string,
  currentScene: Scene,
  instruction: string,
  options: ReviseSceneOptions = {},
): AsyncGenerator<ReviseSceneStreamOut> {
  const provider = options.provider ?? resolveDefaultProvider(options.userId);
  if (!provider) throw new Error('未配置 LLM Provider，无法重生成场景');
  let full = '';
  for await (const ch of provider.chatStream(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildReviseScenePrompt(sourceText, currentScene, instruction) },
    ],
    { temperature: options.temperature ?? 0.7 },
  )) {
    if (ch.type === 'text' && ch.content) {
      full += ch.content;
      yield { delta: ch.content };
    }
  }
  const parsed = safeJsonParse(full);
  if (
    parsed == null ||
    (typeof parsed === 'object' && !Array.isArray(parsed) && (parsed as Record<string, unknown>)._parseError === true)
  ) {
    throw new Error('场景重生成结果解析失败');
  }
  yield { full: normalizeScene(currentScene, parsed, options.nameToCharacterId) };
}
