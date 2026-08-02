/**
 * Agent LLM Adapter - Tool Registry
 *
 * Converts AgentTool (framework) definitions to OpenAI tool format.
 * Handles the schema translation from our simple JSON Schema-lite format
 * to the strict OpenAI function-calling parameter format.
 */

import type { AgentTool } from '../tool-types';
import type { OpenAIFunctionParameter, OpenAIToolDefinition } from './types';

/**
 * Converts an AgentTool to an OpenAI-compatible tool definition.
 * This is a direct pass-through since our AgentTool.inputSchema already
 * uses the JSON Schema subset that OpenAI supports.
 */
export function toOpenAITool(tool: AgentTool): OpenAIToolDefinition {
  const schema = tool.inputSchema ?? {};
  const properties: Record<string, OpenAIFunctionParameter> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(schema)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const param = value as Record<string, unknown>;
      const entry: OpenAIFunctionParameter = {
        type: param.type as string ?? 'string',
        description: (param.description as string) ?? '',
      };
      if (param.enum) entry.enum = param.enum as string[];
      if (param.minimum !== undefined) entry.minimum = param.minimum as number;
      if (param.maximum !== undefined) entry.maximum = param.maximum as number;
      if (param.default !== undefined) entry.default = param.default;
      properties[key] = entry;
      if (param.required === true) {
        required.push(key);
      }
    } else {
      properties[key] = { type: String(value), description: '' };
    }
  }

  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
    },
  };
}

/**
 * Converts all AgentTools to OpenAI tools format.
 */
export function toOpenAITools(tools: AgentTool[]): OpenAIToolDefinition[] {
  return tools.map(toOpenAITool);
}

/**
 * Validates that a tool call name exists in the provided tools list.
 * Returns the tool if found, null otherwise.
 */
export function resolveTool(
  name: string,
  tools: AgentTool[],
): AgentTool | null {
  return tools.find((t) => t.name === name) ?? null;
}
