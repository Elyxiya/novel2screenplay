import { describe, it, expect, beforeEach } from 'vitest';
import type { Screenplay } from '@novel/contracts/screenplay';
import { getScreenplaySnapshot, ScreenplaySnapshotError } from '@/lib/jobs/screenplay-snapshot';
import { getJobRepository } from '@/lib/store/sqlite/job-repository';
import { getDatabase } from '@/lib/store/sqlite/db';

/** 最小剧本：1 场景对白 */
function makeScreenplay(): Screenplay {
  return {
    formatVersion: 'novel2screenplay-v1',
    metadata: {
      title: '快照测试剧本',
      author: '作者',
      sourceNovel: '快照测试小说',
      version: '1.0.0',
      createdAt: '2026-08-03T09:00:00.000Z',
      totalScenes: 1,
      totalCharacters: 1,
      totalLocations: 1,
    },
    characters: [
      {
        characterId: 'char_1',
        name: '林晓',
        aliases: [],
        personalityTags: [],
        description: '',
        isMajor: true,
        sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' },
      },
    ],
    locations: [{ locationId: 'loc_1', name: '客厅', type: 'interior', description: '', sourceRef: { chapterIndex: 0, paragraphIndex: 0, excerpt: '' } }],
    scenes: [
      {
        sceneNumber: 1,
        slugline: '内景. 客厅 - 夜',
        timeOfDay: 'night',
        locationId: 'loc_1',
        characterIds: ['char_1'],
        content: [{ type: 'dialogue', characterId: 'char_1', line: '你好。', direction: '', sourceRefs: [] }],
        summary: '开场',
        sourceChapterRange: [0, 0],
      },
    ],
    analytics: { totalWords: 10, dialoguePercentage: 100, actionPercentage: 0, avgSceneLength: 10, longestScene: 10, shortestScene: 10 },
  };
}

describe('screenplay-snapshot · C1 快照收敛', () => {
  const repo = getJobRepository();

  beforeEach(() => {
    // 仓库走 @novel/db 引擎单例，需先注册 SQLite 引擎
    getDatabase();
  });

  it('已完成任务 → 返回含 screenplay/溯源字段的快照', () => {
    const id = repo.create({
      novelText: 'xx',
      chapterTexts: ['xx'],
      modelId: 'deepseek',
      selectedChapters: [0],
      temperature: 0.7,
      title: '任务标题',
      userId: 'user_1',
    });
    repo.update(id, { status: 'completed', pipelineState: { phase4Output: makeScreenplay() } });

    const snapshot = getScreenplaySnapshot(id, 'user_1');
    expect(snapshot.screenplay.metadata.title).toBe('快照测试剧本');
    expect(snapshot.title).toBe('任务标题');
    expect(snapshot.sourceJobId).toBe(id);
    expect(snapshot.sourceNovelId).toBe(null);
  });

  it('任务不存在 → 404', () => {
    try {
      getScreenplaySnapshot('nope', 'user_1');
      expect(false).toBe(true);
    } catch (e) {
      expect((e as ScreenplaySnapshotError).status).toBe(404);
    }
  });

  it('他人任务 → 403', () => {
    const id = repo.create({ novelText: 'x', chapterTexts: ['x'], modelId: 'm', selectedChapters: [0], temperature: 0.7, userId: 'user_1' });
    try {
      getScreenplaySnapshot(id, 'user_2');
      expect(false).toBe(true);
    } catch (e) {
      expect((e as ScreenplaySnapshotError).status).toBe(403);
    }
  });

  it('未完成任务 → 400；无剧本 → 404', () => {
    const pending = repo.create({ novelText: 'x', chapterTexts: ['x'], modelId: 'm', selectedChapters: [0], temperature: 0.7, userId: 'user_1' });
    try {
      getScreenplaySnapshot(pending, 'user_1');
      expect(false).toBe(true);
    } catch (e) {
      expect((e as ScreenplaySnapshotError).status).toBe(400);
    }

    const completed = repo.create({ novelText: 'x', chapterTexts: ['x'], modelId: 'm', selectedChapters: [0], temperature: 0.7, userId: 'user_1' });
    repo.update(completed, { status: 'completed' });
    try {
      getScreenplaySnapshot(completed, 'user_1');
      expect(false).toBe(true);
    } catch (e) {
      expect((e as ScreenplaySnapshotError).status).toBe(404);
    }
  });
});