/**
 * 内置工具依赖装配（业务侧 ②）
 *
 * 负责把真实 pipeline 实现（PipelineEngine / Phase1Analyzer / Phase4Merger）
 * 包装为 BuiltinToolDeps 注入共享底座工具层，业务隔离在本模块内部，
 * builtin-tools.ts 本身不依赖任何 pipeline 模块。
 */

import type { BuiltinToolDeps } from './builtin-tools';
import { PipelineEngine } from '../pipeline/PipelineEngine';
import { Phase1Analyzer } from '../pipeline/Phase1Analyzer';
import { Phase4Merger } from '../pipeline/Phase4Merger';
import { ContextManager } from '../pipeline/ContextManager';
import { resolveDefaultProvider } from '../llm/llm-gateway';
import { parseNovel } from '../novel/parser';

let cachedDeps: BuiltinToolDeps | null = null;

export function createBuiltinToolDeps(): BuiltinToolDeps {
  if (cachedDeps) return cachedDeps;

  const pipelineEngine = new PipelineEngine();
  const phase4 = new Phase4Merger();

  cachedDeps = {
    async startPipeline(input) {
      return pipelineEngine.startJob(input);
    },

    async cancelJob(jobId) {
      pipelineEngine.cancelJob(jobId);
    },

    async analyzeText(text, userId) {
      const provider = resolveDefaultProvider(userId);
      if (!provider) {
        return { error: '未配置 LLM Provider，请设置 DEEPSEEK_API_KEY 或 OPENAI_API_KEY' };
      }

      const phase1 = new Phase1Analyzer(provider, new ContextManager());
      const chapters = parseNovel(text).chapters;
      const input = chapters.length > 0
        ? chapters.map((c) => ({ index: c.index, title: c.title, text: c.text }))
        : [{ index: 0, title: 'text', text }];

      const output = await phase1.analyze(input);
      return {
        characters: output.characters,
        locations: output.locations,
        rawResponse: output.rawResponse,
      };
    },

    async merge(args) {
      const { screenplay, fixes } = await phase4.merge(
        {
          title: args.title,
          author: args.author,
          sourceNovel: args.title,
        },
        args.phase1Output as Parameters<typeof phase4.merge>[1],
        args.phase2Output as Parameters<typeof phase4.merge>[2],
        args.phase3Outputs as Parameters<typeof phase4.merge>[3],
      );
      return { screenplay, fixes };
    },
  };

  return cachedDeps;
}