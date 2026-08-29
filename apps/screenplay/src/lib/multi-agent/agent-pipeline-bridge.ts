/**
 * Agent 产物 ↔ 经典 pipelineState 格式互转层（Task 4.2b）
 *
 * 背景（4.2b 验证脚本 verify-bridge-chain.mjs 已实证）：
 * - agent 独立任务（/api/agent/start → startConversion）从不携带 jobId、
 *   从不写经典 pipelineState（agent_tasks 自有持久化，与 jobs 表分离）。
 * - 经典 job 的 pipelineState 格式完整可用（@novel/contracts PipelineJobStateSchema
 *   校验通过，含 phase1 characters/locations + phase2 scenes + phase3 content）。
 * 故 Task 4.3 外科式重转所需的「jobId → StoredJob.pipelineState」数据链在 agent 独立
 * 任务上缺失，本层补齐格式互转：
 *
 *  1. resolvePipelineState —— 4.3 桥接器统一入口：优先读关联经典 job 的真实产物，
 *     无 jobId / job 不存在时回退到从 agent 任务产物转换（尽力而为）。
 *  2. orchestratorTaskToPipelineState —— agent 产物 → PipelineJobState（正向）。
 *  3. pipelineStateToAgentContext —— 经典 pipelineState → agent 监督上下文（反向）。
 *
 * 说明：agent 各 phase 的 output 为 `{ agentResult, completedAt }`，agentResult 为自由
 * 文本或 JSON 字符串。正向转换「结构化 JSON 优先，文本启发式兜底」，无法结构化的部分
 * 产空数组（不造假），并在 metadata 中标记来源。
 */

import { z } from 'zod';
import type { PipelineJobState, Phase1Output, Phase2Output, Phase3Output } from '@novel/contracts/pipeline';
import {
  Phase1OutputSchema,
  Phase2OutputSchema,
  Phase3OutputSchema,
} from '@novel/contracts/pipeline';
import type { OrchestratorTask } from './orchestrator';
import type { StoredJob } from '../store/job-store';

export type BridgeSource = 'classic-job' | 'agent-task' | 'unavailable';

export interface BridgeResolution {
  source: BridgeSource;
  /** 经典 job 关联（agent 任务携带 jobId 时才有） */
  jobId?: string;
  state: StoredJob['pipelineState'] | null;
  /** 状态是否由 agent 任务产物转换而来（正向互转路径） */
  convertedFromAgent: boolean;
}

/** jobId → StoredJob 的读取器（默认走 jobStore，测试可注入 fake） */
export type JobReader = (jobId: string) => StoredJob | undefined;

// ── 工具：取 phase 的 agent 输出文本 ──────────────────────────────────────────

function phaseAgentText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'string') return output;
  if (typeof output === 'object') {
    const agentResult = (output as { agentResult?: unknown }).agentResult;
    if (typeof agentResult === 'string') return agentResult;
    if (agentResult != null) return JSON.stringify(agentResult, null, 2);
    return JSON.stringify(output, null, 2);
  }
  return String(output);
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return undefined;
  }
}

// ── 文本启发式提取 ────────────────────────────────────────────────────────────

/** 从文本行提取实体名（角色/地点）。保守：只认显式的「角色/姓名/地点」标注行。 */
function extractNamesByLabel(text: string, labels: string[]): string[] {
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    for (const label of labels) {
      const m = trimmed.match(new RegExp(`^${label}\\s*[:：]\\s*(.+)$`));
      if (m) {
        const name = m[1].trim().replace(/[。，,;；]$/, '');
        if (name && !names.includes(name)) names.push(name);
        break;
      }
    }
  }
  return names;
}

/** 切分文本为场景块：以 slugline 行（第N场 / 场景N / SCENE N / 内景/外景 开头）为分界。 */
function splitSceneBlocks(text: string): Array<{ slugline: string; body: string }> {
  const blocks: Array<{ slugline: string; body: string }> = [];
  const lines = text.split(/\r?\n/);
  let current: { slugline: string; body: string[] } | null = null;
  // 只锚定场景标记开头，不要求行尾：`第1场 老宅门口`、`SCENE 2 内景`、`内景 客栈 - 夜` 均可命中
  const slugRe = /^(第\s*[0-9一二三四五六七八九十百]+场|场景\s*[0-9]+|SCENE\s*[0-9]+|(?:内景|外景|INT\.|EXT\.|INTERIOR|EXTERIOR)\b)/i;

  for (const raw of lines) {
    const line = raw.trim();
    if (slugRe.test(line)) {
      if (current) blocks.push({ slugline: current.slugline, body: current.body.join('\n') });
      current = { slugline: line, body: [] };
      continue;
    }
    if (current) current.body.push(raw);
  }
  if (current) blocks.push({ slugline: current.slugline, body: current.body.join('\n') });
  return blocks;
}

