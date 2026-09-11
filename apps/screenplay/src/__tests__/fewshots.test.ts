import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import {
  parseFewshot, parseFewshots, hashFewshots, formatFewshotBlock,
  loadFewshots, loadFewshotsFromDir, type FewshotEntry,
} from '@/lib/pipeline/fewshots';
import { Phase3SceneConverter } from '@/lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '@/lib/pipeline/ContextManager';
import type { SceneBoundary, RawCharacter } from '@novel/contracts/pipeline';
import type { LLMProvider } from '@/lib/llm/types';

const FEWSHOT_DIR = path.resolve(process.cwd(), '..', '..', 'scripts', 'eval', 'fewshots');

describe('fewshots 样例库（B-06）', () => {
  it('仓库内置 3 组样例可解析（id 稳定排序）', () => {
    const entries = loadFewshotsFromDir(FEWSHOT_DIR);
    expect(entries).toBeDefined();
    expect(entries!.map((e) => e.id)).toEqual(['shot-01-dialogue', 'shot-02-inner', 'shot-03-scene']);
    expect(entries![0].sourceText).toContain('你终于来了');
    expect(entries![0].target).toBeTruthy();
  });

  it('缺 target/source 的样例显式抛错（样例库损坏不静默）', () => {
    expect(() => parseFewshot('id: broken\nsource:\n  text: x\n')).toThrow(/缺少 id\/source\.text\/target/);
    expect(() => parseFewshots(['id: a\nsource:\n  text: t\ntarget: {x: 1}'])).not.toThrow();
  });

  it('指纹：内容/顺序敏感；格式化块含示例且可截断', () => {
    const e1: FewshotEntry = { id: 'a', sourceText: 's1', target: { t: 1 } };
    const e2: FewshotEntry = { id: 'b', sourceText: 's2', target: { t: 2 } };
    expect(hashFewshots([e1, e2])).toBe(hashFewshots([e1, e2]));
    expect(hashFewshots([e1, e2])).not.toBe(hashFewshots([e2, e1]));
    expect(hashFewshots([e1, e2])).not.toBe(hashFewshots([{ ...e1, sourceText: 's1x' }, e2]));

    const block = formatFewshotBlock([e1]);
    expect(block).toContain('【转换示例');
    expect(block).toContain('〈原文〉s1');

    const many = Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, sourceText: '文'.repeat(200), target: { t: 1 } } as FewshotEntry));
    const truncated = formatFewshotBlock(many, 900);
    expect(truncated.length).toBeLessThanOrEqual(900);
    expect(truncated).toContain('截断');
  });

  it('开关语义：未设置 env 零变化；DIR-only 亦可启用；坏目录显式告警返回 undefined', () => {
    expect(loadFewshots({})).toBeUndefined();
    expect(loadFewshots({ PHASE3_FEWSHOTS: '0' })).toBeUndefined();
    expect(loadFewshots({ PHASE3_FEWSHOTS: '1', PHASE3_FEWSHOTS_DIR: FEWSHOT_DIR })).toHaveLength(3);
    expect(loadFewshots({ PHASE3_FEWSHOTS_DIR: FEWSHOT_DIR })).toHaveLength(3);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(loadFewshots({ PHASE3_FEWSHOTS_DIR: path.join(FEWSHOT_DIR, 'not-exist') })).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('样例目录不存在'));
    warn.mockRestore();
  });
});

describe('Phase3 注入集成（B-06）', () => {
  const provider: LLMProvider = {
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
  const jobStoreMock = () => ({ update: vi.fn(), get: vi.fn(() => ({ id: 'j', logs: [], scenesStatus: [] })) }) as unknown as Parameters<Phase3SceneConverter['convertScenes']>[4];

  it('传入 fewshots → 上下文含示例块；不传则无', async () => {
    const conv = new Phase3SceneConverter(provider, new ContextManager());
    const entries = loadFewshotsFromDir(FEWSHOT_DIR)!;

    await conv.convertScenes([scene], characters, [], ['原文'], jobStoreMock(), 'j', undefined, { fewshots: entries });
    const withFs = String(vi.mocked(provider.chat).mock.calls[0][0][1].content);
    expect(withFs).toContain('【转换示例');
    expect(withFs).toContain('三年前那把火');

    vi.mocked(provider.chat).mockClear();
    await conv.convertScenes([scene], characters, [], ['原文'], jobStoreMock(), 'j');
    const without = String(vi.mocked(provider.chat).mock.calls[0][0][1].content);
    expect(without).not.toContain('【转换示例');
  });
});
