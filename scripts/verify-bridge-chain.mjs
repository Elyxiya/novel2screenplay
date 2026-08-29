// Task 4.2b 验证脚本：桥接数据链核实（不入库，只读）
//
// 核实两个事实（spec §2.6 / tasks 4.2b）：
//  1. agent 任务（agent_tasks 表）是否携带 jobId → 经典 job
//  2. 经典 job（jobs 表）的 pipeline_state 结构是否完整、能否通过
//     @novel/contracts PipelineJobStateSchema zod 校验（格式可用）
//
// 结论：若 agent 产物从不写经典 pipelineState → 需补互转层（4.2b 产出）。
//
// 运行（better-sqlite3 按 Node 24 编译，须用 nvm 24 node）：
//   & "E:\nvm\nodejs\node.exe" scripts/verify-bridge-chain.mjs
// 可选：设 DATABASE_URL 后同时核验 PG 后端数据。
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PipelineJobStateSchema } from '../packages/contracts/dist/pipeline.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'apps/screenplay/data/novel2screenplay.db');

const results = {
  sqlite: {},
  postgres: undefined,
  verdict: {},
};

/** 校验经典 job 的 pipelineState 结构：存在性 + zod 契约 + 可重转所需关键字段 */
function inspectPipelineState(ps) {
  const probe = {
    phase1Output: ps?.phase1Output ?? null,
    phase2Output: ps?.phase2Output ?? null,
    phase3Output: ps?.phase3Output ?? null,
    phase4Output: ps?.phase4Output ?? null,
    qualityAssessment: ps?.qualityAssessment ?? null,
  };
  const keys = Object.keys(probe);

  const zod = PipelineJobStateSchema.safeParse(ps);
  const baseOk = zod.success;

  // 可重转（Task 4.3）关键字段：phase1 characters/locations、phase2 scenes、phase3 单场景输出
  const p1 = probe.phase1Output;
  const p2 = probe.phase2Output;
  const p3 = probe.phase3Output;
  const reconvertReady =
    !!p1 && Array.isArray(p1.characters) && Array.isArray(p1.locations) &&
    !!p2 && Array.isArray(p2.scenes) && p2.scenes.length > 0 &&
    Array.isArray(p3) && p3.length > 0 &&
    p3.every((s) => typeof s.sceneNumber === 'number' && Array.isArray(s.content));

  return {
    keys,
    zodOk: baseOk,
    zodIssues: baseOk ? [] : zod.error.issues.slice(0, 3).map((i) => i.path.join('.') + ': ' + i.message),
    charCount: p1?.characters?.length ?? null,
    locCount: p1?.locations?.length ?? null,
    sceneCount: p2?.scenes?.length ?? null,
    convertedCount: p3?.length ?? null,
    reconvertReady,
    qualityScore: probe.qualityAssessment?.score ?? null,
  };
}

/** 检查 agent 任务是否携带 jobId（task_json 内 OrchestratorTask.jobId 字段） */
function inspectAgentTask(task) {
  const hasField = Object.prototype.hasOwnProperty.call(task, 'jobId');
  return {
    hasJobIdField: hasField,
    jobId: task.jobId ?? null,
    statuses: task.phases?.map((p) => p.name + '=' + p.status).join(', ') ?? '',
    phaseCount: task.phases?.length ?? 0,
  };
}

// ── SQLite 后端 ──
const sqlite = new Database(DB_FILE, { readonly: true });
try {
  const agentRows = sqlite
    .prepare('SELECT id, status, task_json FROM agent_tasks ORDER BY created_at DESC LIMIT 10')
    .all();
  const agentInspect = agentRows.map((r) => {
    let task;
    try {
      task = JSON.parse(r.task_json);
    } catch {
      task = null;
    }
    return { id: r.id, status: r.status, ...(task ? inspectAgentTask(task) : { parseError: true }) };
  });

  const jobRows = sqlite
    .prepare(`SELECT id, status, current_phase, progress, pipeline_state FROM jobs ORDER BY created_at DESC LIMIT 15`)
    .all();
  const jobInspect = jobRows
    .map((r) => {
      let ps;
      try {
        ps = JSON.parse(r.pipeline_state);
      } catch {
        ps = null;
      }
      return {
        id: r.id,
        status: r.status,
        currentPhase: r.current_phase,
        progress: r.progress,
        pipelineState: ps ? inspectPipelineState(ps) : { parseError: true },
      };
    })
    .filter((j) => j.pipelineState && !j.pipelineState.parseError && Object.keys(j.pipelineState.keys ?? {}).length > 0);

  results.sqlite = {
    dbFile: DB_FILE,
    agentTaskCount: agentRows.length,
    agentTasks: agentInspect,
    jobCount: jobRows.length,
    jobsWithState: jobInspect.length,
    jobSamples: jobInspect.slice(0, 5),
  };
} finally {
  sqlite.close();
}