// ── 正向：agent 任务产物 → PipelineJobState ───────────────────────────────────

/** 从 analyze 阶段产物提取角色/地点：结构化 JSON 优先，文本行兜底。 */
function extractPhase1(output: unknown): Phase1Output | undefined {
  const text = phaseAgentText(output);
  if (!text) return undefined;

  const json = tryParseJson(text);
  const candidates: unknown[] = [];
  if (Array.isArray(json)) candidates.push(...json);
  else if (json && typeof json === 'object') {
    const c = (json as Record<string, unknown>).characters;
    if (Array.isArray(c)) candidates.push(...c);
    else if (c) candidates.push(c);
  }

  if (candidates.length > 0) {
    const parsed = Phase1OutputSchema.safeParse({
      characters: candidates,
      locations: (json && typeof json === 'object' ? (json as Record<string, unknown>).locations : undefined) ?? [],
      timelineHints: [],
      rawResponse: text.slice(0, 4000),
    });
    if (parsed.success) return parsed.data;
  }

  // 文本兜底：角色/姓名/地点标注行
  const charNames = extractNamesByLabel(text, ['角色', '姓名', '角色名', '人物']);
  const locNames = extractNamesByLabel(text, ['地点', '场景地点']);
  const characters = charNames.map((name) => ({
    name,
    aliases: [name],
    personalityTags: [],
    description: '',
    isMajor: false,
    sourceChapterIndex: 0,
  }));
  const locations = locNames.map((name) => ({
    name,
    type: 'interior' as const,
    description: '',
    sourceChapterIndex: 0,
  }));
  return { characters, locations, timelineHints: [], rawResponse: text.slice(0, 4000) };
}

/** 从 segment 阶段产物提取场景边界。 */
function extractPhase2(output: unknown): Phase2Output | undefined {
  const text = phaseAgentText(output);
  if (!text) return undefined;

  const json = tryParseJson(text);
  if (json && typeof json === 'object') {
    const scenes = (json as Record<string, unknown>).scenes;
    if (Array.isArray(scenes) && scenes.length > 0) {
      const parsed = Phase2OutputSchema.safeParse({ scenes, rawResponses: [] });
      if (parsed.success) return parsed.data;
    }
  }

  // 文本兜底：按 slugline 切分场景块
  const blocks = splitSceneBlocks(text);
  if (blocks.length === 0) return undefined;
  const scenes = blocks.map((b, i) => ({
    sceneIndex: i,
    chapterIndex: 0,
    startParagraph: 0,
    endParagraph: 0,
    originalStartOffset: 0,
    originalEndOffset: 0,
    draftSlugline: b.slugline,
    keyCharacterNames: [],
    summary: b.body.slice(0, 200),
  }));
  return { scenes, rawResponses: [] };
}

/** 从 convert 阶段产物提取已转换场景。 */
function extractPhase3(output: unknown): Phase3Output[] | undefined {
  const text = phaseAgentText(output);
  if (!text) return undefined;

  const json = tryParseJson(text);
  const candidates = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).scenes)
      ? (json as Record<string, unknown>).scenes as unknown[]
      : [];
  if (candidates.length > 0) {
    const parsed = z.array(Phase3OutputSchema).safeParse(candidates);
    if (parsed.success) return parsed.data;
  }

  // 文本兜底：按场景块切分 → 每块一个 action 块（content 为原文，供 4.3 重转参考）
  const blocks = splitSceneBlocks(text);
  if (blocks.length === 0) return undefined;
  return blocks.map((b, i) => ({
    sceneNumber: i,
    slugline: b.slugline,
    timeOfDay: '',
    locationId: '',
    characterIds: [],
    content: [
      {
        type: 'action' as const,
        description: b.body.slice(0, 4000),
        sourceRefs: [],
      },
    ],
    summary: b.body.slice(0, 120),
    confidence: 0.5,
  }));
}

/**
 * 正向互转：agent 任务（已完成各 phase 的 output）→ 经典 PipelineJobState。
 * 无法结构化的部分产空数组（不造假）；输出保证通过 PipelineJobStateSchema 校验。
 */
export function orchestratorTaskToPipelineState(task: OrchestratorTask): PipelineJobState {
  const getOutput = (name: string): unknown =>
    task.phases.find((p) => p.name === name)?.output;

  const state: PipelineJobState = {
    phase1Output: extractPhase1(getOutput('analyze')) ?? {
      characters: [],
      locations: [],
      timelineHints: [],
      rawResponse: '',
    },
    phase2Output: extractPhase2(getOutput('segment')),
    phase3Output: extractPhase3(getOutput('convert')),
  };
  return state;
}

