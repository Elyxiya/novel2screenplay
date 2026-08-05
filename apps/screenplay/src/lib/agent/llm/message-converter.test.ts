import { describe, it, expect } from 'vitest';
import { toLLMMessages, parseLLMResponse } from './message-converter';
import type { AgentMessage } from '../types';
import type { LLMChatResponse } from '../../llm/types';

const makeMsg = (overrides: Partial<AgentMessage> = {}): AgentMessage => ({
  id: 'msg_1',
  role: 'user',
  content: 'hello',
  timestamp: 0,
  ...overrides,
});

const mockResponse = (overrides: Partial<LLMChatResponse> = {}): LLMChatResponse => ({
  content: 'assistant response',
  model: 'deepseek-chat',
  raw: {
    choices: [{
      finish_reason: 'stop',
      message: { content: 'assistant response' },
    }],
  },
  ...overrides,
});

describe('message-converter', () => {
  describe('toLLMMessages', () => {
    it('passes through system, user, assistant messages', () => {
      const msgs: AgentMessage[] = [
        makeMsg({ id: '1', role: 'system', content: 'you are a helpful assistant' }),
        makeMsg({ id: '2', role: 'user', content: 'hello' }),
        makeMsg({ id: '3', role: 'assistant', content: 'hi there' }),
      ];

      const result = toLLMMessages(msgs);

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ role: 'system', content: 'you are a helpful assistant' });
      expect(result[1]).toEqual({ role: 'user', content: 'hello' });
      expect(result[2]).toEqual({ role: 'assistant', content: 'hi there' });
    });

    it('strips tool messages', () => {
      const msgs: AgentMessage[] = [
        makeMsg({ id: '1', role: 'user', content: 'get weather' }),
        makeMsg({ id: '2', role: 'tool', content: 'sunny 25C', toolCallId: 'call_abc' }),
      ];

      const result = toLLMMessages(msgs);

      expect(result).toHaveLength(1);
      expect(result[0].role).toBe('user');
    });

    it('maps assistant messages with toolCalls marker to placeholder text', () => {
      const msgs: AgentMessage[] = [
        makeMsg({ id: '1', role: 'assistant', content: '' }),
      ];

      const result = toLLMMessages(msgs);
      expect(result[0].content).toBe('');
    });
  });

  describe('parseLLMResponse', () => {
    it('parses plain text response', () => {
      const response = mockResponse({
        content: 'hello world',
        raw: {
          choices: [{
            finish_reason: 'stop',
            message: { content: 'hello world' },
          }],
        },
      });

      const result = parseLLMResponse(response);

      expect(result.content).toBe('hello world');
      expect(result.toolCalls).toHaveLength(0);
      expect(result.finishReason).toBe('stop');
    });

    it('parses tool_calls response', () => {
      const response = mockResponse({
        content: '',
        raw: {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'get_weather',
                    arguments: '{"city":"Beijing"}',
                  },
                },
              ],
            },
          }],
        },
      });

      const result = parseLLMResponse(response);

      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls[0].name).toBe('get_weather');
      expect(result.toolCalls[0].arguments).toEqual({ city: 'Beijing' });
      expect(result.toolCalls[0].id).toBe('call_123');
      expect(result.finishReason).toBe('tool_calls');
    });

    it('handles malformed JSON arguments gracefully', () => {
      const response = mockResponse({
        raw: {
          choices: [{
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'test', arguments: 'not valid json' },
                },
              ],
            },
          }],
        },
      });

      const result = parseLLMResponse(response);

      expect(result.toolCalls[0].arguments).toEqual({ _raw: 'not valid json' });
    });

    it('falls back to finish_reason when no tool_calls', () => {
      const response = mockResponse({
        raw: {
          choices: [{
            finish_reason: 'length',
            message: { content: 'partial' },
          }],
        },
      });

      const result = parseLLMResponse(response);
      expect(result.finishReason).toBe('length');
    });

    it('handles missing raw.choices gracefully', () => {
      const response = mockResponse({ raw: {} as LLMChatResponse['raw'] });
      const result = parseLLMResponse(response);
      expect(result.content).toBe('');
      expect(result.toolCalls).toHaveLength(0);
    });
  });
});
