// @vitest-environment node
/**
 * pg-params 翻译契约测试（Task 3 · 双后端语义对齐）
 *
 * 验证 SQLite 风格占位符（`@name` 对象绑定 / `?` 位置绑定）在 PG 侧被正确翻译为
 * `$N` + 位置 values，从而仓库 SQL 无需改动即可在两引擎上行为一致。用真实仓库 SQL 形态做样本。
 */
import { describe, it, expect } from 'vitest';
import { translateQuery } from '../engine/pg-params.js';

describe('translateQuery · 命名对象绑定（@name）', () => {
  it('INSERT 全量命名参数 → $N + 按序展开 values', () => {
    const sql = `
      INSERT INTO jobs (
        id, status, current_phase, progress, sub_progress,
        logs, error, created_at, updated_at,
        novel_text, chapter_texts, config, pipeline_state, user_id
      ) VALUES (
        @id, @status, @currentPhase, @progress, @subProgress,
        @logs, @error, @createdAt, @updatedAt,
        @novelText, @chapterTexts, @config, @pipelineState, @userId
      )
    `;
    const params = {
      id: 'job_1',
      status: 'pending',
      currentPhase: 0,
      progress: 0,
      subProgress: null,
      logs: '[]',
      error: null,
      createdAt: 1,
      updatedAt: 1,
      novelText: '正文',
      chapterTexts: '["第一章"]',
      config: '{}',
      pipelineState: null,
      userId: null,
    };
    const t = translateQuery(sql, [params]);
    expect(t.sql).not.toContain('@');
    expect(t.values).toEqual([
      'job_1',
      'pending',
      0,
      0,
      null,
      '[]',
      null,
      1,
      1,
      '正文',
      '["第一章"]',
      '{}',
      null,
      null,
    ]);
    // 占位符已按序编号 $1..$14
    expect(t.sql.match(/\$\d+/g)).toHaveLength(14);
  });

  it('动态 UPDATE SET ... WHERE id = @id → 保留字段顺序、$N 唯一', () => {
    const sql = 'UPDATE projects SET name = @name, updated_at = @updatedAt WHERE id = @id';
    const t = translateQuery(sql, [{ name: 'P', id: 'p1', updatedAt: 5 }]);
    expect(t.sql).toBe('UPDATE projects SET name = $1, updated_at = $2 WHERE id = $3');
    expect(t.values).toEqual(['P', 5, 'p1']);
  });

  it('对象缺少命名参数 → 抛明确错误', () => {
    expect(() => translateQuery('UPDATE t SET a = @missing', [{}])).toThrow(/@missing/);
  });

  it('`@` 后无标识符时不误翻译（如常量/片段）', () => {
    expect(translateQuery('SELECT 1', []).sql).toBe('SELECT 1');
  });
});

describe('translateQuery · 位置标量绑定（?）', () => {
  it('get(id) → WHERE id = $1', () => {
    const t = translateQuery('SELECT * FROM jobs WHERE id = ?', ['job_1']);
    expect(t.sql).toBe('SELECT * FROM jobs WHERE id = $1');
    expect(t.values).toEqual(['job_1']);
  });

  it('all(a, b) → $1/$2 顺序排列', () => {
    const t = translateQuery(
      'SELECT * FROM dramas WHERE source_job_id = ? AND user_id = ? ORDER BY created_at DESC',
      ['j1', 'u1'],
    );
    expect(t.sql).toContain('source_job_id = $1 AND user_id = $2');
    expect(t.values).toEqual(['j1', 'u1']);
  });

  it('占位符数量与参数数量一致（位置模式 index 映射）', () => {
    const t = translateQuery('UPDATE dramas SET title = ?, drama_yaml = ? WHERE id = ?', ['t', 'y', 'd1']);
    expect(t.values).toEqual(['t', 'y', 'd1']);
    expect(t.sql).toBe('UPDATE dramas SET title = $1, drama_yaml = $2 WHERE id = $3');
  });
});

describe('translateQuery · 混合与导出可用性', () => {
  it('同名 @name 出现多次 → 各自编号、各自取值', () => {
    const t = translateQuery('UPDATE t SET a = @x, b = @x', [{ x: 9 }]);
    expect(t.sql).toBe('UPDATE t SET a = $1, b = $2');
    expect(t.values).toEqual([9, 9]);
  });

  it('无占位符且对象类参数不做翻译（exec/扫表）', () => {
    expect(translateQuery('SELECT id FROM jobs', []).sql).toBe('SELECT id FROM jobs');
    expect(translateQuery('SELECT id FROM jobs', []).values).toEqual([]);
  });
});