import { describe, it, expect } from 'vitest';
import { SYSTEM_PROMPT } from './convert-scene';
import { ContextManager } from '../../pipeline/ContextManager';

/**
 * P0-3 验证：convert-scene Prompt 精简（Token优化与解析效率方案 D4）。
 * 优化前 SYSTEM_PROMPT 约 1.5k tokens/场景，含冗余表述与乱入字符。
 * 优化后实测（tiktoken cl100k_base）：778 tokens（约 0.78k），较基线减少 48%。
 *
 * 本测试作为回归防护：
 *  - 硬上限 1000 tokens：任何使 Prompt 回退至接近 1.5k 的改动都会触发失败；
 *  - 字符级粗估上限 1500：tiktoken 不可用时的兜底断言。
 */

const ctx = new ContextManager();

describe('P0-3: convert-scene Prompt 精简验证', () => {
  it('SYSTEM_PROMPT token 数低于 1000（回归硬上限，目标 0.7k）', async () => {
    const tokens = await ctx.countTokens(SYSTEM_PROMPT);
    expect(tokens).toBeLessThan(1000);
    // 记录实测值供文档引用
    expect(tokens).toBeLessThanOrEqual(900);
  });

  it('SYSTEM_PROMPT 字符数低于 1500（tiktoken 不可用时的兜底断言）', () => {
    expect(SYSTEM_PROMPT.length).toBeLessThan(1500);
  });

  it('不含乱入字符（韩文/异常区段）—— 方案中"一处乱入字符"已清除', () => {
    // 韩文音节区段，方案指出的乱入字符类型
    expect(/[\uAC00-\uD7AF]/.test(SYSTEM_PROMPT)).toBe(false);
    // 控制字符（除换行、制表符外）
    expect(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(SYSTEM_PROMPT)).toBe(false);
  });

  it('8 条核心规则全部保留', () => {
    const ruleLines = SYSTEM_PROMPT
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d+\.\s*【/.test(l));
    expect(ruleLines).toHaveLength(8);

    // 每条规则的关键约束词必须存在（防后续误删核心语义）
    const expectations: Array<[string, string[]]> = [
      ['1', ['动作', '禁心理活动', '可见']],
      ['2', ['围观者', '说话人']],
      ['3', ['原文', '禁编造']],
      ['4', ['sourceRefs']],
      ['5', ['confidence', '0.9']],
      ['6', ['summary']],
      ['7', ['VO', '忽略']],
      ['8', ['insufficient_context']],
    ];
    for (const [num, keywords] of expectations) {
      const line = ruleLines.find((l) => l.startsWith(`${num}.`)) ?? '';
      for (const kw of keywords) {
        expect(line, `规则 ${num} 缺少关键词: ${kw}`).toContain(kw);
      }
    }
  });

  it('JSON 输出格式契约完整（summary/timeOfDay/confidence/content/action/dialogue/characterId/sourceRefs）', () => {
    for (const field of [
      'summary',
      'timeOfDay',
      'confidence',
      'content',
      'action',
      'dialogue',
      'characterId',
      'sourceRefs',
      'excerpt',
      'direction',
    ]) {
      expect(SYSTEM_PROMPT).toContain(field);
    }
  });

  it('保留纯 JSON 输出指令与信息不足降级指令', () => {
    expect(SYSTEM_PROMPT).toContain('只输出纯 JSON');
    expect(SYSTEM_PROMPT).toContain('insufficient_context');
    expect(SYSTEM_PROMPT).toContain('不要 markdown');
  });

  it('保留防幻觉关键约束（strict 基于原文）', () => {
    expect(SYSTEM_PROMPT).toContain('严格基于原文');
    expect(SYSTEM_PROMPT).toContain('禁止归给任何具名主角');
    expect(SYSTEM_PROMPT).toContain('只转换原文实际存在的内容');
  });
});
