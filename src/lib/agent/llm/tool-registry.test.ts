import { describe, it, expect } from 'vitest';
import { toOpenAITool, toOpenAITools, resolveTool } from './tool-registry';
import type { AgentTool } from '../tool-types';

const makeTool = (overrides: Partial<AgentTool> = {}): AgentTool => ({
  name: 'test_tool',
  description: 'A test tool',
  inputSchema: {},
  execute: async () => 'ok',
  ...overrides,
});

describe('tool-registry', () => {
  describe('toOpenAITool', () => {
    it('produces a valid OpenAI tool definition', () => {
      const tool = makeTool({
        name: 'get_weather',
        description: 'Get weather for a city',
        inputSchema: {
          city: { type: 'string', description: 'City name', required: true },
          unit: { type: 'string', description: 'Temperature unit', enum: ['celsius', 'fahrenheit'] },
        },
      });

      const result = toOpenAITool(tool);

      expect(result.type).toBe('function');
      expect(result.function.name).toBe('get_weather');
      expect(result.function.description).toBe('Get weather for a city');
      expect(result.function.parameters.type).toBe('object');
      expect(result.function.parameters.required).toContain('city');
      expect(result.function.parameters.required).not.toContain('unit');
      expect(result.function.parameters.properties.city.type).toBe('string');
      expect(result.function.parameters.properties.city.description).toBe('City name');
      expect(result.function.parameters.properties.unit.enum).toEqual(['celsius', 'fahrenheit']);
    });

    it('handles bare shorthand type annotation', () => {
      const tool = makeTool({
        name: 'search',
        inputSchema: {
          query: 'string',
          limit: 'number',
        },
      });

      const result = toOpenAITool(tool);

      expect(result.function.parameters.properties.query.type).toBe('string');
      expect(result.function.parameters.properties.limit.type).toBe('number');
      expect(result.function.parameters.properties.query.description).toBe('');
    });

    it('handles missing optional fields', () => {
      const tool = makeTool({ inputSchema: {} });
      const result = toOpenAITool(tool);
      expect(result.function.parameters.required).toBeUndefined();
      expect(result.function.parameters.properties).toEqual({});
    });

    it('maps numeric constraints', () => {
      const tool = makeTool({
        inputSchema: {
          page: { type: 'number', minimum: 1, maximum: 100, default: 1 },
        },
      });

      const result = toOpenAITool(tool);
      expect(result.function.parameters.properties.page.minimum).toBe(1);
      expect(result.function.parameters.properties.page.maximum).toBe(100);
      expect(result.function.parameters.properties.page.default).toBe(1);
    });
  });

  describe('toOpenAITools', () => {
    it('converts multiple tools', () => {
      const tools = [
        makeTool({ name: 'tool_a', description: 'A' }),
        makeTool({ name: 'tool_b', description: 'B' }),
      ];

      const results = toOpenAITools(tools);

      expect(results).toHaveLength(2);
      expect(results[0].function.name).toBe('tool_a');
      expect(results[1].function.name).toBe('tool_b');
    });
  });

  describe('resolveTool', () => {
    it('returns the tool when found', () => {
      const tool = makeTool({ name: 'my_tool' });
      const result = resolveTool('my_tool', [tool]);
      expect(result).toBe(tool);
    });

    it('returns null when not found', () => {
      const result = resolveTool('nonexistent', []);
      expect(result).toBeNull();
    });

    it('returns first match when duplicate names exist', () => {
      const t1 = makeTool({ name: 'dup', description: 'first' });
      const t2 = makeTool({ name: 'dup', description: 'second' });
      const result = resolveTool('dup', [t1, t2]);
      expect(result).toBe(t1);
    });
  });
});