/** 判断 agent 任务是否已产出可供重转的结构化输入（phase1 有实体 + phase2 有场景边界）。 */
export function hasReconvertibleState(state: StoredJob['pipelineState'] | null): boolean {
  if (!state) return false;
  const p1 = state.phase1Output;
  const p2 = state.phase2Output;
  return !!(
    p1 &&
    Array.isArray(p1.characters) &&
    Array.isArray(p1.locations) &&
    p2 &&
    Array.isArray(p2.scenes) &&
    p2.scenes.length > 0
  );
}

/**
 * 统一桥接解析（4.3 桥接器入口）：
 * - task.jobId 指向存在的经典 job → 直接返回其 pipelineState（真实经典产物）
 * - 否则回退到从 agent 任务产物正向互转
 * - 两者都拿不到 → unavailable
 */
export async function resolvePipelineState(
  task: OrchestratorTask,
  readJob?: JobReader,
): Promise<BridgeResolution> {
  if (task.jobId) {
    let job: StoredJob | undefined;
    if (readJob) {
      job = readJob(task.jobId);
    } else {
      try {
        const { jobStore } = await import('../store/job-store');
        job = jobStore.get(task.jobId);
      } catch {
        job = undefined;
      }
    }
    if (job?.pipelineState) {
      return {
        source: 'classic-job',
        jobId: task.jobId,
        state: job.pipelineState,
        convertedFromAgent: false,
      };
    }
  }

  const state = orchestratorTaskToPipelineState(task);
  if (hasReconvertibleState(state) || state.phase3Output?.length) {
    return {
      source: 'agent-task',
      jobId: task.jobId,
      state,
      convertedFromAgent: true,
    };
  }
  return { source: 'unavailable', jobId: task.jobId, state: null, convertedFromAgent: true };
}

// ── 反向：经典 pipelineState → agent 监督上下文（4.4 supervisor 用）────────────

/**
 * 把经典 pipelineState 渲染成 agent 可消费的监督上下文（角色/地点/场景/剧本统计）。
 * 供 4.4 supervisor 对经典 job 结果做质量监督与决策。
 */
export function pipelineStateToAgentContext(state: StoredJob['pipelineState']): string {
  const p1 = state.phase1Output;
  const p2 = state.phase2Output;
  const p3 = state.phase3Output;
  const p4 = state.phase4Output;

  const sections: string[] = [];

  const chars = p1?.characters ?? [];
  if (chars.length > 0) {
    sections.push(
      `角色清单（${chars.length}）:\n` +
        chars
          .map((c) => {
            const aliases = c.aliases.length > 1 ? `（别名: ${c.aliases.filter((a) => a !== c.name).join('、')}）` : '';
            return `- ${c.name}${aliases}${c.isMajor ? ' [主角]' : ''}${c.description ? `: ${c.description}` : ''}`;
          })
          .join('\n'),
    );
  }

  const locs = p1?.locations ?? [];
  if (locs.length > 0) {
    sections.push(
      `地点清单（${locs.length}）:\n` +
        locs.map((l) => `- ${l.name}（${l.type}）${l.description ? `: ${l.description}` : ''}`).join('\n'),
    );
  }

  const scenes = p2?.scenes ?? [];
  if (scenes.length > 0) {
    sections.push(
      `场景清单（${scenes.length}）:\n` +
        scenes
          .map((s) => {
            const charsIn = s.keyCharacterNames.length > 0 ? ` 角色: ${s.keyCharacterNames.join('、')}` : '';
            const summ = s.summary ? ` 摘要: ${s.summary.slice(0, 100)}` : '';
            return `- #${s.sceneIndex} ${s.draftSlugline}（章${s.chapterIndex}）${charsIn}${summ}`;
          })
          .join('\n'),
    );
  }

  if (p3 && p3.length > 0) {
    const ok = p3.filter((s) => s.confidence > 0.5).length;
    sections.push(`已转换场景: ${ok}/${p3.length}（confidence>0.5）`);
  }

  const meta = p4?.metadata;
  if (meta) {
    sections.push(
      `剧本统计: ${meta.totalScenes ?? 0} 场景 | ${meta.totalCharacters ?? 0} 角色 | ${meta.totalLocations ?? 0} 地点`,
    );
  }
  if (p4?.analytics) {
    sections.push(
      `对白占比 ${p4.analytics.dialoguePercentage ?? '?'}% | 动作占比 ${p4.analytics.actionPercentage ?? '?'}%`,
    );
  }

  return sections.filter(Boolean).join('\n\n');
}
