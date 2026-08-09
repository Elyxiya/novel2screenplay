import { describe, it, expect } from 'vitest';
import type { LLMMessage, LLMProvider, LLMStreamChunk } from '@/lib/llm/types';
import { buildReviseScenePrompt, reviseScene, MAX_SOURCE_CHARS } from '@/lib/result/revise-scene';
import type { Scene } from '@novel/contracts/screenplay';

class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly modelId = 'mock-model';
  readonly description = 'mock';
  readonly contextWindow = 8000;
  messages: LLMMessage[] = [];
  response: string;

  constructor(response: string) {
    this.response = response;
  }

  async chat(messages: LLMMessage[]) {
    this.messages = messages;
    return { content: this.response, model: this.modelId };
  }

  async *chatStream(): AsyncGenerator<LLMStreamChunk> {
    yield { type: 'done' };
  }

  supportsJSONMode(): boolean {
    return true;
  }

  async estimateTokens(text: string): Promise<number> {
    return text.length;
  }
}

const baseScene: Scene = {
  sceneNumber: 1,
  slugline: '内景 林晚的公寓 - 夜',
  timeOfDay: 'night',
  locationId: 'loc_1',
  characterIds: ['char_1'],
  content: [{ type: 'action', description: '原动作', sourceRefs: [] }],
  summary: '原摘要',
  sourceChapterRange: [0, 0],
};

const okResponse = JSON.stringify({
  summary: '重生成摘要',
  timeOfDay: 'night',
  confidence: 0.9,
  content: [
    { type: 'action', description: '林晚推门而入', sourceRefs: [] },
    { type: 'dialogue', characterId: 'char_1', line: '你来了。', direction: '低声', sourceRefs: [] },
  ],
});

describe('buildReviseScenePrompt', () => {
  it('包含修改意见、当前场景与原文片段', () => {
    const prompt = buildReviseScenePrompt('第一章 原文', baseScene, '对白更口语化');
    expect(prompt).toContain('对白更口语化');
    expect(prompt).toContain('第一章 原文');
    expect(prompt).toContain('"slugline"');
  });

  it('原文超长时截断并提示', () => {
    const longText = '啊'.repeat(MAX_SOURCE_CHARS + 100);
    const prompt = buildReviseScenePrompt(longText, baseScene, '缩短');
    expect(prompt).toContain('原文过长已截断');
    expect(prompt.length).toBeLessThan(longText.length + 500);
  });
});

describe('reviseScene', () => {
  it('仅替换内容类字段，保留场景基础信息；指令进入 prompt', async () => {
    const provider = new MockProvider(okResponse);
    const next = await reviseScene('原文', baseScene, '对白更口语化', { provider });

    expect(next.sceneNumber).toBe(1);
    expect(next.slugline).toBe(baseScene.slugline);
    expect(next.timeOfDay).toBe('night');
    expect(next.summary).toBe('重生成摘要');
    expect(next.confidence).toBe(0.9);
    expect(next.content).toHaveLength(2);
    expect(next.content[0]).toMatchObject({ type: 'action', description: '林晚推门而入' });
    expect(next.content[1]).toMatchObject({ type: 'dialogue', characterId: 'char_1', line: '你来了。' });
    // 用户指令确实进入 LLM 调用
    expect(provider.messages[1].content).toContain('对白更口语化');
  });

  it('模型返回 speaker 时按角色名映射回 characterId', async () => {
    const response = JSON.stringify({
      content: [{ type: 'dialogue', speaker: '林晚', line: '保重。' }],
    });
    const provider = new MockProvider(response);
    const next = await reviseScene('原文', baseScene, '改结尾', {
      provider,
      nameToCharacterId: { 林晚: 'char_1', 小林: 'char_1' },
    });
    expect(next.content[0]).toMatchObject({ type: 'dialogue', characterId: 'char_1', line: '保重。' });
  });

  it('模型给出非法 timeOfDay 时保留当前值', async () => {
    const response = JSON.stringify({
      timeOfDay: 'noon',
      content: [{ type: 'action', description: '新动作', sourceRefs: [] }],
    });
    const provider = new MockProvider(response);
    const next = await reviseScene('原文', baseScene, '改时间', { provider });
    expect(next.timeOfDay).toBe('night');
  });

  it('无法解析的响应直接抛错', async () => {
    const provider = new MockProvider('这不是 JSON');
    await expect(reviseScene('原文', baseScene, '改', { provider })).rejects.toThrow('解析失败');
  });

  it('缺少有效 content 时抛错', async () => {
    const provider = new MockProvider(JSON.stringify({ content: [{ type: 'dialogue', line: '' }] }));
    await expect(reviseScene('原文', baseScene, '改', { provider })).rejects.toThrow('缺少有效场景内容');
  });
});
