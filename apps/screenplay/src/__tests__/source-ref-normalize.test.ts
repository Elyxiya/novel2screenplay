// @vitest-environment node
/**
 * sourceRefs 章号归一回归
 *
 * 实测背景：把原书第 65 章切片交给管线，模型在 sourceRefs 里写 `chapterIndex: 65`，
 * 而管线内部章号是 0-based 序号。原样保留会让溯源整体失效（结果页跳错章、
 * 评测里「excerpt 是否在原文出现」几乎恒为假）。场景必然属于单章，章号以场景为准。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Phase3SceneConverter } from '../lib/pipeline/Phase3SceneConverter';
import { ContextManager } from '../lib/pipeline/ContextManager';
import { jobStore } from '../lib/store/job-store';
import { getDatabase } from '../lib/store/sqlite/db';
import type { LLMProvider } from '../lib/llm/types';

class RefProvider {
  readonly name = 'sourceref-probe';
  readonly modelId = 'sourceref-probe-model';
  readonly description = 'probe';
  readonly contextWindow = 128000;
  readonly supportedModels = ['sourceref-probe-model'];
  supportsJSONMode() { return true; }
  async estimateTokens(t: string) { return Math.ceil(t.length * 1.3); }
  async chat() {
    return {
      content: JSON.stringify({
        content: [
          {
            type: 'action',
            description: '甲推门而入。',
            sourceRefs: [{ chapterIndex: 65, paragraphIndex: 0, excerpt: '甲推门而入' }],
          },
          {
            type: 'dialogue',
            characterId: '甲',
            line: '你来了。',
            sourceRefs: [{ chapterIndex: 99, paragraphIndex: 1, excerpt: '你来了' }],
          },
        ],
        summary: 's',
        confidence: 0.9,
        timeOfDay: 'night',
      }),
      model: 'sourceref-probe-model',
      usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
    };
  }
  async *chatStream() { /* 探针不需要流式 */ }
}

beforeAll(() => {
  getDatabase();
});

describe('Phase3 sourceRefs 章号归一', () => {
  it('模型返回的绝对章号被改写成场景所属章号', async () => {
    const jobId = jobStore.create({
      novelText: '第二章 转折\n\n甲推门而入。',
      chapterTexts: ['第一章 开端\n\n甲推门而入。', '第二章 转折\n\n甲推门而入。'],
      modelId: 'sourceref-probe-model',
      selectedChapters: [0, 1],
      temperature: 0.7,
    });

    const converter = new Phase3SceneConverter(
      new RefProvider() as unknown as LLMProvider,
      new ContextManager(),
    );

    const [out] = await converter.convertScenes(
      [
        {
          sceneIndex: 1,
          chapterIndex: 1, // 场景属于第二章（内部序号 1）
          startParagraph: 0,
          endParagraph: 0,
          originalStartOffset: 0,
          originalEndOffset: 6,
          draftSlugline: '屋 - 夜',
          keyCharacterNames: ['甲'],
          summary: '甲进屋',
        },
      ],
      [{ name: '甲', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 1 }],
      [{ name: '屋', type: 'interior', description: '', sourceChapterIndex: 1 }],
      ['第一章 开端\n\n甲推门而入。', '第二章 转折\n\n甲推门而入。'],
      jobStore,
      jobId,
    );

    expect(out.content).toHaveLength(2);
    for (const block of out.content) {
      for (const ref of block.sourceRefs) {
        expect(ref.chapterIndex).toBe(1);
      }
    }
    // excerpt 不被改动
    expect(out.content[0].sourceRefs[0].excerpt).toBe('甲推门而入');

    jobStore.delete(jobId);
  });

  it('缺失/非法 sourceRefs 归一为空数组，不产生 NaN 章号', async () => {
    const jobId = jobStore.create({
      novelText: '甲',
      chapterTexts: ['甲'],
      modelId: 'm',
      selectedChapters: [0],
      temperature: 0.7,
    });

    class BadRefProvider extends RefProvider {
      async chat() {
        return {
          content: JSON.stringify({
            content: [{ type: 'action', description: 'x', sourceRefs: [{ excerpt: '甲' }] }],
            summary: 's',
            confidence: 0.8,
            timeOfDay: 'night',
          }),
          model: 'm',
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      }
    }

    const converter = new Phase3SceneConverter(
      new BadRefProvider() as unknown as LLMProvider,
      new ContextManager(),
    );
    const [out] = await converter.convertScenes(
      [{ sceneIndex: 1, chapterIndex: 0, startParagraph: 0, endParagraph: 0, originalStartOffset: 0, originalEndOffset: 1, draftSlugline: 'x', keyCharacterNames: [], summary: '' }],
      [],
      [],
      ['甲'],
      jobStore,
      jobId,
    );

    expect(out.content[0].sourceRefs[0]).toEqual({ chapterIndex: 0, paragraphIndex: 0, excerpt: '甲' });
    jobStore.delete(jobId);
  });
});