// ── PG 后端（可选）──
if (process.env.DATABASE_URL) {
  try {
    const pgMod = await import('pg');
    const client = new pgMod.default.Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const agent = await client.query(
        'SELECT id, status, task_json FROM agent_tasks ORDER BY created_at DESC LIMIT 10',
      );
      const agentInspect = agent.rows.map((r) => {
        let task;
        try {
          task = JSON.parse(r.task_json);
        } catch {
          task = null;
        }
        return { id: r.id, status: r.status, ...(task ? inspectAgentTask(task) : { parseError: true }) };
      });

      const jobs = await client.query(
        `SELECT id, status, current_phase, progress, pipeline_state FROM jobs ORDER BY created_at DESC LIMIT 15`,
      );
      const jobInspect = jobs.rows
        .map((r) => {
          let ps;
          try {
            ps = JSON.parse(r.pipeline_state);
          } catch {
            ps = null;
          }
          return {
            id: r.id,
            status: r.status,
            currentPhase: r.current_phase,
            progress: r.progress,
            pipelineState: ps ? inspectPipelineState(ps) : { parseError: true },
          };
        })
        .filter((j) => j.pipelineState && !j.pipelineState.parseError && Object.keys(j.pipelineState.keys ?? {}).length > 0);

      results.postgres = {
        url: process.env.DATABASE_URL.replace(/:\/\/[^@]*@/, '://***@'),
        agentTaskCount: agent.rows.length,
        agentTasks: agentInspect,
        jobCount: jobs.rows.length,
        jobsWithState: jobInspect.length,
        jobSamples: jobInspect.slice(0, 5),
      };
    } finally {
      await client.end();
    }
  } catch (err) {
    results.postgres = { error: (err).message };
  }
}

// ── 判定 ──
const pick = (backend) => {
  if (!backend) return null;
  if (backend.error) return null;
  return backend;
};
const S = pick(results.sqlite);
const P = pick(results.postgres);
const backend = P ?? S;

const agentTasks = backend?.agentTasks ?? [];
const jobSamples = backend?.jobSamples ?? [];

const agentHasJobId = agentTasks.some((a) => a.hasJobIdField && a.jobId);
const jobStateOk = jobSamples.some((j) => j.pipelineState.zodOk);
const reconvertReady = jobSamples.some((j) => j.pipelineState.reconvertReady);

results.verdict = {
  agentTasksChecked: agentTasks.length,
  agentHasJobId: agentHasJobId,
  classicJobsChecked: jobSamples.length,
  classicPipelineStateZodOk: jobStateOk,
  classicReconvertReady: reconvertReady,
  // spec §2.6 结论：若 agent 无 jobId 且不写 pipelineState → 需补互转层
  needsBridgeLayer: !agentHasJobId && jobStateOk,
  conclusion:
    !agentHasJobId && jobStateOk
      ? 'agent 独立任务从不写经典 pipelineState（jobId 未填充）→ 桥接数据链缺失 → 补「agent 产物 ↔ pipelineState」互转层'
      : agentHasJobId
        ? 'agent 任务已携带有效 jobId → 桥接数据链存在'
        : '无可用数据（agent_tasks / jobs 均无样本）→ 需构造样本后重跑',
};

console.log('\n========== Task 4.2b 桥接数据链验证 ==========\n');
console.log(JSON.stringify(results, null, 2));
console.log('\n========== 判定 ==========');
console.log(`  agent 任务样本数: ${results.verdict.agentTasksChecked}`);
console.log(`  agent 任务携带有效 jobId: ${results.verdict.agentHasJobId}`);
console.log(`  经典 job 样本数: ${results.verdict.classicJobsChecked}`);
console.log(`  经典 pipelineState 通过 zod 校验: ${results.verdict.classicPipelineStateZodOk}`);
console.log(`  经典 pipelineState 可重转（phase1 chars/locs + phase2 scenes + phase3 content）: ${results.verdict.classicReconvertReady}`);
console.log(`  需要互转层: ${results.verdict.needsBridgeLayer}`);
console.log(`  结论: ${results.verdict.conclusion}`);
