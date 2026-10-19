/**
 * P0 硬化回归测试
 *
 * 覆盖本轮修复的四个地基问题：
 *  1. 行尾归一：CRLF 文本的章节/场景偏移不得漂移（否则原文对照与 sourceRefs 全错）
 *  2. 取消生效：取消后执行链必须停止，状态保持 cancelled，不得被改回 completed
 *  3. 轻量读取：job update 不加载整本正文，且不影响正文完整性
 *  4. 取消是终态：cancelJob 对已完成任务不生效
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { cleanNovelText, normalizeLineEndings } from '../lib/preprocess/clean';
import { parseNovel } from '../lib/novel/parser';
import { Phase2Segmenter } from '../lib/pipeline/Phase2Segmenter';
import { PipelineEngine } from '../lib/pipeline/PipelineEngine';
import { jobStore } from '../lib/store/job-store';
import { getDatabase } from '../lib/store/sqlite/db';
import { llmRegistry } from '../lib/llm/registry';
import type { LLMProvider } from '../lib/llm/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeAll(() => {
  getDatabase();
});

describe('P0-1 行尾归一', () => {
  it('normalizeLineEndings 把 CRLF / 孤立 CR 一律转成 LF', () => {
    expect(normalizeLineEndings('a\r\nb')).toBe('a\nb');
    expect(normalizeLineEndings('a\rb')).toBe('a\nb');
    expect(normalizeLineEndings('a\nb')).toBe('a\nb');
  });

  it('cleanNovelText 输出的文本不含 \\r', () => {
    const cleaned = cleanNovelText('第一章\r\n\r\n甲推门而入。\r\n\r\n乙抬头。');
    expect(cleaned.text).not.toContain('\r');
  });

  it('parseNovel 对 CRLF 文本产出的章节文本已归一', () => {
    const result = parseNovel('第一章 开端\r\n\r\n甲推门而入。\r\n\r\n乙抬头。');
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0].text).not.toContain('\r');
  });

  it('Phase2 段落偏移在 CRLF 文本上与文本长度对齐（不再逐段漂移）', () => {
    const seg = new Phase2Segmenter(undefined as never, undefined as never);
    const calc = (text: string): number[] =>
      (seg as unknown as { calculateCharOffsets(t: string): number[] }).calculateCharOffsets(text);

    const lf = 'a\n\nb\n\nc';
    const crlf = 'a\r\n\r\nb\r\n\r\nc';

    expect(calc(lf)[calc(lf).length - 1]).toBe(lf.length);
    // 修复前：按「分隔符恒为 2 字符」累加，CRLF 下末尾偏移会比文本长度短 2
    expect(calc(crlf)[calc(crlf).length - 1]).toBe(crlf.length);
  });
});

describe('P0-2 取消真正生效', () => {
  class SlowProvider {
    readonly name = 'p0-probe-provider';
    readonly modelId = 'p0-probe-model';
    readonly description = 'probe';
    readonly contextWindow = 128000;
    readonly supportedModels = ['p0-probe-model'];
    calls = 0;
    supportsJSONMode() { return true; }
    async estimateTokens(t: string) { return Math.ceil(t.length * 1.3); }
    async chat() {
      this.calls += 1;
      await sleep(300);
      return {
        content: JSON.stringify({
          characters: [{ name: '甲', aliases: [], personalityTags: [], description: '', isMajor: true, sourceChapterIndex: 0 }],
          locations: [{ name: '屋', type: 'interior', description: '', sourceChapterIndex: 0 }],
          timelineHints: [],
          scenes: [{ startParagraph: 0, endParagraph: 1, draftSlugline: '屋 - 夜', keyCharacterNames: ['甲'], summary: '甲进屋' }],
          content: [{ type: 'action', description: '甲推门而入。', sourceRefs: [] }],
          summary: '甲进屋',
          confidence: 0.9,
          timeOfDay: 'night',
        }),
        model: 'p0-probe-model',
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
      };
    }
    async *chatStream() { /* 探针不需要流式 */ }
  }

  it('取消后不再发起新的 LLM 调用，且状态不会被改回 completed', async () => {
    const provider = new SlowProvider();
    llmRegistry.register(provider as unknown as LLMProvider);

    const engine = new PipelineEngine();
    const jobId = await engine.startJob({
      novelText: '第一章 开端\n\n甲推门而入。\n\n乙抬头看他。',
      title: 'p0-cancel',
      modelId: 'p0-probe-model',
    });

    await sleep(100);
    engine.cancelJob(jobId);

    const statusAtCancel = jobStore.get(jobId)!.status;
    const callsAtCancel = provider.calls;
    expect(statusAtCancel).toBe('cancelled');

    // 等到足够长：旧实现会在此窗口内把状态改回 completed 并继续调用
    await sleep(1500);

    const after = jobStore.get(jobId)!;
    expect(after.status).toBe('cancelled');
    expect(after.progress).not.toBe(100);
    // 允许取消瞬间已在飞行中的那一次调用落地，但不允许再发起新的
    expect(provider.calls - callsAtCancel).toBeLessThanOrEqual(1);

    jobStore.delete(jobId);
  }, 15000);

  it('cancelJob 对已完成任务不生效（不把终态覆盖成 cancelled）', () => {
    const jobId = jobStore.create({
      novelText: 'x',
      chapterTexts: ['x'],
      modelId: 'm',
      selectedChapters: [0],
      temperature: 0.7,
    });
    jobStore.update(jobId, (j) => ({ ...j, status: 'completed' as const }));

    new PipelineEngine().cancelJob(jobId);

    expect(jobStore.get(jobId)!.status).toBe('completed');
    jobStore.delete(jobId);
  });
});

describe('P0-3 update 轻量读取', () => {
  it('getForUpdate 不加载正文，且 update 后整行正文仍然完整', () => {
    const novelText = '第一章 开端\n\n正文内容。';
    const jobId = jobStore.create({
      novelText,
      chapterTexts: ['第一章 开端\n\n正文内容。'],
      modelId: 'm',
      selectedChapters: [0],
      temperature: 0.7,
    });

    const lite = jobStore.getForUpdate(jobId)!;
    expect(lite.id).toBe(jobId);
    expect(lite.novelText).toBe('');
    expect(lite.chapterTexts).toEqual([]);
    // 状态类字段仍在（updater 依赖它们做差异比较）
    expect(lite.status).toBe('pending');
    expect(lite.config.modelId).toBe('m');

    jobStore.update(jobId, (j) => ({ ...j, progress: 42 }));

    const full = jobStore.get(jobId)!;
    expect(full.progress).toBe(42);
    expect(full.novelText).toBe(novelText);
    expect(full.chapterTexts).toEqual(['第一章 开端\n\n正文内容。']);

    jobStore.delete(jobId);
  });
});
