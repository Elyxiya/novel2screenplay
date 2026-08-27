/**
 * 剧本快照（Screenplay Snapshot）
 *
 * ② 侧为下游（③ 短剧工坊）提供的**只读快照**接口：给定一个已完成任务，返回可供 ③ 消费的
 * `Screenplay` 与最小溯源信息（title / sourceNovelId / sourceNovelTitle）。
 *
 * 意义（耦合点 C1 收敛）：③ 消费方入口都从这里取数据，**不再直接触碰 `jobStore.get`、
 * `job.pipelineState` 或 `getNovelRepository` 等 ② 内部实现**。快照把"如何从 ② 读数据"
 * 封装在该模块内，③ 侧只依赖契约化的快照结构。
 */

import { jobStore } from '@/lib/store/job-store';
import { getNovelRepository } from '@/lib/store/sqlite/novel-repository';
import type { Screenplay } from '@novel/contracts/screenplay';

/** 剧本快照：③ 消费的最小输入单元 */
export interface ScreenplaySnapshot {
  /** 完整剧本（符合 @novel/contracts 契约） */
  screenplay: Screenplay;
  /** 分镜标题（优先任务配置标题，回退剧本元数据标题） */
  title: string;
  sourceJobId: string;
  sourceNovelId: string | null;
  sourceNovelTitle: string;
}

/** 取快照失败的分类错误，便于路由层映射 HTTP 状态 */
export class ScreenplaySnapshotError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ScreenplaySnapshotError';
  }
}

/**
 * 取指定任务的剧本快照。
 * @throws ScreenplaySnapshotError 当任务不存在/无权限/未完成/无剧本时
 */
export function getScreenplaySnapshot(jobId: string, userId: string): ScreenplaySnapshot {
  const job = jobStore.get(jobId);
  if (!job) throw new ScreenplaySnapshotError(404, '剧本任务不存在');

  if (job.userId && job.userId !== userId) {
    throw new ScreenplaySnapshotError(403, '无权访问该任务');
  }
  if (job.status !== 'completed') {
    throw new ScreenplaySnapshotError(400, `任务未完成(${job.status})，无法生成分镜`);
  }

  const screenplay = job.pipelineState.phase4Output;
  if (!screenplay) throw new ScreenplaySnapshotError(404, '剧本数据不存在');

  const novelId = job.novelId ?? null;
  let sourceNovelTitle = '';
  if (novelId) {
    const novel = getNovelRepository().get(novelId);
    if (novel) sourceNovelTitle = novel.title;
  }

  return {
    screenplay,
    title: job.config?.title ?? screenplay.metadata.title,
    sourceJobId: jobId,
    sourceNovelId: novelId,
    sourceNovelTitle,
  };
}