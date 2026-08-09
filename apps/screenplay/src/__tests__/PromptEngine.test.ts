import { describe, it, expect } from 'vitest';
import {
  buildSystemPrompt,
  buildToolFallbackHint,
  extractToolCallsFromContent,
} from '@/lib/agent/llm/PromptEngine';
import type { AgentTool } from '@/lib/agent/tool-types';

const makeTool = (overrides: Partial<AgentTool> = {}): AgentTool => ({
  name: 'get_weather',
  description: 'Get weather for a city',
  inputSchema: {
    city: { type: 'string', description: 'City name', required: true },
    unit: { type: 'string', enum: ['celsius', 'fahrenheit'] },
  },
  ...overrides,
});

describe('PromptEngine', () => {
  describe('buildSystemPrompt', () => {
    it('includes role and domain', () => {
      const prompt = buildSystemPrompt({
        role: 'Code Reviewer',
        domain: 'Software Development',
      }, []);

      expect(prompt).toContain('【角色】Code Reviewer');
      expect(prompt).toContain('【任务领域】Software Development');
    });

    it('includes operating principles', () => {
      const prompt = buildSystemPrompt({
        role: 'Tester',
        domain: 'QA',
        principles: [
          'Write unit tests for all public methods',
          'Achieve 80% coverage',
        ],
      }, []);

      expect(prompt).toContain('【操作原则】');
      expect(prompt).toContain('Write unit tests for all public methods');
      expect(prompt).toContain('Achieve 80% coverage');
    });

    it('lists all available tools with their parameters', () => {
      const tool = makeTool();
      const prompt = buildSystemPrompt({
        role: 'Assistant',
        domain: 'General',
      }, [tool]);

      expect(prompt).toContain('【可用工具】共 1 个');
      expect(prompt).toContain('## get_weather');
      expect(prompt).toContain('Get weather for a city');
      expect(prompt).toContain('city (string)');
      expect(prompt).toContain('unit (string)');
    });

    it('shows correct required parameters', () => {
      const tool = makeTool();
      const prompt = buildSystemPrompt({ role: 'A', domain: 'B' }, [tool]);

      expect(prompt).toContain('必填: city');
    });

    it('omits tool section when no tools provided', () => {
      const prompt = buildSystemPrompt({ role: 'A', domain: 'B' }, []);
      expect(prompt).not.toContain('【可用工具】');
    });

    it('includes tool calling protocol instructions', () => {
      const prompt = buildSystemPrompt({ role: 'A', domain: 'B' }, [makeTool()]);

      expect(prompt).toContain('【工具调用规则】');
      expect(prompt).toContain('{"tool_calls":');
    });

    it('includes output format instructions', () => {
      const prompt = buildSystemPrompt({ role: 'A', domain: 'B' }, []);
      expect(prompt).toContain('【输出格式】');
    });
  });

  describe('buildToolFallbackHint', () => {
    it('lists all tool names', () => {
      const hint = buildToolFallbackHint([
        makeTool({ name: 'tool_alpha' }),
        makeTool({ name: 'tool_beta' }),
      ]);

      expect(hint).toContain('tool_alpha');
      expect(hint).toContain('tool_beta');
    });

    it('returns empty string when no tools', () => {
      expect(buildToolFallbackHint([])).toBe('');
    });
  });

  describe('extractToolCallsFromContent', () => {
    it('extracts tool_calls from fenced JSON block', () => {
      const content = 'Here is my response:\n```json\n{"tool_calls": [{"name": "search", "arguments": {"query": "test"}}]}\n```';
      const result = extractToolCallsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result![0].name).toBe('search');
      expect(result![0].arguments).toEqual({ query: 'test' });
    });

    it('extracts from bare triple backticks', () => {
      const content = '```\n{"name": "search", "arguments": {"query": "test"}}\n```';
      const result = extractToolCallsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result![0].name).toBe('search');
    });

    it('extracts from inline JSON braces', () => {
      const content = '{"tool_calls": [{"name": "weather", "arguments": {"city": "Beijing"}}]}';
      const result = extractToolCallsFromContent(content);

      expect(result).toHaveLength(1);
      expect(result![0].name).toBe('weather');
      expect(result![0].arguments).toEqual({ city: 'Beijing' });
    });

    it('returns null when no JSON found', () => {
      const result = extractToolCallsFromContent('plain text response');
      expect(result).toBeNull();
    });

    it('returns null for invalid JSON', () => {
      const result = extractToolCallsFromContent('```json\nnot json\n```');
      expect(result).toBeNull();
    });
  });
});
