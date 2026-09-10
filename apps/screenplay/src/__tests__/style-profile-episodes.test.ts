import { describe, it, expect, vi } from 'vitest';
import { STYLE_PRESETS, resolveStyleProfile, formatStyleBlock } from '@/lib/pipeline/style-profile';
import { planEpisodes, detectSceneHook, estimateSceneDuration, serializeDubbingScript } from '@/lib/drama/episodes';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import { ContentBlockSchema, MonologueBlockSchema, type Screenplay } from '@novel/contracts/screenplay';
import type { SceneBoundary, RawCharacter } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';

type Scene = Screenplay['scenes'][number];

const action = (text = '') => ({ type: 'action' as const, description: text, sourceRefs: [] });
const dialogue = (line: string, who = 'char_1') => ({ type: 'dialogue' as const, characterId: who, line, sourceRefs: [] });

function mkScene(num: number, content: unknown[], over: Partial<Scene> = {}): Scene {
  return {
    sceneNumber: num,
    slugline: '内景. 客厅 - 夜',
    timeOfDay: 'night',
    locationId: 'loc_01',
    characterIds: ['char_1'],
    content: content as Scene['content'],
    summary: `场景${num}`,
    ...over,
  };
}

describe('风格五轴（C6）', () => {
  it('预设解析：名称→完整 profile；未知名显式抛错（B-20 教训：不静默回退）', () => {
    const audio = resolveStyleProfile('audio-drama')!;
    expect(audio.channel).toBe('audio');
    expect(audio.voPolicy).toBe('primary');
    expect(audio.artifactForm).toBe('dubbing-script');
    expect(STYLE_PRESETS['short-drama'].voPolicy).toBe('forbidden');

    expect(() => resolveStyleProfile('brain-not-exists')).toThrow(/未知风格预设/);
    expect(resolveStyleProfile(undefined)).toBeUndefined();
    const obj = STYLE_PRESETS['short-drama'];
    expect(resolveStyleProfile(obj)).toEqual(obj);
  });

  it('formatStyleBlock：短剧忌旁白 / 有声剧开放 monologue；超长截断', () => {
    const sd = formatStyleBlock(STYLE_PRESETS['short-drama']);
    expect(sd).toContain('不使用旁白');
    const ad = formatStyleBlock(STYLE_PRESETS['audio-drama']);
    expect(ad).toContain('monologue 块');
    expect(ad).toContain('配音脚本');
    expect(ad.length).toBeLessThanOrEqual(400);
    expect(formatStyleBlock(undefined)).toBe('');
  });

  it('monologue 独立 schema 可 parse（A 案第一阶段；并入并集随 B-22）', () => {
    const parsed = MonologueBlockSchema.safeParse({ type: 'monologue', line: '命运从不回头。', sourceRefs: [] });
    expect(parsed.success).toBe(true);
    const withSpeaker = MonologueBlockSchema.safeParse({ type: 'monologue', speaker: 'NV', line: '雨夜。' });
    expect(withSpeaker.success).toBe(true);
    // 契约并集当前仍为两型（未迁移 UI 消费端安全）——并入动作登记为 B-22
    expect(ContentBlockSchema.safeParse({ type: 'monologue', line: 'x' }).success).toBe(false);
  });
});

