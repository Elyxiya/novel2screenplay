/**
 * Agent LLM Adapter - Prompt Engine
 *
 * Builds system prompts and manages tool-calling instruction injection.
 * Keeps the agent's behaviour configuration separate from the AgentCore logic.
 */

import type { AgentTool } from '../tool-types';
import type { OpenAIToolDefinition } from './types';
import { toOpenAITools } from './tool-registry';

/**
 * Configuration for the prompt engine.
 */
export interface PromptEngineConfig {
  /** Primary role description for the agent */
  role: string;
  /** Task domain / scope */
  domain: string;
  /** Operating principles the agent must follow */
  principles?: string[];
  /** When to use tools (fallback guidance if model doesn't auto-call) */
  toolPolicy?: string;
}

/**
 * Builds the system prompt for the agent.
 * The prompt includes:
 * 1. Role & domain context
 * 2. Operating principles
 * 3. Tool-calling protocol instructions
 * 4. JSON output format requirements
 */
export function buildSystemPrompt(config: PromptEngineConfig, tools: AgentTool[]): string {
  const parts: string[] = [];

  // ── Role & Domain ───────────────────────────────────────────────────────────
  parts.push(`【角色】${config.role}`);
  parts.push(`【任务领域】${config.domain}`);

  // ── Operating Principles ────────────────────────────────────────────────────
  if (config.principles && config.principles.length > 0) {
    parts.push('\n【操作原则】');
    for (const p of config.principles) {
      parts.push(`  • ${p}`);
    }
  }

  // ── Tool Instructions ───────────────────────────────────────────────────────
  if (tools.length > 0) {
    const openaiTools = toOpenAITools(tools);
    const toolDescriptions = openaiTools.map((t) => {
      const params = t.function.parameters;
      const required = params.required?.join(', ') ?? '无';
      const paramList = Object.entries(params.properties)
        .map(([k, v]) => `    - ${k} (${(v as { type: string }).type}): ${(v as { description?: string }).description ?? ''}`)
        .join('\n');
      return `## ${t.function.name}\n  ${t.function.description}\n  参数（必填: ${required}）:\n${paramList}`;
    }).join('\n\n');

    parts.push(`\n【可用工具】共 ${tools.length} 个\n${toolDescriptions}`);
    parts.push(`\n【工具调用规则】\n  1. 当需要获取信息或执行操作时，必须调用工具\n  2. 调用格式（严格遵守 JSON）:\n\`\`\`json\n{"tool_calls": [{"name": "工具名", "arguments": {"参数名": "参数值"}}]}\n\`\`\`\n  3. 等待工具返回结果后再决定下一步\n  4. 不要在 content 中重复已获取的信息`);
  }

  // ── Output Format ──────────────────────────────────────────────────────────
  parts.push(`\n【输出格式】\n  - 有工具可用时：使用上述 JSON 格式调用工具\n  - 无需工具时：直接返回文本结果\n  - 不要输出额外的解释或元数据`);

  return parts.join('\n');
}

/**
 * Builds the "use tools when stuck" policy text for injection when
 * the model returns text without calling tools.
 */
export function buildToolFallbackHint(tools: AgentTool[]): string {
  if (tools.length === 0) return '';
  const names = tools.map((t) => t.name).join('、');
  return `\n\n---\n提示：你有以下工具可用：${names}。如果你需要获取信息或执行操作，请使用工具调用格式。`;
}

/**
 * Extracts the JSON tool_calls block from model output.
 * Used when the model doesn't use native function-calling but returns
 * a JSON block in content.
 */
export function extractToolCallsFromContent(content: string): Array<{
  name: string;
  arguments: Record<string, unknown>;
}> | null {
  // Match: {"tool_calls": [...]} or {"name": "...", "arguments": {...}}
  const patterns = [
    /```json\s*([\s\S]*?)\s*```/,
    /```\s*([\s\S]*?)\s*```/,
    /(\{[\s\S]*\})/,
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (!match) continue;
    try {
      const parsed = JSON.parse(match[1]);
      // Direct format: { tool_calls: [...] }
      if (Array.isArray(parsed.tool_calls)) {
        return parsed.tool_calls.map((tc: { name: string; arguments: unknown }) => ({
          name: tc.name,
          arguments: tc.arguments as Record<string, unknown>,
        }));
      }
      // Legacy format: { name, arguments }
      if (parsed.name && parsed.arguments) {
        return [{ name: parsed.name, arguments: parsed.arguments as Record<string, unknown> }];
      }
    } catch {
      continue;
    }
  }
  return null;
}