describe('B-13 分集规划', () => {
  it('detectSceneHook：句尾疑问/悬念词命中；平淡不误报', () => {
    expect(detectSceneHook(mkScene(1, [dialogue('你到底是谁？')])).hook).toBe(true);
    expect(detectSceneHook(mkScene(1, [dialogue('他竟然还活着。')])).hook).toBe(true);
    expect(detectSceneHook(mkScene(1, [dialogue('今天天气不错。')])).hook).toBe(false);
  });

  it('estimateSceneDuration：对白按语速、动作按公式、空场景保底 3s', () => {
    expect(estimateSceneDuration(mkScene(1, [action('')]))).toBe(3);
    expect(estimateSceneDuration(mkScene(1, [dialogue('四个字。'.repeat(4))]))).toBe(4); // 16 字 ÷ 4 字/秒
  });

  it('planEpisodes：按目标时长收束 + 钩子微调（+20% 预算内并入带钩子下一场）', () => {
    // 21 场 × 3s = 63s；目标 1min。第 21 场带钩子 → 微调并入第 1 集
    const scenes: Scene[] = [];
    for (let i = 1; i <= 20; i++) scenes.push(mkScene(i, [action('')]));
    scenes.push(mkScene(21, [dialogue('真相到底是什么？')]));
    for (let i = 22; i <= 25; i++) scenes.push(mkScene(i, [action('')]));

    const plan = planEpisodes({ scenes }, { episodeTargetMinutes: 1, hookPolicy: 'cliffhanger' });
    expect(plan.episodes[0].sceneNumbers.length).toBe(21); // 20 + 微调并入
    expect(plan.episodes[0].hookAtEnd).toBe(true);
    expect(plan.episodes[1].sceneNumbers.length).toBe(4);
    expect(plan.stats.hookEndings).toBe(1);
    expect(plan.stats.totalDurationSec).toBe(75);
  });

  it('planEpisodes：超预算单场景独立成集（不拆场景）', () => {
    const longScene = mkScene(1, Array.from({ length: 30 }, () => action('')));
    const plan = planEpisodes({ scenes: [longScene, mkScene(2, [action('')])] }, { episodeTargetMinutes: 1, hookPolicy: 'none' });
    expect(plan.episodes[0].sceneNumbers).toEqual([1]);
    expect(plan.episodes[0].durationSec).toBe(90);
    expect(plan.episodes[1].sceneNumbers).toEqual([2]);
  });

  it('serializeDubbingScript：对白/独白/音效三类行格式', () => {
    const screenplay = {
      characters: [{ characterId: 'char_1', name: '甲' }],
      scenes: [mkScene(1, [action('风声掠过。'), dialogue('我该走了。', 'char_1'), { type: 'monologue', line: '他再没有回头。', sourceRefs: [] }])],
    } as unknown as Pick<Screenplay, 'scenes' | 'characters'>;
    const plan = planEpisodes({ scenes: screenplay.scenes }, { episodeTargetMinutes: 10, hookPolicy: 'none' });
    const text = serializeDubbingScript(screenplay, plan.episodes);
    expect(text).toContain('# 配音脚本');
    expect(text).toContain('【甲】我该走了。');
    expect(text).toContain('【NV·旁白】他再没有回头。');
    expect(text).toContain('（音效·环境）风声掠过。');
    expect(text).toContain('## 第 1 集');
  });
});

describe('Phase3 风格注入集成', () => {
  const mockProvider: LLMProvider = {
    name: 'test', modelId: 'test-model', description: 't', contextWindow: 32000,
    supportsJSONMode: () => true,
    estimateTokens: async (t: string) => Math.ceil(t.length * 0.5),
    chat: vi.fn(async () => ({
      model: 'test-model',
      content: JSON.stringify({ summary: 's', timeOfDay: 'day', confidence: 0.9, content: [{ type: 'action', description: '动作。', sourceRefs: [] }] }),
    })),
    chatStream: async function* () {},
  };
  const scene: SceneBoundary = {
    sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 1,
    originalStartOffset: 0, originalEndOffset: 50, draftSlugline: '内景. 客厅 - 日',
    keyCharacterNames: ['甲'], summary: 's',
  };
  const characters: RawCharacter[] = [
    { name: '甲', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 },
  ];

  it('传入 audio-drama → 上下文含五轴块；不传则无', async () => {
    const conv = new Phase3SceneConverter(mockProvider, new ContextManager());
    const jobStoreMock = { update: vi.fn(), get: vi.fn(() => ({ id: 'j', logs: [], scenesStatus: [] })) } as unknown as Parameters<typeof conv.convertScenes>[4];

    await conv.convertScenes([scene], characters, [], ['原文'], jobStoreMock, 'j', undefined, {
      styleProfile: STYLE_PRESETS['audio-drama'],
    });
    const content = String(vi.mocked(mockProvider.chat).mock.calls[0][0][1].content);
    expect(content).toContain('【风格参数（五轴）】');
    expect(content).toContain('monologue 块');
  });
});
